package store

import (
	"context"
	"log"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"campus-forum/internal/models"
)

// A mention in a question or answer is written @[Name](u<id>) — the website
// inserts it when a name is picked after "@" and shows it as a link to the
// profile. The id is what counts; the name is only for reading.
var mentionRx = regexp.MustCompile(`@\[[^\]\n]{1,80}\]\(u(\d{1,18})\)`)

// maxMentions caps how many people one post can notify.
const maxMentions = 10

// MentionedUserIDs returns the users mentioned in body, each once, in order.
func MentionedUserIDs(body string) []int64 {
	var ids []int64
	for _, m := range mentionRx.FindAllStringSubmatch(body, -1) {
		id, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil || slices.Contains(ids, id) {
			continue
		}
		ids = append(ids, id)
		if len(ids) == maxMentions {
			break
		}
	}
	return ids
}

// notifyMentions tells the users mentioned in body (and not already in
// previous, the text before an edit) that actorID mentioned them; skip is
// someone already notified about this post another way (the author of the
// answer being replied to). Like the other notifications it is hidden while
// the post is held by moderation (notificationVisible) and best-effort: a
// failure doesn't fail the post.
func (s *PostgresStore) notifyMentions(ctx context.Context, actorID, threadID int64, commentID *int64, body, previous string, skip int64) {
	before := MentionedUserIDs(previous)
	var ids []int64
	for _, id := range MentionedUserIDs(body) {
		if id != actorID && id != skip && !slices.Contains(before, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO notifications (user_id, actor_id, type, thread_id, comment_id)
		 SELECT u.id, $2, 'mention', $3, $4 FROM users u WHERE u.id = ANY($1)
		 ON CONFLICT (user_id, thread_id, type) WHERE read_at IS NULL
		 DO UPDATE SET actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id, created_at = now()`,
		ids, actorID, threadID, commentID,
	); err != nil {
		log.Printf("could not create mention notifications on thread %d: %v", threadID, err)
	}
}

// SearchUsers finds people to mention: a word of their name starts with q.
// Banned users are left out; at most limit.
func (s *PostgresStore) SearchUsers(ctx context.Context, q string, limit int) ([]models.UserSuggestion, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []models.UserSuggestion{}, nil
	}
	pattern := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	rows, err := s.pool.Query(ctx, `
		SELECT id, display_name, avatar FROM users
		WHERE (banned_at IS NULL OR ban_until <= now()) AND (display_name ILIKE $1 || '%' OR display_name ILIKE '% ' || $1 || '%')
		ORDER BY (display_name ILIKE $1 || '%') DESC, display_name, id
		LIMIT $2`, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.UserSuggestion, 0)
	for rows.Next() {
		var u models.UserSuggestion
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.Avatar); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
