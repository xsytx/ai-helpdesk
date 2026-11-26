package store

import (
	"context"
	_ "embed"
	"time"
)

//go:embed migrations/030_ai_usage.sql
var aiUsageSQL string

//go:embed migrations/031_ai_calls.sql
var aiCallsSQL string

// AICallKinds are what the site asks the AI for (031_ai_calls.sql).
var AICallKinds = []string{"chat", "moderation", "summary"}

// CountAICall adds one call to the AI of kind on day (only its date counts).
func (s *PostgresStore) CountAICall(ctx context.Context, day time.Time, kind string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO ai_calls (day, kind, calls) VALUES ($1::date, $2, 1)
		ON CONFLICT (day, kind) DO UPDATE SET calls = ai_calls.calls + 1`, day.Format(time.DateOnly), kind)
	return err
}

// AIQuestionsOn returns how many questions the AI chat answered for the
// user on day (only its date counts).
func (s *PostgresStore) AIQuestionsOn(ctx context.Context, userID int64, day time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COALESCE((SELECT questions FROM ai_usage WHERE user_id = $1 AND day = $2::date), 0)`,
		userID, day.Format(time.DateOnly)).Scan(&n)
	return n, err
}

// CountAIQuestion adds one answered question to the user's count for day
// and returns the new count.
func (s *PostgresStore) CountAIQuestion(ctx context.Context, userID int64, day time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_usage (user_id, day, questions) VALUES ($1, $2::date, 1)
		ON CONFLICT (user_id, day) DO UPDATE SET questions = ai_usage.questions + 1
		RETURNING questions`, userID, day.Format(time.DateOnly)).Scan(&n)
	return n, err
}
