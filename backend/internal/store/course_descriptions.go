package store

import (
	"context"

	"campus-forum/internal/models"
)

// courseUseSQL: each course with the number of programs that teach it
// (required, an option of an elective slot, or in an elective list; every
// entry year and track of a program counts once).
const courseUseSQL = `
	WITH used AS (
		SELECT i.course_code AS code, c.program_code FROM curriculum_items i JOIN curricula c ON c.id = i.curriculum_id
		WHERE i.course_code IS NOT NULL
		UNION
		SELECT unnest(i.options), c.program_code FROM curriculum_items i JOIN curricula c ON c.id = i.curriculum_id
		UNION
		SELECT e.course_code, c.program_code FROM curriculum_electives e JOIN curricula c ON c.id = e.curriculum_id
	)
	SELECT code, count(DISTINCT program_code)::int AS programs FROM used GROUP BY code`

// CoursesMissingDescriptions lists the courses taught in some program that
// lack a description in at least one language: those with none at all
// first, then by how many programs teach them (the ones most students see).
// used = how many courses programs teach in all.
func (s *PostgresStore) CoursesMissingDescriptions(ctx context.Context, limit int) ([]models.CourseDescriptionGap, int, error) {
	var used int
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM (`+courseUseSQL+`) u JOIN courses co ON co.code = u.code`).Scan(&used); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT co.code, co.name, co.ects, u.programs, co.description = '', co.description_kz = '', co.description_ru = ''
		FROM (`+courseUseSQL+`) u JOIN courses co ON co.code = u.code
		WHERE co.description = '' OR co.description_kz = '' OR co.description_ru = ''
		ORDER BY (co.description = '' AND co.description_kz = '' AND co.description_ru = '') DESC, u.programs DESC, co.code
		LIMIT $1`, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.CourseDescriptionGap{}
	for rows.Next() {
		var g models.CourseDescriptionGap
		var en, kz, ru bool
		if err := rows.Scan(&g.Code, &g.Name, &g.ECTS, &g.Programs, &en, &kz, &ru); err != nil {
			return nil, 0, err
		}
		g.Missing = []string{}
		for _, m := range []struct {
			lang    string
			missing bool
		}{{"en", en}, {"kz", kz}, {"ru", ru}} {
			if m.missing {
				g.Missing = append(g.Missing, m.lang)
			}
		}
		out = append(out, g)
	}
	return out, used, rows.Err()
}
