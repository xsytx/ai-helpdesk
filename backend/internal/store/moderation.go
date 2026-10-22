package store

import (
	"context"
	_ "embed"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/002_moderation.sql
var moderationSQL string

// ModerationInput is what the handler saves when the AI held a post back.
type ModerationInput struct {
	Kind            string // "thread" or "comment"
	UserID          int64
	Title           string
	Body            string
	Tags            []string
	ThreadID        *int64
	ParentCommentID *int64
	Decision        string // "block" or "review"
	Categories      []string
	Reason          string
	PolicyVersion   string
	MLRequestID     string
}

// ModerationStore is the moderation queue. It is a separate interface from
// Store on purpose, so the rest of the forum code and its tests are untouched.
type ModerationStore interface {
	CreateModerationItem(ctx context.Context, in ModerationInput) (models.ModerationItem, error)
	// ListModerationItems filters by status ("pending"/"approved"/"rejected");
	// "" or "all" returns everything. pending is the number of pending items
	// overall (for a badge), whatever the filter is.
	ListModerationItems(ctx context.Context, status string, page, pageSize int) (items []models.ModerationItem, total, pending int, err error)
	GetModerationItem(ctx context.Context, id int64) (models.ModerationItem, error)
	// ClaimModerationItem atomically moves pending -> approved so two
	// moderators cannot publish the same post twice. ErrNotFound if there is
	// no such item, ErrConflict if it was already decided.
	ClaimModerationItem(ctx context.Context, id, reviewerID int64, note string) (models.ModerationItem, error)
	// ReleaseModerationItem undoes a claim whose publishing failed.
	ReleaseModerationItem(ctx context.Context, id int64) error
	SetModerationPublished(ctx context.Context, id int64, threadID, commentID *int64) error
	// RejectModerationItem moves pending -> rejected (same errors as Claim).
	RejectModerationItem(ctx context.Context, id, reviewerID int64, note string) (models.ModerationItem, error)
}

// MigrateModeration creates the moderation queue table. Safe to run on every start.
func (s *PostgresStore) MigrateModeration(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, moderationSQL)
	return err
}

const moderationSelect = `
	SELECT q.id, q.kind, q.user_id, u.display_name, q.title, q.body, q.tags,
	       q.thread_id, COALESCE(t.title, ''), q.parent_comment_id,
	       q.decision, q.categories, q.reason, q.policy_version, q.status,
	       q.reviewed_by, COALESCE(rv.display_name, ''), q.reviewed_at, q.admin_note,
	       q.published_thread_id, q.published_comment_id, q.created_at
	FROM moderation_queue q
	JOIN users u ON u.id = q.user_id
	LEFT JOIN threads t ON t.id = q.thread_id
	LEFT JOIN users rv ON rv.id = q.reviewed_by`

func scanModerationItem(row pgx.Row) (models.ModerationItem, error) {
	var m models.ModerationItem
	err := row.Scan(&m.ID, &m.Kind, &m.UserID, &m.AuthorName, &m.Title, &m.Body, &m.Tags,
		&m.ThreadID, &m.ThreadTitle, &m.ParentCommentID,
		&m.Decision, &m.Categories, &m.Reason, &m.PolicyVersion, &m.Status,
		&m.ReviewedBy, &m.ReviewerName, &m.ReviewedAt, &m.AdminNote,
		&m.PublishedThreadID, &m.PublishedCommentID, &m.CreatedAt)
	if m.Tags == nil {
		m.Tags = []string{}
	}
	if m.Categories == nil {
		m.Categories = []string{}
	}
	return m, err
}

