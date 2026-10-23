package store

import (
	"context"
	_ "embed"
	"time"

	"campus-forum/internal/models"
)

//go:embed migrations/006_chat_feedback.sql
var chatFeedbackSQL string

// RateChatMessage sets 👍 (1) / 👎 (-1) on one of the user's assistant
// messages, or clears it (0). ErrNotFound if it isn't theirs or isn't an answer.
func (s *PostgresStore) RateChatMessage(ctx context.Context, userID, messageID int64, value int) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE chat_messages
		 SET rating = NULLIF($3, 0)::smallint,
		     rated_at = CASE WHEN $3 = 0 THEN NULL ELSE now() END
		 WHERE id = $1 AND user_id = $2 AND role = 'assistant'`, messageID, userID, value)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ChatInsightKinds are the lists ChatInsights can return.
var ChatInsightKinds = []string{"disliked", "unanswered", "frequent"}

// The student's question that an answer replied to: the last question
// before it in the same conversation.
const insightQuestion = `COALESCE((SELECT u.text FROM chat_messages u
	WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.id < a.id
	ORDER BY u.id DESC LIMIT 1), '')`

// The question before that one: shown with follow-ups ("and how much is
// it?") so the admin knows what they were about.
const insightContext = `COALESCE((SELECT u.text FROM chat_messages u
	WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.id < a.id
	ORDER BY u.id DESC OFFSET 1 LIMIT 1), '')`

// normalizedQuestion groups the same question typed slightly differently
// (case, spaces, closing "?").
const normalizedQuestion = `lower(regexp_replace(regexp_replace(btrim(u.text), '\s+', ' ', 'g'), '[\s?!.…]+$', ''))`

// ChatInsights lists, for admins and without student names, chat items
// since a time:
//   - "disliked": answers a student marked 👎 (newest first);
//   - "unanswered": answers where the AI had nothing to say (basis "none");
//   - "frequent": questions asked by at least 2 students, most asked first
//     (questions answered from the FAQ are left out: they are covered).
func (s *PostgresStore) ChatInsights(ctx context.Context, kind string, since time.Time, limit int) ([]models.ChatInsight, error) {
	var q string
	switch kind {
	case "disliked", "unanswered":
		cond := `a.rating = -1`
		if kind == "unanswered" {
			cond = `a.basis = 'none'`
		}
		q = `SELECT a.id, ` + insightQuestion + `, ` + insightContext + `, a.text, a.language, 1, COALESCE(a.rated_at, a.created_at)
			FROM chat_messages a
			WHERE a.role = 'assistant' AND ` + cond + ` AND a.created_at >= $1
			ORDER BY 7 DESC LIMIT $2`
	case "frequent":
		q = `SELECT 0, (array_agg(u.text ORDER BY u.created_at DESC))[1], '', '', NULL::text,
			        count(DISTINCT u.user_id)::int, max(u.created_at)
			FROM chat_messages u
			WHERE u.role = 'user' AND u.created_at >= $1
			  AND NOT EXISTS (
			      SELECT 1 FROM chat_messages a
			      WHERE a.conversation_id = u.conversation_id AND a.basis = 'faq'
			        AND a.id = (SELECT min(x.id) FROM chat_messages x
			                    WHERE x.conversation_id = u.conversation_id AND x.id > u.id))
			GROUP BY ` + normalizedQuestion + `
			HAVING count(DISTINCT u.user_id) >= 2
			ORDER BY 6 DESC, 7 DESC LIMIT $2`
	default:
		return nil, ErrInvalidTarget
	}
	rows, err := s.pool.Query(ctx, q, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.ChatInsight{}
	for rows.Next() {
		var it models.ChatInsight
		if err := rows.Scan(&it.MessageID, &it.Question, &it.Context, &it.Answer, &it.Language, &it.Students, &it.At); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
