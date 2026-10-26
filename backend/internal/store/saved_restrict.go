package store

import (
	"context"
	_ "embed"
	"time"

	"campus-forum/internal/models"
)

//go:embed migrations/015_saved_restrict.sql
var savedRestrictSQL string

// notBanned is true for users without a ban in force (SQL, table users u).
const notBanned = `(u.banned_at IS NULL OR u.ban_until <= now())`

// --- Saved questions ---

// SetThreadSaved adds a question to the user's saved ones, or removes it.
func (s *PostgresStore) SetThreadSaved(ctx context.Context, userID, threadID int64, saved bool) error {
	if !saved {
		_, err := s.pool.Exec(ctx, `DELETE FROM saved_threads WHERE user_id = $1 AND thread_id = $2`, userID, threadID)
		return err
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO saved_threads (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, threadID)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return ErrNotFound
	}
	return err
}

func (s *PostgresStore) IsThreadSaved(ctx context.Context, userID, threadID int64) (bool, error) {
	var saved bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM saved_threads WHERE user_id = $1 AND thread_id = $2)`, userID, threadID).Scan(&saved)
	return saved, err
}

// ListSavedThreads returns the user's saved questions, last saved first
// (visible ones only, at most limit).
func (s *PostgresStore) ListSavedThreads(ctx context.Context, userID int64, limit int) ([]models.Thread, error) {
	rows, err := s.pool.Query(ctx, threadSelect+`
		JOIN saved_threads st ON st.thread_id = t.id AND st.user_id = $1
		WHERE `+threadVisible+`
		ORDER BY st.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.Thread, 0)
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- Mute and ban ---

// RestrictUser mutes (kind "mute") or bans ("ban") a user until until (nil
// = no end), with a reason. Setting it again replaces the earlier one.
func (s *PostgresStore) RestrictUser(ctx context.Context, id int64, kind string, until *time.Time, reason string) error {
	q := `UPDATE users SET muted_at = now(), mute_until = $2, mute_reason = $3 WHERE id = $1`
	if kind == "ban" {
		q = `UPDATE users SET banned_at = now(), ban_until = $2, ban_reason = $3 WHERE id = $1`
	}
	tag, err := s.pool.Exec(ctx, q, id, until, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LiftRestriction ends a user's mute or ban now.
func (s *PostgresStore) LiftRestriction(ctx context.Context, id int64, kind string) error {
	q := `UPDATE users SET muted_at = NULL, mute_until = NULL, mute_reason = '' WHERE id = $1`
	if kind == "ban" {
		q = `UPDATE users SET banned_at = NULL, ban_until = NULL, ban_reason = '' WHERE id = $1`
	}
	tag, err := s.pool.Exec(ctx, q, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListRestrictedUsers returns everyone with a mute or ban in force, the
// most recent first.
func (s *PostgresStore) ListRestrictedUsers(ctx context.Context) ([]models.RestrictedUser, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, display_name, email, avatar, kind, since, until, reason FROM (
			SELECT u.id, u.display_name, u.email, u.avatar, 'ban' AS kind, u.banned_at AS since, u.ban_until AS until, u.ban_reason AS reason
			FROM users u WHERE u.banned_at IS NOT NULL AND (u.ban_until IS NULL OR u.ban_until > now())
			UNION ALL
			SELECT u.id, u.display_name, u.email, u.avatar, 'mute', u.muted_at, u.mute_until, u.mute_reason
			FROM users u WHERE u.muted_at IS NOT NULL AND (u.mute_until IS NULL OR u.mute_until > now())
		) r ORDER BY since DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.RestrictedUser, 0)
	for rows.Next() {
		var r models.RestrictedUser
		if err := rows.Scan(&r.UserID, &r.DisplayName, &r.Email, &r.Avatar, &r.Kind, &r.Since, &r.Until, &r.Reason); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
