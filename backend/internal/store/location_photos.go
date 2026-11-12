package store

import (
	"context"
	_ "embed"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/021_location_photos.sql
var locationPhotosSQL string

// LocationPhotoStatuses are the allowed values of location_photos.status.
var LocationPhotoStatuses = []string{"pending", "approved"}

const locationPhotoColumns = `id, place_code, path, content_type, caption, sort_order, status, report_id, uploaded_by, created_at`

func scanLocationPhoto(row pgx.Row) (models.LocationPhoto, error) {
	var p models.LocationPhoto
	err := row.Scan(&p.ID, &p.PlaceCode, &p.Path, &p.ContentType, &p.Caption, &p.SortOrder, &p.Status, &p.ReportID, &p.UploadedBy, &p.CreatedAt)
	p.URL = "/uploads/" + p.Path
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return p, ErrNotFound
	case isPgErrorCode(err, pgUniqueViolation):
		return p, ErrConflict
	}
	return p, err
}

// ListLocationPhotos returns the gallery photos of these place codes, in
// the admins' order (codes in the order given, then sort_order, then id).
func (s *PostgresStore) ListLocationPhotos(ctx context.Context, codes []string) ([]models.LocationPhoto, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+locationPhotoColumns+` FROM location_photos
		 WHERE status = 'approved' AND place_code = ANY($1::text[])
		 ORDER BY array_position($1::text[], place_code), sort_order, id`, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.LocationPhoto{}
	for rows.Next() {
		p, err := scanLocationPhoto(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ErrPhotoLimit: the place's gallery is full, or the student has too many photos waiting.
var ErrPhotoLimit = errors.New("photo limit reached")

// ErrReportClosed: a photo can't be added to a report that is no longer open.
var ErrReportClosed = errors.New("report closed")

// lockKey serialises photo writes per place or per student (a transaction
// advisory lock), so two uploads at once can't both pass a limit.
func lockKey(ctx context.Context, tx pgx.Tx, key string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, key)
	return err
}

// CreateLocationPhoto records an uploaded photo. An approved photo goes to
// the end of its place's gallery. Limits, checked under a lock:
//   - approved: at most limit photos per place (ErrPhotoLimit);
//   - report photo: the report must be open (ErrReportClosed), one photo per
//     report (ErrConflict); the report row stays locked, so a rejection
//     waits for this insert and then deletes the photo;
//   - student suggestion: at most limit waiting per student (ErrPhotoLimit),
//     one per student and place (ErrConflict).
func (s *PostgresStore) CreateLocationPhoto(ctx context.Context, p models.LocationPhoto, limit int) (models.LocationPhoto, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return p, err
	}
	defer tx.Rollback(ctx)
	var n int
	switch {
	case p.ReportID != nil:
		var status string
		err := tx.QueryRow(ctx, `SELECT status FROM location_reports WHERE id = $1 FOR UPDATE`, *p.ReportID).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			return p, ErrNotFound
		} else if err != nil {
			return p, err
		}
		if status != "open" {
			return p, ErrReportClosed
		}
	case p.Status == "approved":
		if err := lockKey(ctx, tx, "location_photos:"+p.PlaceCode); err != nil {
			return p, err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM location_photos WHERE place_code = $1 AND status = 'approved'`, p.PlaceCode).Scan(&n); err != nil {
			return p, err
		}
	case p.UploadedBy != nil:
		if err := lockKey(ctx, tx, fmt.Sprintf("location_photo_suggestions:%d", *p.UploadedBy)); err != nil {
			return p, err
		}
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM location_photos WHERE uploaded_by = $1 AND status = 'pending' AND report_id IS NULL`, *p.UploadedBy).Scan(&n); err != nil {
			return p, err
		}
	}
	if p.ReportID == nil && limit > 0 && n >= limit {
		return p, ErrPhotoLimit
	}
	out, err := scanLocationPhoto(tx.QueryRow(ctx,
		`INSERT INTO location_photos (place_code, path, content_type, size_bytes, caption, status, report_id, uploaded_by, sort_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
		         (SELECT COALESCE(max(sort_order), -1) + 1 FROM location_photos WHERE place_code = $1 AND status = 'approved'))
		 RETURNING `+locationPhotoColumns,
		p.PlaceCode, p.Path, p.ContentType, p.SizeBytes, p.Caption, p.Status, p.ReportID, p.UploadedBy))
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// UpdateLocationPhotoCaption changes a photo's caption.
func (s *PostgresStore) UpdateLocationPhotoCaption(ctx context.Context, id int64, caption string) (models.LocationPhoto, error) {
	return scanLocationPhoto(s.pool.QueryRow(ctx,
		`UPDATE location_photos SET caption = $2 WHERE id = $1 RETURNING `+locationPhotoColumns, id, caption))
}

// ReorderLocationPhotos puts a place's gallery in the order of ids. The ids
// must be exactly that place's gallery photos, or ErrInvalidTarget.
func (s *PostgresStore) ReorderLocationPhotos(ctx context.Context, placeCode string, ids []int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var total, matched int
	if err := tx.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE id = ANY($2::bigint[]))
		 FROM location_photos WHERE place_code = $1 AND status = 'approved'`, placeCode, ids).Scan(&total, &matched); err != nil {
		return err
	}
	if total != len(ids) || matched != len(ids) {
		return ErrInvalidTarget
	}
	if _, err := tx.Exec(ctx,
		`UPDATE location_photos p SET sort_order = o.n - 1
		 FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n)
		 WHERE p.id = o.id`, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApproveLocationPhoto adds a student's pending photo to the end of its
// place's gallery: ErrNotFound if there is no such photo, ErrConflict if it
// is already approved, ErrPhotoLimit if the place has limit photos (checked
// under the same lock as uploads).
func (s *PostgresStore) ApproveLocationPhoto(ctx context.Context, id int64, caption string, limit int) (models.LocationPhoto, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return models.LocationPhoto{}, err
	}
	defer tx.Rollback(ctx)
	var place, status string
	err = tx.QueryRow(ctx, `SELECT place_code, status FROM location_photos WHERE id = $1 FOR UPDATE`, id).Scan(&place, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.LocationPhoto{}, ErrNotFound
	} else if err != nil {
		return models.LocationPhoto{}, err
	}
	if status != "pending" {
		return models.LocationPhoto{}, ErrConflict
	}
	if err := lockKey(ctx, tx, "location_photos:"+place); err != nil {
		return models.LocationPhoto{}, err
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM location_photos WHERE place_code = $1 AND status = 'approved'`, place).Scan(&n); err != nil {
		return models.LocationPhoto{}, err
	}
	if limit > 0 && n >= limit {
		return models.LocationPhoto{}, ErrPhotoLimit
	}
	out, err := scanLocationPhoto(tx.QueryRow(ctx,
		`UPDATE location_photos
		 SET status = 'approved', caption = $2,
		     sort_order = (SELECT COALESCE(max(sort_order), -1) + 1 FROM location_photos WHERE place_code = $3 AND status = 'approved')
		 WHERE id = $1
		 RETURNING `+locationPhotoColumns, id, caption, place))
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// DeleteLocationPhoto removes a photo and returns its file path (relative to
// the upload folder) so the file can be deleted too.
func (s *PostgresStore) DeleteLocationPhoto(ctx context.Context, id int64) (string, error) {
	var path string
	err := s.pool.QueryRow(ctx, `DELETE FROM location_photos WHERE id = $1 RETURNING path`, id).Scan(&path)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return path, err
}

