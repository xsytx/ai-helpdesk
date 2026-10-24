package store

import (
	"context"
	_ "embed"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/models"
)

//go:embed migrations/005_search.sql
var searchSQL string

// searchVector is thread title+body as a weighted tsvector — a match in
// the title ('A' weight) outranks the same match in the body ('B'). Kept
// as its own const so the query and the idx_threads_search_weighted
// index expression stay in exact sync (Postgres only uses an expression
// index when the query's expression matches it, not just its meaning).
const searchVector = `(setweight(to_tsvector('simple', t.title), 'A') || setweight(to_tsvector('simple', t.body), 'B'))`

var searchWordRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

const (
	searchMinWordRunes = 2
	searchMaxWords     = 8
)

// prefixTSQuery turns what was typed into a full-text query where every
// word may be the start of a longer word: "cante food" -> "cante:* &
// food:*", so a half-typed word finds "canteen". Only letters and digits
// get through (nothing to escape); one-letter words are dropped because
// "a:*" would match almost everything. Empty if no word is left.
func prefixTSQuery(q string) string {
	var parts []string
	for _, w := range searchWordRe.FindAllString(strings.ToLower(q), -1) {
		if utf8.RuneCountInString(w) < searchMinWordRunes {
			continue
		}
		parts = append(parts, w+":*")
		if len(parts) == searchMaxWords {
			break
		}
	}
	return strings.Join(parts, " & ")
}

// SearchThreads finds visible threads for q. A thread matches when
//   - its title, body, a visible answer or a tag contains every typed word
//     (or a word starting with it: prefix search, with $2), or
//   - its title or body is close to the typed text (trigram word
//     similarity, $1 <% …): catches typos and other word forms, e.g.
//     "kanteen" or "столовую" for "Столовая".
//
// Results: title matches first, then body, then answers/tags, then the
// typo-only matches; within each, the closest title first, then newest.
// SearchMatch says which of these found the thread.
func (s *PostgresStore) SearchThreads(ctx context.Context, q string, page, pageSize int) ([]models.Thread, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	args := []any{q}
	// Without a usable word only the similarity match is left (and $2 must
	// not appear in the SQL at all, or Postgres can't type it).
	matchedBy := `'similar'`
	match := `$1 <% t.title OR $1 <% t.body`
	if tsq := prefixTSQuery(q); tsq != "" {
		args = append(args, tsq)
		const query = `to_tsquery('simple', $2)`
		inAnswer := `EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = t.id AND ` + commentVisible +
			` AND to_tsvector('simple', c.body) @@ ` + query + `)`
		inTag := `EXISTS (SELECT 1 FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id
			WHERE tt.thread_id = t.id AND to_tsvector('simple', tg.name) @@ ` + query + `)`
		match = searchVector + ` @@ ` + query + ` OR ` + inAnswer + ` OR ` + inTag + ` OR ` + match
		matchedBy = `CASE
			WHEN to_tsvector('simple', t.title) @@ ` + query + ` THEN 'title'
			WHEN to_tsvector('simple', t.body) @@ ` + query + ` THEN 'body'
			WHEN ` + inAnswer + ` THEN 'answer'
			WHEN ` + inTag + ` THEN 'tag'
			ELSE 'similar' END`
	}
	where := ` WHERE (` + match + `) AND ` + threadVisible

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM threads t`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitArg, offsetArg := len(args)+1, len(args)+2
	args = append(args, pageSize, (page-1)*pageSize)
	dataQ := `SELECT * FROM (
		SELECT th.*, ` + matchedBy + ` AS matched_by,
		       word_similarity($1, t.title) AS title_sim
		FROM (` + threadSelect + where + `) th
		JOIN threads t ON t.id = th.id
	) r
	ORDER BY CASE r.matched_by WHEN 'title' THEN 0 WHEN 'body' THEN 1 WHEN 'answer' THEN 2 WHEN 'tag' THEN 2 ELSE 3 END,
	         r.title_sim DESC, r.created_at DESC
	LIMIT $` + strconv.Itoa(limitArg) + ` OFFSET $` + strconv.Itoa(offsetArg)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]models.Thread, 0)
	for rows.Next() {
		var t models.Thread
		var titleSim float64
		if err := rows.Scan(&t.ID, &t.UserID, &t.AuthorName, &t.Title, &t.Body, &t.Score, &t.LockedAt,
			&t.CreatedAt, &t.CommentCnt, &t.Tags, &t.ModerationStatus, &t.AcceptedCommentID, &t.AuthorAvatar, &t.SearchMatch, &titleSim); err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}
