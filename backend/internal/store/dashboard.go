package store

import (
	"context"
	"time"

	"campus-forum/internal/models"
)

// openThread: a visible forum question with no visible answer (replies under
// an answer don't count), the same rule as the feed's "unanswered" filter.
const openThread = threadVisible + ` AND NOT EXISTS (SELECT 1 FROM comments c
	WHERE c.thread_id = t.id AND c.parent_comment_id IS NULL AND ` + commentVisible + `)`

// The chat's answers by kind (chat_messages.basis): answered by the AI
// ("retrieved", "context", "general", "stopped"), from the FAQ, or none.
const (
	basisFAQ  = `a.basis = 'faq'`
	basisNone = `a.basis = 'none'`
	basisAI   = `a.basis IN ('retrieved', 'context', 'general', 'stopped')`
)

// dashboardTotals counts what happened from `from` up to (not including)
// `to`; firstDay..lastDay are the same range as Almaty dates (for ai_usage).
// The all-time counts (total students, open forum questions) and "today"
// are the same whatever the range.
func (s *PostgresStore) dashboardTotals(ctx context.Context, from, to time.Time, firstDay, lastDay, today string) (models.DashboardTotals, error) {
	var t models.DashboardTotals
	err := s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM chat_messages u WHERE u.role = 'user' AND u.created_at >= $1 AND u.created_at < $2)::int,
		  (SELECT COALESCE(sum(questions), 0) FROM ai_usage WHERE day BETWEEN $3::date AND $4::date)::int,
		  (SELECT COALESCE(sum(questions), 0) FROM ai_usage WHERE day = $5::date)::int,
		  (SELECT count(*) FROM chat_messages a WHERE a.role = 'assistant' AND `+basisFAQ+` AND a.created_at >= $1 AND a.created_at < $2)::int,
		  (SELECT count(*) FROM chat_messages a WHERE a.role = 'assistant' AND `+basisNone+` AND a.created_at >= $1 AND a.created_at < $2)::int,
		  (SELECT count(*) FROM chat_messages a WHERE a.rating = 1 AND a.rated_at >= $1 AND a.rated_at < $2)::int,
		  (SELECT count(*) FROM chat_messages a WHERE a.rating = -1 AND a.rated_at >= $1 AND a.rated_at < $2)::int,
		  (SELECT count(DISTINCT u.user_id) FROM chat_messages u JOIN users us ON us.id = u.user_id
		     WHERE u.role = 'user' AND us.role = 'user' AND u.created_at >= $1 AND u.created_at < $2)::int,
		  (SELECT count(*) FROM users WHERE role = 'user' AND created_at >= $1 AND created_at < $2)::int,
		  (SELECT count(*) FROM users WHERE role = 'user')::int,
		  (SELECT count(*) FROM threads t WHERE `+threadVisible+` AND t.created_at >= $1 AND t.created_at < $2)::int,
		  (SELECT count(*) FROM comments c WHERE `+commentVisible+` AND c.created_at >= $1 AND c.created_at < $2)::int,
		  (SELECT count(*) FROM threads t WHERE `+openThread+`)::int,
		  (SELECT count(*) FROM course_reviews r WHERE `+reviewVisible+` AND r.created_at >= $1 AND r.created_at < $2)::int`,
		from, to, firstDay, lastDay, today).Scan(&t.ChatQuestions, &t.AIAnswers, &t.AIAnswersToday, &t.FAQAnswers, &t.Unanswered,
		&t.Liked, &t.Disliked, &t.ActiveStudents, &t.NewStudents, &t.TotalStudents,
		&t.ForumQuestions, &t.ForumAnswers, &t.ForumOpenTotal, &t.Reviews)
	return t, err
}

// AdminDashboard counts the `days` days up to today, starting at since (the
// Almaty midnight that begins them), and the same number of days before
// them as Previous. Lists are left to the caller except the ones only this
// file knows how to read.
func (s *PostgresStore) AdminDashboard(ctx context.Context, since time.Time, days int) (models.Dashboard, error) {
	d := models.Dashboard{Daily: []models.DashboardDay{}, TopQuestions: []models.TopQuestion{},
		TopCourses: []models.CourseAsked{}, OpenThreads: []models.OpenThread{}, AICallsToday: map[string]int{}}
	date := func(t time.Time) string { return t.Format(time.DateOnly) }
	end := since.AddDate(0, 0, days)
	firstDay, today := date(since), date(end.AddDate(0, 0, -1))
	var err error
	if d.Totals, err = s.dashboardTotals(ctx, since, end, firstDay, today, today); err != nil {
		return d, err
	}
	prev := since.AddDate(0, 0, -days)
	if d.Previous, err = s.dashboardTotals(ctx, prev, since, date(prev), date(since.AddDate(0, 0, -1)), today); err != nil {
		return d, err
	}
	for _, k := range AICallKinds {
		d.AICallsToday[k] = 0
	}
	calls, err := s.pool.Query(ctx, `SELECT kind, calls FROM ai_calls WHERE day = $1::date`, today)
	if err != nil {
		return d, err
	}
	for calls.Next() {
		var kind string
		var n int
		if err := calls.Scan(&kind, &n); err != nil {
			calls.Close()
			return d, err
		}
		d.AICallsToday[kind] = n
	}
	calls.Close()
	if err := calls.Err(); err != nil {
		return d, err
	}

	// Every day of the period, also the quiet ones (zeros), by Almaty date.
	rows, err := s.pool.Query(ctx, `
		WITH per_day AS (
		  SELECT (a.created_at AT TIME ZONE 'Asia/Almaty')::date AS day,
		    count(*) FILTER (WHERE `+basisAI+`) AS answered,
		    count(*) FILTER (WHERE `+basisFAQ+`) AS faq,
		    count(*) FILTER (WHERE `+basisNone+`) AS unanswered
		  FROM chat_messages a WHERE a.role = 'assistant' AND a.created_at >= $1
		  GROUP BY 1)
		SELECT to_char(g.day, 'YYYY-MM-DD'), COALESCE(p.answered, 0)::int, COALESCE(p.faq, 0)::int, COALESCE(p.unanswered, 0)::int
		FROM generate_series($2::date, $3::date, interval '1 day') AS g(day)
		LEFT JOIN per_day p ON p.day = g.day::date
		ORDER BY g.day`, since, firstDay, today)
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var day models.DashboardDay
		if err := rows.Scan(&day.Day, &day.Answered, &day.FAQ, &day.Unanswered); err != nil {
			rows.Close()
			return d, err
		}
		d.Daily = append(d.Daily, day)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return d, err
	}

	// The most asked questions (questions answered from the FAQ left out).
	rows, err = s.pool.Query(ctx, `
		SELECT (array_agg(u.text ORDER BY u.created_at DESC))[1], count(DISTINCT u.user_id)::int, count(*)::int, max(u.created_at)
		FROM chat_messages u
		WHERE u.role = 'user' AND u.created_at >= $1
		  AND NOT EXISTS (
		      SELECT 1 FROM chat_messages a
		      WHERE a.conversation_id = u.conversation_id AND `+basisFAQ+`
		        AND a.id = (SELECT min(x.id) FROM chat_messages x
		                    WHERE x.conversation_id = u.conversation_id AND x.id > u.id))
		GROUP BY `+normalizedQuestion+`
		ORDER BY 2 DESC, 3 DESC, 4 DESC LIMIT 10`, since)
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var q models.TopQuestion
		if err := rows.Scan(&q.Question, &q.Students, &q.Asks, &q.LastAt); err != nil {
			rows.Close()
			return d, err
		}
		d.TopQuestions = append(d.TopQuestions, q)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return d, err
	}

	// Courses the chat was asked about (029_chat_courses.sql).
	rows, err = s.pool.Query(ctx, `
		SELECT c->>'code', max(c->>'name'), count(*)::int
		FROM chat_messages a, jsonb_array_elements(a.courses) c
		WHERE a.role = 'assistant' AND a.created_at >= $1
		GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 5`, since)
	if err != nil {
		return d, err
	}
	for rows.Next() {
		var c models.CourseAsked
		if err := rows.Scan(&c.Code, &c.Name, &c.Questions); err != nil {
			rows.Close()
			return d, err
		}
		d.TopCourses = append(d.TopCourses, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return d, err
	}

	// The newest forum questions still without an answer.
	rows, err = s.pool.Query(ctx, `SELECT t.id, t.title, t.created_at FROM threads t WHERE `+openThread+`
		ORDER BY t.created_at DESC LIMIT 5`)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var o models.OpenThread
		if err := rows.Scan(&o.ID, &o.Title, &o.CreatedAt); err != nil {
			return d, err
		}
		d.OpenThreads = append(d.OpenThreads, o)
	}
	return d, rows.Err()
}
