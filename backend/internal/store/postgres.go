package store

import (
	"context"
	"crypto/subtle"
	_ "embed"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"campus-forum/internal/models"
)

//go:embed migrations/001_init.sql
var schemaSQL string

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
)

// PostgresStore is a PostgreSQL-backed Store implementation, using pgx's
// connection pool. All queries run against the schema in
// internal/store/migrations/001_init.sql.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore connects to Postgres at databaseURL and verifies the
// connection with a ping. Call Migrate to apply the schema, and Close
// when done.
func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresStore{pool: pool}, nil
}

// Migrate applies the embedded schema. Every statement in it is
// idempotent (CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING), so
// this is safe to call every time the server starts.
func (s *PostgresStore) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, schemaSQL)
	return err
}

// Close releases the underlying connection pool.
func (s *PostgresStore) Close() {
	s.pool.Close()
}

func isPgErrorCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}

// --- Users ---

const userColumns = "id, email, display_name, role, banned_at, email_verified_at, major, bio, created_at"

func scanUser(row pgx.Row) (models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.BannedAt, &u.EmailVerifiedAt, &u.Major, &u.Bio, &u.CreatedAt)
	return u, err
}

func (s *PostgresStore) CreateUser(ctx context.Context, email, displayName, passwordHash, salt string) (models.User, error) {
	q := `
		INSERT INTO users (email, display_name, password_hash, salt)
		VALUES ($1, $2, $3, $4)
		RETURNING ` + userColumns
	u, err := scanUser(s.pool.QueryRow(ctx, q, email, displayName, passwordHash, salt))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			if pgErr.ConstraintName == "idx_users_display_name_lower" {
				return models.User{}, ErrUsernameTaken
			}
			return models.User{}, ErrConflict
		}
		return models.User{}, err
	}
	u.PasswordHash = passwordHash
	u.Salt = salt
	return u, nil
}