func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func (s *PostgresStore) CreateModerationItem(ctx context.Context, in ModerationInput) (models.ModerationItem, error) {
	const q = `
		INSERT INTO moderation_queue
			(kind, user_id, title, body, tags, thread_id, parent_comment_id,
			 decision, categories, reason, policy_version, ml_request_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id`
	var id int64
	err := s.pool.QueryRow(ctx, q, in.Kind, in.UserID, in.Title, in.Body, nonNil(in.Tags),
		in.ThreadID, in.ParentCommentID, in.Decision, nonNil(in.Categories),
		in.Reason, in.PolicyVersion, in.MLRequestID).Scan(&id)
	if isPgErrorCode(err, pgForeignKeyViolation) {
		return models.ModerationItem{}, ErrNotFound
	}
	if err != nil {
		return models.ModerationItem{}, err
	}
	return s.GetModerationItem(ctx, id)
}

func (s *PostgresStore) GetModerationItem(ctx context.Context, id int64) (models.ModerationItem, error) {
	m, err := scanModerationItem(s.pool.QueryRow(ctx, moderationSelect+` WHERE q.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return models.ModerationItem{}, ErrNotFound
	}
	return m, err
}

func (s *PostgresStore) ListModerationItems(ctx context.Context, status string, page, pageSize int) ([]models.ModerationItem, int, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	where := ""
	args := []any{}
	if status != "" && status != "all" {
		where = "WHERE q.status = $1"
		args = append(args, status)
	}

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM moderation_queue q `+where, args...).Scan(&total); err != nil {
		return nil, 0, 0, err
	}
	var pending int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM moderation_queue WHERE status = 'pending'`).Scan(&pending); err != nil {
		return nil, 0, 0, err
	}

	// Pending items are a work queue (oldest first); history is newest first.
	order := "ORDER BY q.created_at DESC, q.id DESC"
	if status == "pending" {
		order = "ORDER BY q.created_at ASC, q.id ASC"
	}
	limitArg, offsetArg := len(args)+1, len(args)+2
	dataQ := fmt.Sprintf(moderationSelect+` %s %s LIMIT $%d OFFSET $%d`, where, order, limitArg, offsetArg)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	out := make([]models.ModerationItem, 0)
	for rows.Next() {
		m, err := scanModerationItem(rows)
		if err != nil {
			return nil, 0, 0, err
		}
		out = append(out, m)
	}
	return out, total, pending, rows.Err()
}

// decide moves a pending item to newStatus; it tells "gone" from "already decided".
func (s *PostgresStore) decide(ctx context.Context, id, reviewerID int64, newStatus, note string) (models.ModerationItem, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE moderation_queue
		SET status = $2, reviewed_by = $3, reviewed_at = now(), admin_note = $4
		WHERE id = $1 AND status = 'pending'`, id, newStatus, reviewerID, note)
	if err != nil {
		return models.ModerationItem{}, err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM moderation_queue WHERE id = $1)`, id).Scan(&exists); err != nil {
			return models.ModerationItem{}, err
		}
		if !exists {
			return models.ModerationItem{}, ErrNotFound
		}
		return models.ModerationItem{}, ErrConflict
	}
	return s.GetModerationItem(ctx, id)
}

func (s *PostgresStore) ClaimModerationItem(ctx context.Context, id, reviewerID int64, note string) (models.ModerationItem, error) {
	return s.decide(ctx, id, reviewerID, "approved", note)
}

func (s *PostgresStore) RejectModerationItem(ctx context.Context, id, reviewerID int64, note string) (models.ModerationItem, error) {
	return s.decide(ctx, id, reviewerID, "rejected", note)
}

func (s *PostgresStore) ReleaseModerationItem(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE moderation_queue
		SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, admin_note = ''
		WHERE id = $1 AND status = 'approved'
		  AND published_thread_id IS NULL AND published_comment_id IS NULL`, id)
	return err
}

func (s *PostgresStore) SetModerationPublished(ctx context.Context, id int64, threadID, commentID *int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE moderation_queue SET published_thread_id = $2, published_comment_id = $3 WHERE id = $1`,
		id, threadID, commentID)
	return err
}

var _ ModerationStore = (*PostgresStore)(nil)
