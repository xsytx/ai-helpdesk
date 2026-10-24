package store

import (
	"context"
	_ "embed"
	"fmt"
	"time"

	"campus-forum/internal/models"
)

//go:embed migrations/008_reputation.sql
var reputationSQL string

//go:embed migrations/009_profiles.sql
var profilesSQL string

// Points for helping other students. Counted from the forum itself, only
// from visible posts:
//   - an answer the asker marked as the solution (not on your own question);
//   - a like on an answer, from someone else;
//   - an answer.
const (
	PointsPerSolution = 10
	PointsPerLike     = 2
	PointsPerAnswer   = 1
)

// Levels by all-time points: newcomer < helper < expert < master.
var reputationLevels = []struct {
	Code string
	From int
}{
	{"newcomer", 0},
	{"helper", 10},
	{"expert", 50},
	{"master", 150},
}

// LevelFor returns the level of a point total and the points the next level
// starts at (0 at the top level).
func LevelFor(points int) (level string, next int) {
	level = reputationLevels[0].Code
	for i, l := range reputationLevels {
		if points >= l.From {
			level, next = l.Code, 0
			if i+1 < len(reputationLevels) {
				next = reputationLevels[i+1].From
			}
		}
	}
	return level, next
}

// The three ways to earn points, per user, since $1. Each is a
// (user_id, n) list; the period filter applies to when the point was earned.
const (
	repAnswers = `SELECT c.user_id, count(*) AS n
		FROM comments c JOIN threads t ON t.id = c.thread_id
		WHERE ` + commentVisible + ` AND ` + threadVisible + ` AND c.parent_comment_id IS NULL AND c.created_at >= $1
		GROUP BY c.user_id`
	repLikes = `SELECT c.user_id, count(*) AS n
		FROM votes v JOIN comments c ON v.target_type = 'comment' AND c.id = v.target_id
		WHERE v.value = 1 AND v.user_id <> c.user_id AND ` + commentVisible + ` AND v.created_at >= $1
		GROUP BY c.user_id`
	repSolutions = `SELECT c.user_id, count(*) AS n
		FROM threads t JOIN comments c ON c.id = t.accepted_comment_id
		WHERE t.user_id <> c.user_id AND ` + commentVisible + ` AND ` + threadVisible + `
		  AND COALESCE(t.accepted_at, t.created_at) >= $1
		GROUP BY c.user_id`
)

// repTotals: answers, likes, solutions and points per user since $1.
var repTotals = fmt.Sprintf(`SELECT user_id, sum(a)::int AS answers, sum(l)::int AS likes, sum(s)::int AS solutions,
		       (sum(a) * %d + sum(l) * %d + sum(s) * %d)::int AS points
		FROM (
			SELECT user_id, n AS a, 0 AS l, 0 AS s FROM (%s) x
			UNION ALL SELECT user_id, 0, n, 0 FROM (%s) x
			UNION ALL SELECT user_id, 0, 0, n FROM (%s) x
		) parts
		GROUP BY user_id`, PointsPerAnswer, PointsPerLike, PointsPerSolution, repAnswers, repLikes, repSolutions)

// allTime is the "since" for all-time points.
var allTime = time.Unix(0, 0)

// Reputation returns the all-time reputation of some users (missing users
// have 0 points). Used for the badges next to names.
func (s *PostgresStore) Reputation(ctx context.Context, userIDs []int64) (map[int64]models.Reputation, error) {
	out := make(map[int64]models.Reputation, len(userIDs))
	for _, id := range userIDs {
		out[id] = newReputation(id, 0, 0, 0, 0)
	}
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT * FROM (`+repTotals+`) r WHERE r.user_id = ANY($2)`, allTime, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var answers, likes, solutions, points int
		if err := rows.Scan(&id, &answers, &likes, &solutions, &points); err != nil {
			return nil, err
		}
		out[id] = newReputation(id, answers, likes, solutions, points)
	}
	return out, rows.Err()
}

func newReputation(id int64, answers, likes, solutions, points int) models.Reputation {
	level, next := LevelFor(points)
	return models.Reputation{UserID: id, Points: points, Answers: answers, Likes: likes, Solutions: solutions, Level: level, NextLevelAt: next}
}

// TopHelpers ranks students by the points they earned since a time (the
// week's top helpers); banned users are left out. Level is still the
// all-time one.
func (s *PostgresStore) TopHelpers(ctx context.Context, since time.Time, limit int) ([]models.Helper, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.user_id, u.display_name, u.avatar, r.answers, r.likes, r.solutions, r.points
		FROM (`+repTotals+`) r JOIN users u ON u.id = r.user_id
		WHERE u.banned_at IS NULL AND r.points > 0
		ORDER BY r.points DESC, r.solutions DESC, u.display_name
		LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Helper{}
	var ids []int64
	for rows.Next() {
		var h models.Helper
		if err := rows.Scan(&h.UserID, &h.Name, &h.Avatar, &h.Answers, &h.Likes, &h.Solutions, &h.Points); err != nil {
			return nil, err
		}
		out = append(out, h)
		ids = append(ids, h.UserID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	all, err := s.Reputation(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Level = all[out[i].UserID].Level
	}
	return out, nil
}
