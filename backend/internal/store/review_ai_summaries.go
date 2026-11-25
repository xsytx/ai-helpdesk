package store

import (
	"context"
	_ "embed"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/028_review_ai_summaries.sql
var reviewAISummariesSQL string

// ReviewsForAISummary returns the reviews an AI summary of a course is made
// from: published ones only (never "checking", held or rejected: a summary
// must not repeat a text the moderation may still hide), most helpful and
// newest first, at most limit. fingerprint identifies all of them and their
// versions (an edit changes it); count is how many there are in all.
func (s *PostgresStore) ReviewsForAISummary(ctx context.Context, code string, limit int) ([]models.CourseReview, string, int, error) {
	var fingerprint string
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int, COALESCE(md5(string_agg(id::text || ':' || extract(epoch FROM COALESCE(edited_at, created_at))::text, ',' ORDER BY id)), '')
		FROM course_reviews WHERE course_code = $1 AND status = 'ok'`, code).Scan(&count, &fingerprint)
	if err != nil || count == 0 || limit <= 0 {
		return []models.CourseReview{}, fingerprint, count, err
	}
	list, err := s.queryReviews(ctx, 0, `WHERE r.course_code = $2 AND r.status = 'ok'
		ORDER BY (SELECT count(*) FROM review_helpful h WHERE h.review_id = r.id) DESC, r.created_at DESC, r.id DESC LIMIT $3`,
		code, limit)
	return list, fingerprint, count, err
}

// GetReviewAISummary returns the saved summary of a course in a language
// (ErrNotFound when there is none yet).
func (s *PostgresStore) GetReviewAISummary(ctx context.Context, code, lang string) (models.ReviewAISummary, error) {
	v := models.ReviewAISummary{Liked: []string{}, Warnings: []string{}}
	err := s.pool.QueryRow(ctx, `
		SELECT fingerprint, review_count, summary, liked, warnings, created_at
		FROM course_review_summaries WHERE course_code = $1 AND lang = $2`, code, lang).
		Scan(&v.Fingerprint, &v.ReviewCount, &v.Summary, &v.Liked, &v.Warnings, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	return v, err
}

// SaveReviewAISummary stores (or replaces) a course's summary in a language.
func (s *PostgresStore) SaveReviewAISummary(ctx context.Context, code, lang string, v models.ReviewAISummary) (models.ReviewAISummary, error) {
	if v.Liked == nil {
		v.Liked = []string{}
	}
	if v.Warnings == nil {
		v.Warnings = []string{}
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO course_review_summaries (course_code, lang, fingerprint, review_count, summary, liked, warnings)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (course_code, lang) DO UPDATE SET fingerprint = EXCLUDED.fingerprint,
			review_count = EXCLUDED.review_count, summary = EXCLUDED.summary, liked = EXCLUDED.liked,
			warnings = EXCLUDED.warnings, created_at = now()
		RETURNING created_at`, code, lang, v.Fingerprint, v.ReviewCount, v.Summary, v.Liked, v.Warnings).Scan(&v.CreatedAt)
	return v, err
}