// DeletePendingReportPhotos removes a report's photo that was not added to
// the gallery (when the report is rejected) and returns the file paths.
func (s *PostgresStore) DeletePendingReportPhotos(ctx context.Context, reportID int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `DELETE FROM location_photos WHERE report_id = $1 AND status = 'pending' RETURNING path`, reportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		paths = append(paths, p)
	}
	return paths, rows.Err()
}

// ListPhotoSuggestions returns students' waiting photo suggestions (not
// report photos), oldest first, with the student's name.
func (s *PostgresStore) ListPhotoSuggestions(ctx context.Context) ([]models.LocationPhoto, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT p.id, p.place_code, p.path, p.content_type, p.caption, p.sort_order, p.status, p.report_id, p.uploaded_by, p.created_at,
		        COALESCE(u.display_name, '')
		 FROM location_photos p LEFT JOIN users u ON u.id = p.uploaded_by
		 WHERE p.status = 'pending' AND p.report_id IS NULL
		 ORDER BY p.created_at, p.id
		 LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.LocationPhoto{}
	for rows.Next() {
		var p models.LocationPhoto
		if err := rows.Scan(&p.ID, &p.PlaceCode, &p.Path, &p.ContentType, &p.Caption, &p.SortOrder, &p.Status, &p.ReportID, &p.UploadedBy, &p.CreatedAt, &p.UploaderName); err != nil {
			return nil, err
		}
		p.URL = "/uploads/" + p.Path
		out = append(out, p)
	}
	return out, rows.Err()
}

// CountPendingPhotoSuggestions counts a student's waiting suggestions.
func (s *PostgresStore) CountPendingPhotoSuggestions(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM location_photos WHERE uploaded_by = $1 AND status = 'pending' AND report_id IS NULL`, userID).Scan(&n)
	return n, err
}
