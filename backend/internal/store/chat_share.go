package store

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/013_chat_trust_share.sql
var chatTrustShareSQL string

// ShareChatConversation turns on the read-only link of one of the user's
// chats and returns its token (the same one if it is already shared).
func (s *PostgresStore) ShareChatConversation(ctx context.Context, userID, id int64) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	var token string
	err := s.pool.QueryRow(ctx,
		`UPDATE chat_conversations SET share_token = COALESCE(share_token, $3)
		 WHERE id = $1 AND user_id = $2 RETURNING share_token`,
		id, userID, base64.RawURLEncoding.EncodeToString(raw)).Scan(&token)
	return token, rowsToNotFound(err)
}

// UnshareChatConversation turns the link off; the old link stops working.
func (s *PostgresStore) UnshareChatConversation(ctx context.Context, userID, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE chat_conversations SET share_token = NULL WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SharedChat returns a shared chat and its messages by link token
// (ErrNotFound if there is no such link).
func (s *PostgresStore) SharedChat(ctx context.Context, token string) (models.ChatConversation, []models.ChatMessage, error) {
	var userID int64
	var conv models.ChatConversation
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, `+conversationColumns+` FROM chat_conversations WHERE share_token = $1`, token,
	).Scan(&userID, &conv.ID, &conv.Title, &conv.Pinned, &conv.CreatedAt, &conv.UpdatedAt, &conv.ShareToken)
	if err != nil {
		return conv, nil, rowsToNotFound(err)
	}
	msgs, err := s.ListChatMessages(ctx, userID, conv.ID)
	return conv, msgs, err
}

// rowsToNotFound maps "no row" to ErrNotFound.
func rowsToNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
