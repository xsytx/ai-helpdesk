package store

import (
	"context"
	_ "embed"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/018_location_reports.sql
var locationReportsSQL string

// LocationReportStatuses are the allowed values of location_reports.status.
var LocationReportStatuses = []string{"open", "fixed", "rejected"}

// maxLocationReports caps the admin list (the newest first).
const maxLocationReports = 200

const locationReportColumns = `r.id, r.user_id, COALESCE(u.display_name, ''), r.place_code, r.place_name,
	r.entrance, r.text, r.status, r.created_at, r.resolved_at`

func scanLocationReport(row pgx.Row) (models.LocationReport, error) {
	var lr models.LocationReport
	err := row.Scan(&lr.ID, &lr.UserID, &lr.ReporterName, &lr.PlaceCode, &lr.PlaceName,
		&lr.Entrance, &lr.Text, &lr.Status, &lr.CreatedAt, &lr.ResolvedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return lr, ErrNotFound
	case isPgErrorCode(err, pgUniqueViolation):
		return lr, ErrConflict
	}
	return lr, err
}

// CreateLocationReport files a student's report about a place's directions.
// ErrConflict if they already have an open report about that place.
func (s *PostgresStore) CreateLocationReport(ctx context.Context, userID int64, placeCode, placeName, entrance, text string) (models.LocationReport, error) {
	return scanLocationReport(s.pool.QueryRow(ctx,
		`WITH r AS (
		     INSERT INTO location_reports (user_id, place_code, place_name, entrance, text)
		     VALUES ($1, $2, $3, $4, $5)
		     RETURNING *
		 )
		 SELECT `+locationReportColumns+` FROM r LEFT JOIN users u ON u.id = r.user_id`,
		userID, placeCode, placeName, entrance, text))
}

// ListLocationReports returns reports with the given status ("" = all), newest first.
func (s *PostgresStore) ListLocationReports(ctx context.Context, status string) ([]models.LocationReport, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+locationReportColumns+`
		 FROM location_reports r LEFT JOIN users u ON u.id = r.user_id
		 WHERE $1 = '' OR r.status = $1
		 ORDER BY r.created_at DESC, r.id DESC
		 LIMIT $2`, status, maxLocationReports)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.LocationReport{}
	for rows.Next() {
		lr, err := scanLocationReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, lr)
	}
	return out, rows.Err()
}

// SetLocationReportStatus marks a report fixed or rejected (or open again).
// ErrConflict when reopening would make a second open report for that student and place.
func (s *PostgresStore) SetLocationReportStatus(ctx context.Context, id int64, status string, by int64) (models.LocationReport, error) {
	return scanLocationReport(s.pool.QueryRow(ctx,
		`WITH r AS (
		     UPDATE location_reports
		     SET status = $2::text,
		         resolved_at = CASE WHEN $2::text = 'open' THEN NULL ELSE now() END,
		         resolved_by = CASE WHEN $2::text = 'open' THEN NULL ELSE $3::bigint END
		     WHERE id = $1
		     RETURNING *
		 )
		 SELECT `+locationReportColumns+` FROM r LEFT JOIN users u ON u.id = r.user_id`,
		id, status, by))
}
