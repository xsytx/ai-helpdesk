package store

import (
	"context"
	_ "embed"
	"regexp"
	"strings"
	"unicode"

	"campus-forum/internal/curricula"
	"campus-forum/internal/models"
)

//go:embed migrations/029_chat_courses.sql
var chatCoursesSQL string

// A course code in a question: "MAT 101", "mat101", "CSS-331" (placeholders like "MAT 1XX" are not courses).
var courseCodeInText = regexp.MustCompile(`(?i)\b([a-z]{3,5})[ -]?(\d{3,4})\b`)

// CoursesInText finds the catalogue courses a chat question names, at most
// limit: course codes first (in the order typed), then full course names
// ("Operating Systems", any letter case, punctuation ignored; names of two
// words or more, longest first, so "Linear Algebra 2" wins over "Linear
// Algebra"). Codes not in the catalogue are skipped. When several courses
// share a name ("Machine Learning" is taught under five codes), the one in
// the asking student's program comes first, then the one with more published
// reviews, then the one more programs teach.
func (s *PostgresStore) CoursesInText(ctx context.Context, text string, limit int, userID int64) ([]models.Course, error) {
	out := []models.Course{}
	if limit <= 0 || strings.TrimSpace(text) == "" {
		return out, nil
	}
	text = curricula.CleanText(text)
	codes := []string{}
	for _, m := range courseCodeInText.FindAllStringSubmatch(text, 10) {
		codes = append(codes, strings.ToUpper(m[1])+" "+m[2])
	}
	seen := map[string]bool{}
	if len(codes) > 0 {
		rows, err := s.pool.Query(ctx, `SELECT `+courseColumns+` FROM courses WHERE code = ANY($1) ORDER BY array_position($1, code)`, codes)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			c, err := scanCourse(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			if !seen[c.Code] && len(out) < limit {
				seen[c.Code] = true
				out = append(out, c)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	if len(out) >= limit {
		return out, nil
	}
	// A name counts only as whole words ("Physics 1" is not found in "Physics 10"),
	// and only a name of two words or more: "Internship" alone is too general.
	rows, err := s.pool.Query(ctx, `
		WITH mine AS (
			SELECT c.id FROM curricula c JOIN user_programs up ON up.program_code = c.program_code WHERE up.user_id = $2
		)
		SELECT `+courseColumns+` FROM courses co
		WHERE char_length(name) >= 8 AND name LIKE '% %'
		  AND strpos(' ' || regexp_replace(lower($1), '[^[:alnum:]]+', ' ', 'g') || ' ',
		             ' ' || trim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g')) || ' ') > 0
		ORDER BY char_length(name) DESC,
		  EXISTS (SELECT 1 FROM curriculum_items i WHERE i.curriculum_id IN (SELECT id FROM mine) AND (i.course_code = co.code OR co.code = ANY(i.options)))
		  OR EXISTS (SELECT 1 FROM curriculum_electives e WHERE e.curriculum_id IN (SELECT id FROM mine) AND e.course_code = co.code) DESC,
		  (SELECT count(*) FROM course_reviews r WHERE r.course_code = co.code AND r.status = 'ok') DESC,
		  (SELECT count(DISTINCT c.program_code) FROM curriculum_items i JOIN curricula c ON c.id = i.curriculum_id
		   WHERE i.course_code = co.code OR co.code = ANY(i.options)) DESC,
		  code
		LIMIT 10`, text, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	picked := []string{}
	for rows.Next() {
		c, err := scanCourse(rows)
		if err != nil {
			return nil, err
		}
		// One course per name (the same name under several codes: the first), and
		// not "Linear Algebra" when "Linear Algebra 2" was found (longer names come first).
		key := " " + nameWords(c.Name) + " "
		inside := false
		for _, p := range picked {
			inside = inside || strings.Contains(p, key)
		}
		if seen[c.Code] || inside || len(out) >= limit {
			continue
		}
		seen[c.Code] = true
		picked = append(picked, key)
		out = append(out, c)
	}
	return out, rows.Err()
}

// nameWords is a name in lower case with anything but letters and digits as single spaces.
func nameWords(s string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}), " ")
}

// chatCourses is the courses column's value: never NULL.
func chatCourses(list []models.ChatCourse) []models.ChatCourse {
	if list == nil {
		return []models.ChatCourse{}
	}
	return list
}
