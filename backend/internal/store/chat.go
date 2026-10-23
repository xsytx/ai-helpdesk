package store

import (
	"context"
	_ "embed"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/003_chat.sql
var chatSQL string

// maxChatConversations caps the chat list; older ones still open by link.
const maxChatConversations = 200

const conversationColumns = "id, title, pinned, created_at, updated_at"

func scanConversation(row pgx.Row) (models.ChatConversation, error) {
	var c models.ChatConversation
	err := row.Scan(&c.ID, &c.Title, &c.Pinned, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

// --- AI chat: conversations ---

func (s *PostgresStore) CreateChatConversation(ctx context.Context, userID int64, title string) (models.ChatConversation, error) {
	return scanConversation(s.pool.QueryRow(ctx,
		`INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING `+conversationColumns,
		userID, title))
}

func (s *PostgresStore) GetChatConversation(ctx context.Context, userID, id int64) (models.ChatConversation, error) {
	return scanConversation(s.pool.QueryRow(ctx,
		`SELECT `+conversationColumns+` FROM chat_conversations WHERE id = $1 AND user_id = $2`, id, userID))
}

func (s *PostgresStore) ListChatConversations(ctx context.Context, userID int64) ([]models.ChatConversation, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+conversationColumns+` FROM chat_conversations
		 WHERE user_id = $1
		 ORDER BY pinned DESC, updated_at DESC, id DESC
		 LIMIT $2`, userID, maxChatConversations)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.ChatConversation{}
	for rows.Next() {
		c, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UpdateChatConversation(ctx context.Context, userID, id int64, title *string, pinned *bool) (models.ChatConversation, error) {
	return scanConversation(s.pool.QueryRow(ctx,
		`UPDATE chat_conversations
		 SET title = COALESCE($3, title), pinned = COALESCE($4, pinned)
		 WHERE id = $1 AND user_id = $2
		 RETURNING `+conversationColumns, id, userID, title, pinned))
}

func (s *PostgresStore) DeleteChatConversation(ctx context.Context, userID, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) DeleteStaleChatConversations(ctx context.Context, olderThan time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM chat_conversations WHERE NOT pinned AND updated_at < $1`, olderThan)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// --- AI chat: messages ---

const chatMessageColumns = "id, conversation_id, user_id, role, text, forum_answer, ai_explanation, basis, language, rating, created_at"

func scanChatMessage(row pgx.Row) (models.ChatMessage, error) {
	var m models.ChatMessage
	err := row.Scan(&m.ID, &m.ConversationID, &m.UserID, &m.Role, &m.Text, &m.ForumAnswer, &m.AIExplanation, &m.Basis, &m.Language, &m.Rating, &m.CreatedAt)
	return m, err
}

// CreateChatMessage adds a message to one of the user's conversations and
// marks the conversation as active now (ErrNotFound if it is not theirs or
// was deleted meanwhile).
func (s *PostgresStore) CreateChatMessage(ctx context.Context, userID int64, msg models.ChatMessage) (models.ChatMessage, error) {
	m, err := scanChatMessage(s.pool.QueryRow(ctx,
		`WITH conv AS (
		     UPDATE chat_conversations SET updated_at = now()
		     WHERE id = $1 AND user_id = $2
		     RETURNING id
		 )
		 INSERT INTO chat_messages (conversation_id, user_id, role, text, forum_answer, ai_explanation, basis, language)
		 SELECT conv.id, $2, $3, $4, $5, $6, $7, $8 FROM conv
		 RETURNING `+chatMessageColumns,
		msg.ConversationID, userID, msg.Role, msg.Text, msg.ForumAnswer, msg.AIExplanation, msg.Basis, msg.Language,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

// ListChatMessages returns a conversation's messages oldest first
// (ErrNotFound if the conversation is not the user's).
func (s *PostgresStore) ListChatMessages(ctx context.Context, userID, conversationID int64) ([]models.ChatMessage, error) {
	if _, err := s.GetChatConversation(ctx, userID, conversationID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+chatMessageColumns+` FROM chat_messages
		 WHERE conversation_id = $1
		 ORDER BY created_at, id`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.ChatMessage{}
	for rows.Next() {
		m, err := scanChatMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
