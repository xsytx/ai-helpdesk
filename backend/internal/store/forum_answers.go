package store

import (
	"context"
	_ "embed"

	"campus-forum/internal/models"
)

//go:embed migrations/011_forum_answers.sql
var forumAnswersSQL string

//go:embed migrations/012_chat_followups.sql
var chatFollowupsSQL string

//go:embed migrations/017_chat_source_comment.sql
var chatSourceCommentSQL string

// ForumAnswers returns published questions that have a trustworthy answer,
// for the AI chat to use (Stories 8-9): the accepted answer (or reply),
// otherwise the most-liked answer or reply with at least one like, or an
// answer by staff. A reply without likes ("thanks!") is never used. Only posts
// the moderation published ('ok', not still 'checking'). Accepted answers
// come first, then by likes, then the newest questions; at most limit.
func (s *PostgresStore) ForumAnswers(ctx context.Context, limit int) ([]models.ForumAnswer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.title, left(t.body, 400), left(best.body, 1500), best.accepted, best.score, best.staff, best.comment_id
		FROM threads t
		JOIN LATERAL (
			SELECT c.body, c.score,
			       COALESCE(c.id = t.accepted_comment_id, false) AS accepted,
			       u.role IN ('admin', 'moderator') AS staff,
			       c.id AS comment_id
			FROM comments c JOIN users u ON u.id = c.user_id
			WHERE c.thread_id = t.id AND c.moderation_status = 'ok'
			  AND (c.id = t.accepted_comment_id OR c.score >= 1
			       OR (u.role IN ('admin', 'moderator') AND c.parent_comment_id IS NULL))
			ORDER BY 3 DESC, c.score DESC, 4 DESC, c.created_at
			LIMIT 1
		) best ON true
		WHERE t.moderation_status = 'ok'
		ORDER BY best.accepted DESC, best.score DESC, t.created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.ForumAnswer, 0)
	for rows.Next() {
		var a models.ForumAnswer
		if err := rows.Scan(&a.ThreadID, &a.Title, &a.Body, &a.Answer, &a.Accepted, &a.Likes, &a.Staff, &a.CommentID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
