package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/019_map_points.sql
var mapPointsSQL string

// The points collected with the prototype editor (sdu-map-export/rooms.json),
// loaded once into an empty map_points table.
//
//go:embed migrations/map_points_seed.json
var mapPointsSeed []byte

// MapFloors and MapPointTypes are the allowed values; the website has the
// same lists (src/features/locations/mapPoints.ts).
var (
	MapFloors     = []string{"1", "2", "3B", "3"}
	MapPointTypes = []string{
		"room", "lab", "office", "hall", "library", "canteen", "cafe", "shop", "medical", "service",
		"wifi", "toilet", "staff_toilet", "stairs", "elevator", "entrance", "other",
	}
)

const mapPointColumns = `id, code, name, type, floor, x, y, place, updated_at`

func scanMapPoint(row pgx.Row) (models.MapPoint, error) {
	var p models.MapPoint
	err := row.Scan(&p.ID, &p.Code, &p.Name, &p.Type, &p.Floor, &p.X, &p.Y, &p.Place, &p.UpdatedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return p, ErrNotFound
	case isPgErrorCode(err, pgUniqueViolation):
		return p, ErrConflict
	}
	return p, err
}

// seedMapPoints fills an empty map_points table from the embedded seed.
func (s *PostgresStore) seedMapPoints(ctx context.Context) error {
	var filled bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM map_points)`).Scan(&filled); err != nil || filled {
		return err
	}
	var seed []models.MapPointInput
	if err := json.Unmarshal(mapPointsSeed, &seed); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	for _, p := range seed {
		if _, err := tx.Exec(ctx,
			`INSERT INTO map_points (code, name, type, floor, x, y, place) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			p.Code, p.Name, p.Type, p.Floor, p.X, p.Y, p.Place); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ListMapPoints returns every point, by floor then position.
func (s *PostgresStore) ListMapPoints(ctx context.Context) ([]models.MapPoint, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+mapPointColumns+` FROM map_points ORDER BY floor, x, y, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MapPoint{}
	for rows.Next() {
		p, err := scanMapPoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateMapPoint adds a point. ErrConflict if another point has the same code.
func (s *PostgresStore) CreateMapPoint(ctx context.Context, p models.MapPointInput, by int64) (models.MapPoint, error) {
	return scanMapPoint(s.pool.QueryRow(ctx,
		`INSERT INTO map_points (code, name, type, floor, x, y, place, updated_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING `+mapPointColumns,
		p.Code, p.Name, p.Type, p.Floor, p.X, p.Y, p.Place, by))
}

// UpdateMapPoint replaces a point's fields. ErrNotFound, or ErrConflict if the code is taken.
func (s *PostgresStore) UpdateMapPoint(ctx context.Context, id int64, p models.MapPointInput, by int64) (models.MapPoint, error) {
	return scanMapPoint(s.pool.QueryRow(ctx,
		`UPDATE map_points
		 SET code = $2, name = $3, type = $4, floor = $5, x = $6, y = $7, place = $8,
		     updated_at = now(), updated_by = $9
		 WHERE id = $1
		 RETURNING `+mapPointColumns,
		id, p.Code, p.Name, p.Type, p.Floor, p.X, p.Y, p.Place, by))
}

// DeleteMapPoint removes a point. ErrNotFound if there is none.
func (s *PostgresStore) DeleteMapPoint(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM map_points WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