func (s *PostgresStore) GetUserByEmail(ctx context.Context, email string) (models.User, error) {
	q := `SELECT password_hash, salt, ` + userColumns + ` FROM users WHERE email = $1`
	var u models.User
	err := s.pool.QueryRow(ctx, q, email).Scan(&u.PasswordHash, &u.Salt,
		&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.BannedAt, &u.EmailVerifiedAt, &u.Major, &u.Bio, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (s *PostgresStore) GetUserByID(ctx context.Context, id int64) (models.User, error) {
	q := `SELECT password_hash, salt, ` + userColumns + ` FROM users WHERE id = $1`
	var u models.User
	err := s.pool.QueryRow(ctx, q, id).Scan(&u.PasswordHash, &u.Salt,
		&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.BannedAt, &u.EmailVerifiedAt, &u.Major, &u.Bio, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	if err != nil {
		return models.User{}, err
	}
	return u, nil
}

// UpdateProfile updates a user's display name and the profile fields
// shown on their public profile.
func (s *PostgresStore) UpdateProfile(ctx context.Context, userID int64, displayName, major, bio string) (models.User, error) {
	q := `
		UPDATE users SET display_name = $1, major = $2, bio = $3
		WHERE id = $4
		RETURNING ` + userColumns
	u, err := scanUser(s.pool.QueryRow(ctx, q, displayName, major, bio, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	if isPgErrorCode(err, pgUniqueViolation) {
		return models.User{}, ErrUsernameTaken
	}
	return u, err
}

// SetUserBanned toggles whether a user can log in.
func (s *PostgresStore) SetUserBanned(ctx context.Context, id int64, banned bool) error {
	const q = `UPDATE users SET banned_at = CASE WHEN $2 THEN COALESCE(banned_at, now()) ELSE NULL END WHERE id = $1`
	tag, err := s.pool.Exec(ctx, q, id, banned)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// PromoteAdmins sets role='admin' for every user whose email is in emails.
// Used at startup to bootstrap admin accounts from ADMIN_EMAILS — there's
// no API for granting admin, on purpose, since that's not something a
// regular authenticated request should ever be able to do to itself.
func (s *PostgresStore) PromoteAdmins(ctx context.Context, emails []string) error {
	if len(emails) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `UPDATE users SET role = 'admin' WHERE email = ANY($1)`, emails)
	return err
}

func (s *PostgresStore) ListThreadsByUser(ctx context.Context, userID int64, page, pageSize int) ([]models.Thread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM threads WHERE user_id = $1`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := threadSelect + ` WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Thread, 0)
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

func (s *PostgresStore) ListCommentsByUser(ctx context.Context, userID int64, page, pageSize int) ([]models.CommentWithThread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM comments WHERE user_id = $1`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	const q = `
		SELECT c.id, c.thread_id, c.user_id, u.display_name, c.parent_comment_id, c.body, c.score, c.created_at,
		       t.title
		FROM comments c
		JOIN users u ON u.id = c.user_id
		JOIN threads t ON t.id = c.thread_id
		WHERE c.user_id = $1
		ORDER BY c.created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.CommentWithThread, 0)
	for rows.Next() {
		var c models.CommentWithThread
		if err := rows.Scan(&c.ID, &c.ThreadID, &c.UserID, &c.AuthorName, &c.ParentCommentID, &c.Body, &c.Score, &c.CreatedAt,
			&c.ThreadTitle); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

// Stats returns platform-wide counts for the home feed's stats panel.
func (s *PostgresStore) Stats(ctx context.Context) (models.Stats, error) {
	var st models.Stats
	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT COUNT(*) FROM users),
		       (SELECT COUNT(*) FROM threads),
		       (SELECT COUNT(*) FROM comments),
		       (SELECT COUNT(*) FROM tags)`,
	).Scan(&st.Users, &st.Threads, &st.Comments, &st.Tags)
	return st, err
}

// --- Threads ---

// threadSelect aggregates each thread's tags via array_agg so every
// listing (feed, search, by-tag, by-user, upcoming events, and the
// detail view) carries its tags without an N+1 query per row — tags are
// the only organizing structure now that boards/categories are gone, so
// showing them everywhere a thread appears matters more than it would
// have as a secondary label.
const threadSelect = `
	SELECT t.id, t.user_id, u.display_name, t.title, t.body, t.score, t.locked_at,
	       t.created_at, COALESCE(cc.cnt, 0),
	       COALESCE(tgs.tags, ARRAY[]::text[])
	FROM threads t
	JOIN users u ON u.id = t.user_id
	LEFT JOIN (SELECT thread_id, COUNT(*) AS cnt FROM comments GROUP BY thread_id) cc
	       ON cc.thread_id = t.id
	LEFT JOIN (
		SELECT tt.thread_id, array_agg(tg.name ORDER BY tg.name) AS tags
		FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id
		GROUP BY tt.thread_id
	) tgs ON tgs.thread_id = t.id`

func scanThread(row pgx.Row) (models.Thread, error) {
	var t models.Thread
	err := row.Scan(&t.ID, &t.UserID, &t.AuthorName, &t.Title, &t.Body, &t.Score, &t.LockedAt,
		&t.CreatedAt, &t.CommentCnt, &t.Tags)
	return t, err
}

func (s *PostgresStore) attachAttachments(ctx context.Context, t *models.Thread) error {
	atts, err := s.ListAttachments(ctx, t.ID)
	if err != nil {
		return err
	}
	t.Attachments = atts
	return nil
}

// threadOrderBy maps a public sort name to its ORDER BY clause. Ties always
// break on created_at DESC so the order stays stable.
func threadOrderBy(sort string) string {
	switch sort {
	case "top":
		return "ORDER BY t.score DESC, t.created_at DESC"
	case "comments":
		return "ORDER BY COALESCE(cc.cnt, 0) DESC, t.created_at DESC"
	default:
		return "ORDER BY t.created_at DESC"
	}
}

// ListFeed pages through every thread — the home feed.
func (s *PostgresStore) ListFeed(ctx context.Context, sort string, page, pageSize int) ([]models.Thread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM threads`).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := threadSelect + ` ` + threadOrderBy(sort) + ` LIMIT $1 OFFSET $2`
	rows, err := s.pool.Query(ctx, q, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Thread, 0)
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

// searchVector is thread title+body as a weighted tsvector — a match in
// the title ('A' weight) outranks the same match in the body ('B'). Kept
// as its own const so the query and the idx_threads_search_weighted
// index expression stay in exact sync (Postgres only uses an expression
// index when the query's expression matches it, not just its meaning).
const searchVector = `(setweight(to_tsvector('simple', t.title), 'A') || setweight(to_tsvector('simple', t.body), 'B'))`

// searchMatch is the shared match condition used by both the count and
// the data query in SearchThreads, so they never drift out of sync. It's
// full-text search OR a trigram word-similarity match against the title
// (<%: does $1 resemble some substring of the title?) — the latter
// catches partial words and small typos ("hous", "houseing") inside a
// longer title that full-text search's whole-token matching alone would
// miss; plain similarity() would compare against the whole title string
// and rarely clear the threshold for a short query.
const searchMatch = `(` + searchVector + ` @@ websearch_to_tsquery('simple', $1) OR $1 <% t.title)`

func (s *PostgresStore) SearchThreads(ctx context.Context, q string, page, pageSize int) ([]models.Thread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	where := `WHERE ` + searchMatch
	args := []any{q}

	var total int
	countQ := `SELECT COUNT(*) FROM threads t ` + where
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	dataQ := fmt.Sprintf(
		threadSelect+` %s ORDER BY GREATEST(ts_rank(`+searchVector+`, websearch_to_tsquery('simple', $1)), word_similarity($1, t.title)) DESC, t.created_at DESC LIMIT $%d OFFSET $%d`,
		where, limitArg, offsetArg,
	)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Thread, 0)
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

// setThreadTags replaces threadID's tag set with names, creating any tag
// row that doesn't exist yet. An empty/nil names just clears the tags.
func (s *PostgresStore) setThreadTags(ctx context.Context, threadID int64, names []string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM thread_tags WHERE thread_id = $1`, threadID); err != nil {
		return err
	}
	for _, name := range names {
		if name == "" {
			continue
		}
		var tagID int64
		err := s.pool.QueryRow(ctx, `
			INSERT INTO tags (name) VALUES ($1)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id`, name,
		).Scan(&tagID)
		if err != nil {
			return err
		}
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO thread_tags (thread_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			threadID, tagID,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *PostgresStore) CreateThread(ctx context.Context, userID int64, in ThreadInput) (models.Thread, error) {
	const q = `
		INSERT INTO threads (user_id, title, body)
		VALUES ($1, $2, $3)
		RETURNING id`
	var id int64
	err := s.pool.QueryRow(ctx, q, userID, in.Title, in.Body).Scan(&id)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.Thread{}, ErrNotFound
	}
	if err != nil {
		return models.Thread{}, err
	}
	if err := s.setThreadTags(ctx, id, in.Tags); err != nil {
		return models.Thread{}, err
	}
	// The author automatically follows their own thread — see
	// CreateComment for the notification side of subscriptions.
	if err := s.SubscribeThread(ctx, userID, id); err != nil {
		log.Printf("could not auto-subscribe user %d to thread %d: %v", userID, id, err)
	}
	return s.GetThread(ctx, id)
}

func (s *PostgresStore) GetThread(ctx context.Context, id int64) (models.Thread, error) {
	q := threadSelect + ` WHERE t.id = $1`
	t, err := scanThread(s.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Thread{}, ErrNotFound
	}
	if err != nil {
		return models.Thread{}, err
	}
	if err := s.attachAttachments(ctx, &t); err != nil {
		return models.Thread{}, err
	}
	return t, nil
}

func (s *PostgresStore) UpdateThread(ctx context.Context, id, userID int64, in ThreadInput) (models.Thread, error) {
	const q = `UPDATE threads SET title = $1, body = $2 WHERE id = $3 AND user_id = $4`
	tag, err := s.pool.Exec(ctx, q, in.Title, in.Body, id, userID)
	if err != nil {
		return models.Thread{}, err
	}
	if tag.RowsAffected() == 0 {
		return models.Thread{}, s.ownershipErr(ctx, "threads", id)
	}
	if err := s.setThreadTags(ctx, id, in.Tags); err != nil {
		return models.Thread{}, err
	}
	return s.GetThread(ctx, id)
}

func (s *PostgresStore) DeleteThread(ctx context.Context, id, userID int64) error {
	const q = `DELETE FROM threads WHERE id = $1 AND user_id = $2`
	tag, err := s.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.ownershipErr(ctx, "threads", id)
	}
	return nil
}

// ownershipErr is called after an owner-scoped UPDATE/DELETE affects zero
// rows, to tell apart "doesn't exist" (ErrNotFound) from "exists but
// belongs to someone else" (ErrForbidden).
func (s *PostgresStore) ownershipErr(ctx context.Context, table string, id int64) error {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM `+table+` WHERE id = $1)`, id).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return ErrForbidden
}

// --- Comments ---

const commentSelect = `
	SELECT c.id, c.thread_id, c.user_id, u.display_name, c.parent_comment_id, c.body, c.score, c.created_at
	FROM comments c
	JOIN users u ON u.id = c.user_id`

func scanComment(row pgx.Row) (models.Comment, error) {
	var c models.Comment
	err := row.Scan(&c.ID, &c.ThreadID, &c.UserID, &c.AuthorName, &c.ParentCommentID, &c.Body, &c.Score, &c.CreatedAt)
	return c, err
}

func (s *PostgresStore) ListComments(ctx context.Context, threadID int64) ([]models.Comment, error) {
	q := commentSelect + ` WHERE c.thread_id = $1 ORDER BY c.created_at ASC`
	rows, err := s.pool.Query(ctx, q, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Comment, 0)
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateComment(ctx context.Context, threadID, userID int64, body string, parentCommentID *int64) (models.Comment, error) {
	var locked bool
	err := s.pool.QueryRow(ctx, `SELECT locked_at IS NOT NULL FROM threads WHERE id = $1`, threadID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Comment{}, ErrNotFound
	}
	if err != nil {
		return models.Comment{}, err
	}
	if locked {
		return models.Comment{}, ErrLocked
	}

	// A reply must target a comment that actually belongs to this thread —
	// otherwise the reply tree could straddle two threads.
	if parentCommentID != nil {
		var parentThreadID int64
		err := s.pool.QueryRow(ctx, `SELECT thread_id FROM comments WHERE id = $1`, *parentCommentID).Scan(&parentThreadID)
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Comment{}, ErrNotFound
		}
		if err != nil {
			return models.Comment{}, err
		}
		if parentThreadID != threadID {
			return models.Comment{}, ErrInvalidTarget
		}
	}

	const q = `
		INSERT INTO comments (thread_id, user_id, parent_comment_id, body)
		VALUES ($1, $2, $3, $4)
		RETURNING id`
	var id int64
	err = s.pool.QueryRow(ctx, q, threadID, userID, parentCommentID, body).Scan(&id)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.Comment{}, ErrNotFound
	}
	if err != nil {
		return models.Comment{}, err
	}

	// Commenting auto-subscribes you to the thread (Reddit-style
	// "participate to follow"); harmless if you already are.
	if err := s.SubscribeThread(ctx, userID, threadID); err != nil {
		log.Printf("could not auto-subscribe user %d to thread %d: %v", userID, threadID, err)
	}

	// Notify: (1) the parent comment's author specifically, if this is a
	// reply, and (2) every other subscriber of the thread — which, thanks
	// to auto-subscription, covers the thread's author for both top-level
	// comments and replies, without a special case for either. Both steps
	// exclude the commenter, and step 2 also excludes whoever step 1
	// already notified, so nobody gets a duplicate for the same event.
	// Both INSERTs land on idx_notifications_unread_dedupe (user_id,
	// thread_id, type WHERE read_at IS NULL): if the recipient already has
	// an unread notification of that type for this thread, this new event
	// collapses into it (fresh actor/comment, bumped created_at) instead of
	// piling up a second row — once they read it, the next event starts a
	// new one. Best-effort throughout: a failure here shouldn't fail the
	// comment.
	var parentAuthorID int64 = -1
	if parentCommentID != nil {
		row := s.pool.QueryRow(ctx,
			`INSERT INTO notifications (user_id, actor_id, type, thread_id, comment_id)
			 SELECT pc.user_id, $2, 'reply_to_comment', $1, $3
			 FROM comments pc WHERE pc.id = $4 AND pc.user_id <> $2
			 ON CONFLICT (user_id, thread_id, type) WHERE read_at IS NULL
			 DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id, created_at = now()
			 RETURNING user_id`,
			threadID, userID, id, *parentCommentID)
		if serr := row.Scan(&parentAuthorID); serr != nil && !errors.Is(serr, pgx.ErrNoRows) {
			log.Printf("could not create reply notification for comment %d: %v", id, serr)
		}
	}
	if _, nerr := s.pool.Exec(ctx,
		`INSERT INTO notifications (user_id, actor_id, type, thread_id, comment_id)
		 SELECT s.user_id, $2, 'comment_on_thread', $1, $3
		 FROM subscriptions s
		 WHERE s.thread_id = $1 AND s.user_id <> $2 AND s.user_id <> $4
		 ON CONFLICT (user_id, thread_id, type) WHERE read_at IS NULL
		 DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id, created_at = now()`,
		threadID, userID, id, parentAuthorID,
	); nerr != nil {
		log.Printf("could not create subscriber notifications for comment %d on thread %d: %v", id, threadID, nerr)
	}

	c, err := scanComment(s.pool.QueryRow(ctx, commentSelect+` WHERE c.id = $1`, id))
	if err != nil {
		return models.Comment{}, err
	}
	return c, nil
}

func (s *PostgresStore) getCommentByID(ctx context.Context, id int64) (models.Comment, error) {
	c, err := scanComment(s.pool.QueryRow(ctx, commentSelect+` WHERE c.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Comment{}, ErrNotFound
	}
	return c, err
}

func (s *PostgresStore) UpdateComment(ctx context.Context, id, userID int64, body string) (models.Comment, error) {
	const q = `UPDATE comments SET body = $1 WHERE id = $2 AND user_id = $3`
	tag, err := s.pool.Exec(ctx, q, body, id, userID)
	if err != nil {
		return models.Comment{}, err
	}
	if tag.RowsAffected() == 0 {
		return models.Comment{}, s.ownershipErr(ctx, "comments", id)
	}
	return s.getCommentByID(ctx, id)
}

func (s *PostgresStore) DeleteComment(ctx context.Context, id, userID int64) error {
	const q = `DELETE FROM comments WHERE id = $1 AND user_id = $2`
	tag, err := s.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.ownershipErr(ctx, "comments", id)
	}
	return nil
}

// --- Votes ---

// Vote records/updates/removes a user's vote on a thread or comment and
// returns the target's resulting score. Calling with the same value again
// removes the vote (toggle behaviour); a different value flips it. The
// read-modify-write is done inside a transaction with the vote row and
// the target row locked, so concurrent votes on the same target
// serialize correctly.
func (s *PostgresStore) Vote(ctx context.Context, userID int64, targetType string, targetID int64, value int) (int, error) {
	if targetType != "thread" && targetType != "comment" {
		return 0, ErrInvalidTarget
	}
	if value != 1 && value != -1 {
		return 0, ErrInvalidTarget
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var existing int
	err = tx.QueryRow(ctx,
		`SELECT value FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3 FOR UPDATE`,
		userID, targetType, targetID,
	).Scan(&existing)

	var delta int
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		delta = value
		_, err = tx.Exec(ctx,
			`INSERT INTO votes (user_id, target_type, target_id, value) VALUES ($1, $2, $3, $4)`,
			userID, targetType, targetID, value)
	case err != nil:
		return 0, err
	case existing == value:
		delta = -value
		_, err = tx.Exec(ctx,
			`DELETE FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
			userID, targetType, targetID)
	default:
		delta = 2 * value
		_, err = tx.Exec(ctx,
			`UPDATE votes SET value = $4 WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
			userID, targetType, targetID, value)
	}
	if err != nil {
		return 0, err
	}

	table := "threads"
	if targetType == "comment" {
		table = "comments"
	}
	var score int
	err = tx.QueryRow(ctx,
		`UPDATE `+table+` SET score = score + $1 WHERE id = $2 RETURNING score`,
		delta, targetID,
	).Scan(&score)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return score, nil
}

// --- Notifications ---

func (s *PostgresStore) ListNotifications(ctx context.Context, userID int64, page, pageSize int) ([]models.Notification, int, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	var total, unread int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE read_at IS NULL) FROM notifications WHERE user_id = $1`,
		userID,
	).Scan(&total, &unread); err != nil {
		return nil, 0, 0, err
	}

	const q = `
		SELECT n.id, n.type, n.thread_id, t.title, n.comment_id, n.actor_id, u.display_name,
		       (n.read_at IS NOT NULL), n.created_at
		FROM notifications n
		JOIN threads t ON t.id = n.thread_id
		JOIN users u ON u.id = n.actor_id
		WHERE n.user_id = $1
		ORDER BY n.created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()

	out := make([]models.Notification, 0)
	for rows.Next() {
		var n models.Notification
		if err := rows.Scan(&n.ID, &n.Type, &n.ThreadID, &n.ThreadTitle, &n.CommentID, &n.ActorID, &n.ActorName,
			&n.Read, &n.CreatedAt); err != nil {
			return nil, 0, 0, err
		}
		out = append(out, n)
	}
	return out, total, unread, rows.Err()
}

// UnreadNotificationCount is a cheap standalone count for the header
// bell badge — it skips the ListNotifications JOIN query entirely.
func (s *PostgresStore) UnreadNotificationCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID,
	).Scan(&n)
	return n, err
}

func (s *PostgresStore) MarkNotificationRead(ctx context.Context, id, userID int64) error {
	// COALESCE keeps the original read_at (rather than bumping it) if the
	// notification was already read, so repeat clicks are harmless.
	const q = `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`
	tag, err := s.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return s.ownershipErr(ctx, "notifications", id)
	}
	return nil
}

func (s *PostgresStore) MarkAllNotificationsRead(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
	return err
}

// --- Moderation ---

func (s *PostgresStore) AdminDeleteThread(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM threads WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) AdminDeleteComment(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM comments WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) SetThreadLocked(ctx context.Context, id int64, locked bool) error {
	const q = `UPDATE threads SET locked_at = CASE WHEN $2 THEN COALESCE(locked_at, now()) ELSE NULL END WHERE id = $1`
	tag, err := s.pool.Exec(ctx, q, id, locked)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) CreateReport(ctx context.Context, reporterID int64, targetType string, targetID int64, reason string) (models.Report, error) {
	if targetType != "thread" && targetType != "comment" {
		return models.Report{}, ErrInvalidTarget
	}
	table := "threads"
	if targetType == "comment" {
		table = "comments"
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM `+table+` WHERE id = $1)`, targetID).Scan(&exists); err != nil {
		return models.Report{}, err
	}
	if !exists {
		return models.Report{}, ErrNotFound
	}

	const q = `
		INSERT INTO reports (reporter_id, target_type, target_id, reason)
		VALUES ($1, $2, $3, $4)
		RETURNING id`
	var id int64
	if err := s.pool.QueryRow(ctx, q, reporterID, targetType, targetID, reason).Scan(&id); err != nil {
		return models.Report{}, err
	}
	return s.getReportByID(ctx, id)
}

// reportSelect resolves each report's reporter name and a preview of its
// target — the thread's title, or the comment's body plus its parent
// thread's id (via the ct alias) — falling back to "[deleted]"/0 if the
// target has since been removed.
const reportSelect = `
	SELECT r.id, r.reporter_id, ru.display_name, r.target_type, r.target_id, r.reason, r.status,
	       COALESCE(t.title, c.body, '[deleted]'),
	       COALESCE(t.id, ct.id, 0),
	       r.created_at, r.resolved_at
	FROM reports r
	JOIN users ru ON ru.id = r.reporter_id
	LEFT JOIN threads t ON r.target_type = 'thread' AND t.id = r.target_id
	LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
	LEFT JOIN threads ct ON ct.id = c.thread_id`

func scanReport(row pgx.Row) (models.Report, error) {
	var r models.Report
	err := row.Scan(&r.ID, &r.ReporterID, &r.ReporterName, &r.TargetType, &r.TargetID, &r.Reason, &r.Status,
		&r.Preview, &r.ThreadID, &r.CreatedAt, &r.ResolvedAt)
	return r, err
}

func (s *PostgresStore) getReportByID(ctx context.Context, id int64) (models.Report, error) {
	r, err := scanReport(s.pool.QueryRow(ctx, reportSelect+` WHERE r.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Report{}, ErrNotFound
	}
	return r, err
}

func (s *PostgresStore) ListReports(ctx context.Context, status string, page, pageSize int) ([]models.Report, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	where := ""
	args := []any{}
	if status != "" {
		where = "WHERE r.status = $1"
		args = append(args, status)
	}

	var total int
	countQ := `SELECT COUNT(*) FROM reports r ` + where
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	dataQ := fmt.Sprintf(reportSelect+` %s ORDER BY r.created_at DESC LIMIT $%d OFFSET $%d`, where, limitArg, offsetArg)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Report, 0)
	for rows.Next() {
		r, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func (s *PostgresStore) ResolveReport(ctx context.Context, id int64) error {
	const q = `UPDATE reports SET status = 'resolved', resolved_at = now() WHERE id = $1`
	tag, err := s.pool.Exec(ctx, q, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- FAQ ---

func scanFAQ(row pgx.Row) (models.FAQ, error) {
	var f models.FAQ
	err := row.Scan(&f.ID, &f.Question, &f.Answer, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt)
	return f, err
}

func (s *PostgresStore) ListFAQs(ctx context.Context) ([]models.FAQ, error) {
	const q = `SELECT id, question, answer, sort_order, created_at, updated_at FROM faqs ORDER BY sort_order, id`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.FAQ, 0)
	for rows.Next() {
		f, err := scanFAQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateFAQ(ctx context.Context, question, answer string, sortOrder int) (models.FAQ, error) {
	const q = `
		INSERT INTO faqs (question, answer, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, question, answer, sort_order, created_at, updated_at`
	f, err := scanFAQ(s.pool.QueryRow(ctx, q, question, answer, sortOrder))
	if isPgErrorCode(err, pgUniqueViolation) {
		return models.FAQ{}, ErrConflict
	}
	return f, err
}

func (s *PostgresStore) UpdateFAQ(ctx context.Context, id int64, question, answer string, sortOrder int) (models.FAQ, error) {
	const q = `
		UPDATE faqs SET question = $1, answer = $2, sort_order = $3, updated_at = now()
		WHERE id = $4
		RETURNING id, question, answer, sort_order, created_at, updated_at`
	f, err := scanFAQ(s.pool.QueryRow(ctx, q, question, answer, sortOrder, id))
	if isPgErrorCode(err, pgUniqueViolation) {
		return models.FAQ{}, ErrConflict
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return models.FAQ{}, ErrNotFound
	}
	return f, err
}

func (s *PostgresStore) DeleteFAQ(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM faqs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Tags ---

func (s *PostgresStore) TrendingTags(ctx context.Context, limit int) ([]models.Tag, error) {
	if limit < 1 {
		limit = 10
	}
	rows, err := s.pool.Query(ctx, `
		SELECT tg.name, COUNT(*) AS cnt
		FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id
		GROUP BY tg.name
		ORDER BY cnt DESC, tg.name
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Tag, 0)
	for rows.Next() {
		var t models.Tag
		if err := rows.Scan(&t.Name, &t.Count); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListThreadsByTag(ctx context.Context, tagName string, page, pageSize int) ([]models.Thread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	var total int
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name = $1`,
		tagName,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := threadSelect + `
		JOIN thread_tags tt ON tt.thread_id = t.id
		JOIN tags tg ON tg.id = tt.tag_id AND tg.name = $1
		ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, tagName, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Thread, 0)
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

// --- Thread subscriptions ---

func (s *PostgresStore) SubscribeThread(ctx context.Context, userID, threadID int64) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO subscriptions (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, threadID)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return ErrNotFound
	}
	return err
}

func (s *PostgresStore) UnsubscribeThread(ctx context.Context, userID, threadID int64) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM subscriptions WHERE user_id = $1 AND thread_id = $2`, userID, threadID)
	return err
}

func (s *PostgresStore) IsSubscribed(ctx context.Context, userID, threadID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = $1 AND thread_id = $2)`,
		userID, threadID,
	).Scan(&exists)
	return exists, err
}

func (s *PostgresStore) SubscriberEmails(ctx context.Context, threadID, excludeUserID int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
		WHERE s.thread_id = $1 AND s.user_id <> $2`, threadID, excludeUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, err
		}
		out = append(out, email)
	}
	return out, rows.Err()
}

// --- Attachments ---

func (s *PostgresStore) CreateAttachment(ctx context.Context, threadID int64, path, contentType string, sizeBytes int64) (models.Attachment, error) {
	const q = `
		INSERT INTO attachments (thread_id, path, content_type, size_bytes)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at`
	var a models.Attachment
	a.ThreadID = threadID
	a.ContentType = contentType
	a.SizeBytes = sizeBytes
	a.URL = "/uploads/" + path
	err := s.pool.QueryRow(ctx, q, threadID, path, contentType, sizeBytes).Scan(&a.ID, &a.CreatedAt)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.Attachment{}, ErrNotFound
	}
	return a, err
}

func (s *PostgresStore) ListAttachments(ctx context.Context, threadID int64) ([]models.Attachment, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, thread_id, path, content_type, size_bytes, created_at FROM attachments WHERE thread_id = $1 ORDER BY id`,
		threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Attachment, 0)
	for rows.Next() {
		var a models.Attachment
		var path string
		if err := rows.Scan(&a.ID, &a.ThreadID, &path, &a.ContentType, &a.SizeBytes, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.URL = "/uploads/" + path
		out = append(out, a)
	}
	return out, rows.Err()
}

// --- Email verification ---

// CreateEmailVerification upserts on user_id — issuing a new code always
// replaces any still-pending one, so at most one code is ever valid for a
// given user at a time (a resend can't leave two valid codes floating
// around, each a separate guess target).
func (s *PostgresStore) CreateEmailVerification(ctx context.Context, userID int64, token string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, created_at = now()`,
		userID, token, expiresAt)
	return err
}

func (s *PostgresStore) VerifyEmailCode(ctx context.Context, userID int64, code string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
		 WHERE id = $1 AND EXISTS (
		     SELECT 1 FROM email_verifications
		     WHERE user_id = $1 AND token = $2 AND expires_at > now()
		 )`,
		userID, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// Single-use: once the right code has been entered, delete it so it
	// can't be replayed (e.g. by someone who saw an old email).
	_, err = s.pool.Exec(ctx, `DELETE FROM email_verifications WHERE user_id = $1`, userID)
	return err
}

// --- Password reset ---

// maxResetAttempts is how many wrong guesses a reset code survives. With
// 10^6 possible codes and the auth rate limiter in front, a few tries per
// code leaves brute forcing hopeless; the user can always request a new one.
const maxResetAttempts = 5

// CreatePasswordReset upserts on user_id, so requesting a new code always
// invalidates the previous one.
func (s *PostgresStore) CreatePasswordReset(ctx context.Context, userID int64, code string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at,
		     attempts = 0, used_at = NULL, created_at = now()`,
		userID, code, expiresAt)
	return err
}

// matchResetCode locks email's pending reset row and checks code against it
// inside tx. On a wrong guess it records the attempt and commits tx itself
// (so the count sticks even though the caller gets ErrNotFound).
func matchResetCode(ctx context.Context, tx pgx.Tx, email, code string) (userID int64, err error) {
	var stored string
	var attempts int
	err = tx.QueryRow(ctx,
		`SELECT pr.user_id, pr.token, pr.attempts
		 FROM password_resets pr JOIN users u ON u.id = pr.user_id
		 WHERE u.email = $1 AND pr.expires_at > now() AND pr.used_at IS NULL
		 FOR UPDATE OF pr`, email,
	).Scan(&userID, &stored, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if attempts >= maxResetAttempts {
		return 0, ErrNotFound
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(code)) != 1 {
		if _, err := tx.Exec(ctx, `UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = $1`, userID); err != nil {
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return 0, ErrNotFound
	}
	return userID, nil
}

func (s *PostgresStore) CheckPasswordResetCode(ctx context.Context, email, code string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := matchResetCode(ctx, tx, email, code); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PostgresStore) ResetPassword(ctx context.Context, email, code, newPasswordHash, newSalt string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	userID, err := matchResetCode(ctx, tx, email, code)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3`, newPasswordHash, newSalt, userID); err != nil {
		return err
	}
	// Single-use: the code can't be replayed once it has set a password.
	if _, err := tx.Exec(ctx, `DELETE FROM password_resets WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ChangePassword sets userID's password directly — the authenticated,
// already-logged-in flow (the handler verifies the current password
// first), as opposed to ResetPassword's token-based forgot-password flow.
func (s *PostgresStore) ChangePassword(ctx context.Context, userID int64, newPasswordHash, newSalt string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3`, newPasswordHash, newSalt, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
