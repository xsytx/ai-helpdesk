package store

import (
	"context"
	_ "embed"
	"log"

	"campus-forum/internal/models"
)

//go:embed migrations/014_edits.sql
var editsSQL string

// saveRevision keeps the version an edit replaced (threadID or commentID is
// set). Best-effort: a failure doesn't undo the edit.
func (s *PostgresStore) saveRevision(ctx context.Context, threadID, commentID *int64, title, body string) {
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO post_revisions (thread_id, comment_id, title, body) VALUES ($1, $2, $3, $4)`,
		threadID, commentID, title, body,
	); err != nil {
		log.Printf("could not save the earlier version of a post: %v", err)
	}
}

// PostRevisions returns the earlier versions of a question (kind "thread")
// or an answer ("comment"), newest first.
func (s *PostgresStore) PostRevisions(ctx context.Context, kind string, id int64) ([]models.PostRevision, error) {
	column := "thread_id"
	if kind == "comment" {
		column = "comment_id"
	}
	rows, err := s.pool.Query(ctx,
		`SELECT title, body, replaced_at FROM post_revisions WHERE `+column+` = $1 ORDER BY replaced_at DESC, id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.PostRevision, 0)
	for rows.Next() {
		var r models.PostRevision
		if err := rows.Scan(&r.Title, &r.Body, &r.ReplacedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// notifyAnswerLiked tells an answer's author that voterID liked it (or,
// when liked is false, takes back that unread notice). Never for your own
// answer; repeated likes fold into one unread notice per question.
func (s *PostgresStore) notifyAnswerLiked(ctx context.Context, voterID, commentID int64, liked bool) {
	var err error
	if liked {
		_, err = s.pool.Exec(ctx,
			`INSERT INTO notifications (user_id, actor_id, type, thread_id, comment_id)
			 SELECT c.user_id, $1, 'answer_liked', c.thread_id, c.id FROM comments c WHERE c.id = $2 AND c.user_id <> $1
			 ON CONFLICT (user_id, thread_id, type) WHERE read_at IS NULL
			 DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id, created_at = now()`,
			voterID, commentID)
	} else {
		_, err = s.pool.Exec(ctx,
			`DELETE FROM notifications WHERE type = 'answer_liked' AND actor_id = $1 AND comment_id = $2 AND read_at IS NULL`,
			voterID, commentID)
	}
	if err != nil {
		log.Printf("could not update the like notification for comment %d: %v", commentID, err)
	}
}
