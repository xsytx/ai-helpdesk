package store

import (
	"context"
	_ "embed"
	"encoding/json"
)

//go:embed migrations/016_notification_events.sql
var notificationEventsSQL string

// ListenNotificationEvents calls fn for every notification that is created,
// changed or removed (the database announces them, 016_notification_events.sql)
// until ctx ends or the connection breaks; the caller listens again then.
func (s *PostgresStore) ListenNotificationEvents(ctx context.Context, fn func(userID, threadID int64)) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN notification_events"); err != nil {
		return err
	}
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var ev struct {
			UserID   int64 `json:"user_id"`
			ThreadID int64 `json:"thread_id"`
		}
		if json.Unmarshal([]byte(n.Payload), &ev) == nil && ev.UserID != 0 {
			fn(ev.UserID, ev.ThreadID)
		}
	}
}
