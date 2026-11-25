package store

import (
	"context"
	_ "embed"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/023_course_reviews.sql
var courseReviewsSQL string

//go:embed migrations/027_review_axes.sql
var reviewAxesSQL string

// reviewVisible: what everyone may see (a review being checked is shown, like forum posts).
const reviewVisible = `r.status IN ('ok', 'checking')`

// reviewColumns: the review, its helpful count, whether the viewer ($1) marked
// it or wrote it, the author's name and open reports (into fields never sent: see ForStaff).
const reviewColumns = `r.id, r.course_code, COALESCE(c.name, ''), r.difficulty, r.workload, r.usefulness,
	COALESCE(r.interest, 0), COALESCE(r.practical, 0), COALESCE(r.beginner, 0), r.recommend, r.text,
	r.taken_year, r.taken_term, r.status, r.moderation_reason, r.created_at, r.edited_at, r.user_id, COALESCE(u.display_name, ''),
	(SELECT count(*) FROM review_helpful h WHERE h.review_id = r.id)::int,
	EXISTS (SELECT 1 FROM review_helpful h WHERE h.review_id = r.id AND h.user_id = $1),
	(SELECT count(*) FROM review_reports p WHERE p.review_id = r.id AND p.status = 'open')::int,
	COALESCE((SELECT array_agg(p.reason ORDER BY p.created_at) FROM review_reports p WHERE p.review_id = r.id AND p.status = 'open' AND p.reason <> ''), '{}')`

const reviewFrom = ` FROM course_reviews r LEFT JOIN courses c ON c.code = r.course_code LEFT JOIN users u ON u.id = r.user_id`

func scanReview(row pgx.Row, viewer int64) (models.CourseReview, error) {
	var v models.CourseReview
	err := row.Scan(&v.ID, &v.CourseCode, &v.CourseName, &v.Difficulty, &v.Workload, &v.Usefulness,
		&v.Interest, &v.Practical, &v.Beginner, &v.Recommend, &v.Text,
		&v.TakenYear, &v.TakenTerm, &v.Status, &v.Reason, &v.CreatedAt, &v.EditedAt, &v.UserID, &v.Author,
		&v.Helpful, &v.HelpedByMe, &v.Reports, &v.Reasons)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	v.Mine = viewer != 0 && v.UserID == viewer
	return v, err
}

func (s *PostgresStore) queryReviews(ctx context.Context, viewer int64, where string, args ...any) ([]models.CourseReview, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+reviewColumns+reviewFrom+` `+where, append([]any{viewer}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CourseReview{}
	for rows.Next() {
		v, err := scanReview(rows, viewer)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// SaveCourseReview creates the student's review of a course or replaces it
// (one per student and course), with the given moderation status. Editing
// sets edited_at. A review an admin rejected goes to "held" when saved again
// (an admin decides again; it never becomes public by itself). ErrNotFound
// when the course doesn't exist.
func (s *PostgresStore) SaveCourseReview(ctx context.Context, code string, userID int64, in models.CourseReviewInput, status string) (models.CourseReview, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO course_reviews (course_code, user_id, difficulty, workload, usefulness, recommend, text, taken_year, taken_term, status,
			interest, practical, beginner)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (course_code, user_id) DO UPDATE SET
			difficulty = EXCLUDED.difficulty, workload = EXCLUDED.workload, usefulness = EXCLUDED.usefulness,
			interest = EXCLUDED.interest, practical = EXCLUDED.practical, beginner = EXCLUDED.beginner,
			recommend = EXCLUDED.recommend, text = EXCLUDED.text, taken_year = EXCLUDED.taken_year,
			taken_term = EXCLUDED.taken_term, edited_at = now(),
			status = CASE WHEN course_reviews.status = 'rejected' THEN 'held' ELSE EXCLUDED.status END,
			moderation_reason = CASE WHEN course_reviews.status = 'rejected' THEN 'edited_after_reject' ELSE '' END
		RETURNING id`,
		code, userID, in.Difficulty, in.Workload, in.Usefulness, in.Recommend, in.Text, in.TakenYear, in.TakenTerm, status,
		in.Interest, in.Practical, in.Beginner).Scan(&id)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.CourseReview{}, ErrNotFound
	}
	if err != nil {
		return models.CourseReview{}, err
	}
	return s.GetCourseReview(ctx, id, userID)
}

// GetCourseReview returns one review (any status) as the viewer sees its own fields.
func (s *PostgresStore) GetCourseReview(ctx context.Context, id, viewer int64) (models.CourseReview, error) {
	return scanReview(s.pool.QueryRow(ctx, `SELECT `+reviewColumns+reviewFrom+` WHERE r.id = $2`, viewer, id), viewer)
}

// DeleteMyCourseReview removes the student's own review of a course.
func (s *PostgresStore) DeleteMyCourseReview(ctx context.Context, code string, userID int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM course_reviews WHERE course_code = $1 AND user_id = $2`, code, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListCourseReviews returns a course's reviews the viewer may see: visible
// ones, plus their own whatever its status, plus every one for staff.
// sort: "helpful" (most helpful first) or newest first.
func (s *PostgresStore) ListCourseReviews(ctx context.Context, code string, viewer int64, staff bool, sort string) ([]models.CourseReview, error) {
	// The viewer's own review first: the list limit must never hide it.
	order := `(r.user_id = $1) DESC, r.created_at DESC, r.id DESC`
	if sort == "helpful" {
		order = `(r.user_id = $1) DESC, (SELECT count(*) FROM review_helpful h WHERE h.review_id = r.id) DESC, r.created_at DESC, r.id DESC`
	}
	return s.queryReviews(ctx, viewer,
		`WHERE r.course_code = $2 AND (`+reviewVisible+` OR r.user_id = $1 OR $3) ORDER BY `+order+` LIMIT 200`, code, staff)
}

// ListMyCourseReviews returns all of a student's own reviews, any status,
// newest first (their profile's "My reviews"; only they see it: reviews are
// anonymous to other students).
func (s *PostgresStore) ListMyCourseReviews(ctx context.Context, userID int64) ([]models.CourseReview, error) {
	return s.queryReviews(ctx, userID, `WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 200`)
}

// CourseReviewSummary averages a course's visible reviews.
func (s *PostgresStore) CourseReviewSummary(ctx context.Context, code string) (models.ReviewSummary, error) {
	var sum models.ReviewSummary
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int,
		       COALESCE(round(avg(difficulty), 1), 0)::float8, COALESCE(round(avg(workload), 1), 0)::float8,
		       COALESCE(round(avg(usefulness), 1), 0)::float8,
		       COALESCE(round(avg(interest), 1), 0)::float8, COALESCE(round(avg(practical), 1), 0)::float8,
		       COALESCE(round(avg(beginner), 1), 0)::float8,
		       COALESCE(round(100.0 * count(*) FILTER (WHERE recommend) / NULLIF(count(*), 0)), 0)::int
		FROM course_reviews r WHERE r.course_code = $1 AND `+reviewVisible, code).
		Scan(&sum.Count, &sum.Difficulty, &sum.Workload, &sum.Usefulness, &sum.Interest, &sum.Practical, &sum.Beginner, &sum.RecommendPct)
	return sum, err
}

// ReviewBriefs: for each of the courses that has visible reviews, how many,
// the share that recommend it and the average difficulty and usefulness.
func (s *PostgresStore) ReviewBriefs(ctx context.Context, codes []string) (map[string]models.ReviewBrief, error) {
	out := map[string]models.ReviewBrief{}
	if len(codes) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.course_code, count(*)::int, round(100.0 * count(*) FILTER (WHERE recommend) / count(*))::int,
		       round(avg(r.difficulty), 1)::float8, round(avg(r.usefulness), 1)::float8
		FROM course_reviews r WHERE r.course_code = ANY($1) AND `+reviewVisible+`
		GROUP BY r.course_code`, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var b models.ReviewBrief
		if err := rows.Scan(&code, &b.Count, &b.RecommendPct, &b.Difficulty, &b.Usefulness); err != nil {
			return nil, err
		}
		out[code] = b
	}
	return out, rows.Err()
}

// SetReviewStatus records a moderation result. With onlyIf / onlyText set,
// it changes only a review still in that status and with that text (a
// background check never overrides an admin's decision or a newer edit).
func (s *PostgresStore) SetReviewStatus(ctx context.Context, id int64, status, reason, onlyIf, onlyText string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE course_reviews SET status = $2, moderation_reason = $3
		 WHERE id = $1 AND ($4 = '' OR status = $4) AND ($5 = '' OR text = $5)`,
		id, status, reason, onlyIf, onlyText)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ReviewsBeingChecked lists reviews whose AI check had not finished (to resume at startup).
func (s *PostgresStore) ReviewsBeingChecked(ctx context.Context) ([]models.CourseReview, error) {
	return s.queryReviews(ctx, 0, `WHERE r.status = 'checking' AND $1::bigint IS NOT NULL ORDER BY r.id`)
}

// SetReviewHelpful marks or unmarks a review as helpful and returns its new
// count. ErrForbidden for your own review, ErrNotFound for one you can't see.
func (s *PostgresStore) SetReviewHelpful(ctx context.Context, id, userID int64, on bool) (int, error) {
	var owner int64
	err := s.pool.QueryRow(ctx, `SELECT r.user_id FROM course_reviews r WHERE r.id = $1 AND `+reviewVisible, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if owner == userID {
		return 0, ErrForbidden
	}
	if on {
		_, err = s.pool.Exec(ctx, `INSERT INTO review_helpful (review_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, userID)
	} else {
		_, err = s.pool.Exec(ctx, `DELETE FROM review_helpful WHERE review_id = $1 AND user_id = $2`, id, userID)
	}
	if err != nil {
		return 0, err
	}
	var n int
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM review_helpful WHERE review_id = $1`, id).Scan(&n)
	return n, err
}

// ReportReview files a report. ErrForbidden for your own review, ErrNotFound
// for one you can't see, ErrConflict if you already have an open report on it.
func (s *PostgresStore) ReportReview(ctx context.Context, id, userID int64, reason string) error {
	var owner int64
	err := s.pool.QueryRow(ctx, `SELECT r.user_id FROM course_reviews r WHERE r.id = $1 AND `+reviewVisible, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner == userID {
		return ErrForbidden
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO review_reports (review_id, user_id, reason) VALUES ($1, $2, $3)`, id, userID, reason)
	if isPgErrorCode(err, pgUniqueViolation) {
		return ErrConflict
	}
	return err
}

// ReviewsForAdmin lists reviews that need an admin: held by the moderation,
// or reported (open reports), oldest first.
func (s *PostgresStore) ReviewsForAdmin(ctx context.Context) ([]models.CourseReview, error) {
	return s.queryReviews(ctx, 0,
		`WHERE r.status = 'held' OR EXISTS (SELECT 1 FROM review_reports p WHERE p.review_id = r.id AND p.status = 'open')
		 ORDER BY r.created_at, r.id LIMIT 200`)
}

// ResolveReviewReports closes a review's open reports.
func (s *PostgresStore) ResolveReviewReports(ctx context.Context, id, by int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE review_reports SET status = 'resolved', resolved_at = now(), resolved_by = $2 WHERE review_id = $1 AND status = 'open'`, id, by)
	return err
}
