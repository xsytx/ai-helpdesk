package store

import (
	"context"
	_ "embed"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/curricula"
	"campus-forum/internal/models"
)

//go:embed migrations/022_courses.sql
var coursesSQL string

// Course search returns at most this many courses.
const maxCourseResults = 50

// levelOrder sorts programs: bachelor first.
const levelOrder = `CASE p.level WHEN 'B' THEN 0 WHEN 'M' THEN 1 ELSE 2 END`

const programColumns = `p.code, p.title, p.level, p.tag, p.cipher, p.lang, p.faculty,
	COALESCE((SELECT array_agg(DISTINCT c.year ORDER BY c.year DESC) FROM curricula c WHERE c.program_code = p.code), '{}')`

func scanProgram(row pgx.Row) (models.Program, error) {
	var p models.Program
	err := row.Scan(&p.Code, &p.Title, &p.Level, &p.Tag, &p.Cipher, &p.Lang, &p.Faculty, &p.Years)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// ListPrograms returns every program, bachelor first, with the years that have a curriculum.
func (s *PostgresStore) ListPrograms(ctx context.Context) ([]models.Program, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+programColumns+` FROM programs p
		ORDER BY `+levelOrder+`, p.faculty, p.title, p.lang, p.code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Program{}
	for rows.Next() {
		p, err := scanProgram(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ImportCurriculum stores a parsed curriculum, replacing an earlier import of
// the same program, year and track. Courses are added or their names and
// hours updated; descriptions written by admins are kept. A program missing
// from the list is added from the page's header.
func (s *PostgresStore) ImportCurriculum(ctx context.Context, cur curricula.Curriculum, by int64) (models.CurriculumInfo, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return models.CurriculumInfo{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO programs (code, title, level, lang) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
		cur.ProgramCode, cur.Title, cur.Level, cur.Lang); err != nil {
		return models.CurriculumInfo{}, err
	}

	// Every course on the page: fixed courses and the elective lists.
	courses := map[string]curricula.Course{}
	for _, sem := range cur.Semesters {
		for _, it := range sem.Items {
			if it.Course != nil {
				courses[it.Course.Code] = *it.Course
			}
		}
	}
	for _, list := range cur.Electives {
		for _, c := range list {
			if _, ok := courses[c.Code]; !ok {
				courses[c.Code] = c
			}
		}
	}
	codes := make([]string, 0, len(courses))
	for code := range courses {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		c := courses[code]
		if _, err := tx.Exec(ctx,
			`INSERT INTO courses (code, name, theory, practice, hours, ects) VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, theory = EXCLUDED.theory, practice = EXCLUDED.practice,
			     hours = EXCLUDED.hours, ects = EXCLUDED.ects, updated_at = now()`,
			c.Code, c.Name, c.Theory, c.Practice, c.Hours, c.ECTS); err != nil {
			return models.CurriculumInfo{}, err
		}
	}

	track := cur.Track
	if track == "" {
		track = "Main Track"
	}
	var id int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO curricula (program_code, year, track, imported_by) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (program_code, year, track) DO UPDATE SET imported_by = EXCLUDED.imported_by, imported_at = now()
		 RETURNING id`, cur.ProgramCode, cur.Year, track, by).Scan(&id); err != nil {
		return models.CurriculumInfo{}, err
	}
	for _, q := range []string{`DELETE FROM curriculum_items WHERE curriculum_id = $1`, `DELETE FROM curriculum_electives WHERE curriculum_id = $1`} {
		if _, err := tx.Exec(ctx, q, id); err != nil {
			return models.CurriculumInfo{}, err
		}
	}
	for _, sem := range cur.Semesters {
		for pos, it := range sem.Items {
			var err error
			if it.Course != nil {
				_, err = tx.Exec(ctx,
					`INSERT INTO curriculum_items (curriculum_id, semester, position, course_code, ects, hours, marked)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					id, sem.Number, pos, it.Course.Code, it.Course.ECTS, it.Course.Hours, it.Marked)
			} else {
				_, err = tx.Exec(ctx,
					`INSERT INTO curriculum_items (curriculum_id, semester, position, slot_kind, slot_label, options, ects, hours, marked)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
					id, sem.Number, pos, it.Slot.Kind, it.Slot.Label, it.Slot.Options, it.Slot.ECTS, it.Slot.Hours, it.Marked)
			}
			if err != nil {
				// The same semester number twice on one page: a broken paste.
				if isPgErrorCode(err, pgUniqueViolation) {
					return models.CurriculumInfo{}, ErrInvalidTarget
				}
				return models.CurriculumInfo{}, err
			}
		}
	}
	for kind, list := range cur.Electives {
		for _, c := range list {
			if _, err := tx.Exec(ctx,
				`INSERT INTO curriculum_electives (curriculum_id, kind, course_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				id, kind, c.Code); err != nil {
				return models.CurriculumInfo{}, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return models.CurriculumInfo{}, err
	}
	return s.curriculumInfo(ctx, id)
}

const curriculumInfoSelect = `SELECT c.id, c.program_code, p.title, p.lang, c.year, c.track,
	(SELECT count(*) FROM curriculum_items i WHERE i.curriculum_id = c.id)::int, c.imported_at
	FROM curricula c JOIN programs p ON p.code = c.program_code`

func scanCurriculumInfo(row pgx.Row) (models.CurriculumInfo, error) {
	var ci models.CurriculumInfo
	err := row.Scan(&ci.ID, &ci.ProgramCode, &ci.ProgramTitle, &ci.Lang, &ci.Year, &ci.Track, &ci.Courses, &ci.ImportedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ci, ErrNotFound
	}
	return ci, err
}

func (s *PostgresStore) curriculumInfo(ctx context.Context, id int64) (models.CurriculumInfo, error) {
	return scanCurriculumInfo(s.pool.QueryRow(ctx, curriculumInfoSelect+` WHERE c.id = $1`, id))
}

// ListCurricula returns the imported curricula, newest import first.
func (s *PostgresStore) ListCurricula(ctx context.Context) ([]models.CurriculumInfo, error) {
	rows, err := s.pool.Query(ctx, curriculumInfoSelect+` ORDER BY c.imported_at DESC, c.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CurriculumInfo{}
	for rows.Next() {
		ci, err := scanCurriculumInfo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}

// DeleteCurriculum removes an imported curriculum (the courses stay in the catalogue).
func (s *PostgresStore) DeleteCurriculum(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM curricula WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetCurriculum returns a program's plan: the given entry year (0 = the
// newest imported) and track ("" = the main track, else the first).
func (s *PostgresStore) GetCurriculum(ctx context.Context, programCode string, year int, track string) (models.CurriculumView, error) {
	var v models.CurriculumView
	var err error
	v.CurriculumInfo, err = scanCurriculumInfo(s.pool.QueryRow(ctx, curriculumInfoSelect+`
		WHERE c.program_code = $1 AND ($2 = 0 OR c.year = $2)
		ORDER BY c.year DESC, (c.track = $3) DESC, (c.track ILIKE 'main%') DESC, c.track
		LIMIT 1`, programCode, year, track))
	if err != nil {
		return v, err
	}
	if v.Program, err = scanProgram(s.pool.QueryRow(ctx, `SELECT `+programColumns+` FROM programs p WHERE p.code = $1`, programCode)); err != nil {
		return v, err
	}

	v.Tracks = []string{}
	trows, err := s.pool.Query(ctx,
		`SELECT track FROM curricula WHERE program_code = $1 AND year = $2 ORDER BY (track ILIKE 'main%') DESC, track`,
		programCode, v.Year)
	if err != nil {
		return v, err
	}
	for trows.Next() {
		var t string
		if err := trows.Scan(&t); err != nil {
			trows.Close()
			return v, err
		}
		v.Tracks = append(v.Tracks, t)
	}
	trows.Close()

	type rawItem struct {
		semester int
		item     models.CurriculumItem
		options  []string
	}
	irows, err := s.pool.Query(ctx,
		`SELECT i.semester, i.course_code, COALESCE(c.name, ''), i.slot_kind, i.slot_label, i.options, i.ects, i.hours, i.marked
		 FROM curriculum_items i LEFT JOIN courses c ON c.code = i.course_code
		 WHERE i.curriculum_id = $1 ORDER BY i.semester, i.position`, v.ID)
	if err != nil {
		return v, err
	}
	var items []rawItem
	optionCodes := map[string]bool{}
	for irows.Next() {
		var r rawItem
		var code *string
		var name string
		if err := irows.Scan(&r.semester, &code, &name, &r.item.Kind, &r.item.Label, &r.options, &r.item.ECTS, &r.item.Hours, &r.item.Marked); err != nil {
			irows.Close()
			return v, err
		}
		if code != nil {
			r.item.Course = &models.CourseRef{Code: *code, Name: name, ECTS: r.item.ECTS}
		}
		for _, o := range r.options {
			optionCodes[o] = true
		}
		items = append(items, r)
	}
	irows.Close()
	if err := irows.Err(); err != nil {
		return v, err
	}

	names, err := s.courseRefs(ctx, optionCodes)
	if err != nil {
		return v, err
	}
	v.Semesters = []models.CurriculumSemester{}
	for _, r := range items {
		if len(v.Semesters) == 0 || v.Semesters[len(v.Semesters)-1].Number != r.semester {
			v.Semesters = append(v.Semesters, models.CurriculumSemester{Number: r.semester, Items: []models.CurriculumItem{}})
		}
		sem := &v.Semesters[len(v.Semesters)-1]
		if r.item.Course == nil {
			r.item.Options = []models.CourseRef{}
			for _, o := range r.options {
				ref, ok := names[o]
				if !ok {
					ref = models.CourseRef{Code: o}
				}
				r.item.Options = append(r.item.Options, ref)
			}
		}
		sem.ECTS += r.item.ECTS
		sem.Items = append(sem.Items, r.item)
	}

	v.Electives = map[string][]models.CourseRef{}
	erows, err := s.pool.Query(ctx,
		`SELECT e.kind, c.code, c.name, c.ects FROM curriculum_electives e JOIN courses c ON c.code = e.course_code
		 WHERE e.curriculum_id = $1 ORDER BY e.kind, c.code`, v.ID)
	if err != nil {
		return v, err
	}
	defer erows.Close()
	for erows.Next() {
		var kind string
		var ref models.CourseRef
		if err := erows.Scan(&kind, &ref.Code, &ref.Name, &ref.ECTS); err != nil {
			return v, err
		}
		v.Electives[kind] = append(v.Electives[kind], ref)
	}
	return v, erows.Err()
}

// courseRefs returns the names of these course codes (those in the catalogue).
func (s *PostgresStore) courseRefs(ctx context.Context, codes map[string]bool) (map[string]models.CourseRef, error) {
	out := map[string]models.CourseRef{}
	if len(codes) == 0 {
		return out, nil
	}
	list := make([]string, 0, len(codes))
	for c := range codes {
		list = append(list, c)
	}
	rows, err := s.pool.Query(ctx, `SELECT code, name, ects FROM courses WHERE code = ANY($1)`, list)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r models.CourseRef
		if err := rows.Scan(&r.Code, &r.Name, &r.ECTS); err != nil {
			return nil, err
		}
		out[r.Code] = r
	}
	return out, rows.Err()
}

const courseColumns = `code, name, theory, practice, hours, ects, description, description_kz, description_ru`

func scanCourse(row pgx.Row) (models.Course, error) {
	var c models.Course
	err := row.Scan(&c.Code, &c.Name, &c.Theory, &c.Practice, &c.Hours, &c.ECTS, &c.Description, &c.DescriptionKZ, &c.DescriptionRU)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

// likeEscape makes a user's text safe inside LIKE.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// SearchCourses finds courses by code ("MAT 1", "mat101") or name (any part,
// or a near match for typos): codes first, then the closest names.
func (s *PostgresStore) SearchCourses(ctx context.Context, q string) ([]models.Course, error) {
	q = strings.ToLower(strings.TrimSpace(curricula.CleanText(q)))
	if q == "" {
		return []models.Course{}, nil
	}
	compact := likeEscape(strings.ReplaceAll(q, " ", ""))
	rows, err := s.pool.Query(ctx,
		`SELECT `+courseColumns+` FROM courses
		 WHERE replace(lower(code), ' ', '') LIKE $1 || '%'
		    OR lower(name) LIKE '%' || $2 || '%'
		    OR similarity(lower(name), $3) > 0.3
		 ORDER BY (replace(lower(code), ' ', '') LIKE $1 || '%') DESC,
		          (lower(name) LIKE $2 || '%') DESC,
		          similarity(lower(name), $3) DESC, code
		 LIMIT $4`, compact, likeEscape(q), q, maxCourseResults)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Course{}
	for rows.Next() {
		c, err := scanCourse(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCourse returns a course and every program and semester it appears in:
// as a required course, as an option of an elective slot, or only in an
// elective list.
func (s *PostgresStore) GetCourse(ctx context.Context, code string) (models.CourseDetail, error) {
	var d models.CourseDetail
	var err error
	if d.Course, err = scanCourse(s.pool.QueryRow(ctx, `SELECT `+courseColumns+` FROM courses WHERE code = $1`, code)); err != nil {
		return d, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT p.code, p.title, p.lang, p.level, c.year, c.track, i.semester, i.slot_kind, i.slot_label
		FROM curriculum_items i JOIN curricula c ON c.id = i.curriculum_id JOIN programs p ON p.code = c.program_code
		WHERE i.course_code = $1 OR $1 = ANY(i.options)
		UNION ALL
		SELECT p.code, p.title, p.lang, p.level, c.year, c.track, 0, e.kind, ''
		FROM curriculum_electives e JOIN curricula c ON c.id = e.curriculum_id JOIN programs p ON p.code = c.program_code
		WHERE e.course_code = $1 AND NOT EXISTS (
			SELECT 1 FROM curriculum_items i WHERE i.curriculum_id = c.id AND (i.course_code = $1 OR $1 = ANY(i.options)))
		ORDER BY 4, 2, 3, 5 DESC, 7`, code)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	d.Places = []models.CoursePlace{}
	for rows.Next() {
		var p models.CoursePlace
		if err := rows.Scan(&p.ProgramCode, &p.ProgramTitle, &p.Lang, &p.Level, &p.Year, &p.Track, &p.Semester, &p.Kind, &p.Label); err != nil {
			return d, err
		}
		d.Places = append(d.Places, p)
	}
	return d, rows.Err()
}

// UpdateCourseDescription saves an admin's description in three languages.
func (s *PostgresStore) UpdateCourseDescription(ctx context.Context, code, en, kz, ru string) (models.Course, error) {
	return scanCourse(s.pool.QueryRow(ctx,
		`UPDATE courses SET description = $2, description_kz = $3, description_ru = $4, updated_at = now()
		 WHERE code = $1 RETURNING `+courseColumns, code, en, kz, ru))
}

// GetUserProgram returns a student's program and entry year (ErrNotFound if not chosen yet).
func (s *PostgresStore) GetUserProgram(ctx context.Context, userID int64) (models.UserProgram, error) {
	var up models.UserProgram
	err := s.pool.QueryRow(ctx, `SELECT program_code, entry_year FROM user_programs WHERE user_id = $1`, userID).Scan(&up.ProgramCode, &up.EntryYear)
	if errors.Is(err, pgx.ErrNoRows) {
		return up, ErrNotFound
	}
	return up, err
}

// SetUserProgram saves a student's program and entry year (ErrNotFound for an unknown program).
func (s *PostgresStore) SetUserProgram(ctx context.Context, userID int64, programCode string, entryYear int) (models.UserProgram, error) {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO user_programs (user_id, program_code, entry_year) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE SET program_code = EXCLUDED.program_code, entry_year = EXCLUDED.entry_year, updated_at = now()`,
		userID, programCode, entryYear)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.UserProgram{}, ErrNotFound
	}
	if err != nil {
		return models.UserProgram{}, err
	}
	return models.UserProgram{ProgramCode: programCode, EntryYear: entryYear}, nil
}
