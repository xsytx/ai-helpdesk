package store

import (
	"context"
	_ "embed"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/007_forum_extras.sql
var forumExtrasSQL string

// --- "Maybe this was already asked" ---

// similarStopWords are question words and fillers in English, Russian and
// Kazakh: every question has them, so they say nothing about the topic.
var similarStopWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`
		how what where when why who which whom whose can could does do did is are was were the a an and or to of in on at
		for with my i you it its this that there get got much many about from be should will would any some me we our
		please help need find
		как что где когда почему зачем кто какой какая какое какие каком можно ли нужно надо и в во на с со по для о об
		у к из за от до мне меня я мы вы это этот эта есть сколько или а не но же бы будет находится подскажите
		пожалуйста помогите найти скажите
		қалай не қайда қашан неге кім қандай бола ма ме ба бе па пе және мен бар жоқ керек қанша туралы үшін бұл сол
		осы маған біз сіз айтыңызшы көмектесіңізші табу
		sdu university campus университет университете кампус кампусе университетте`) {
		similarStopWords[w] = true
	}
}

const (
	similarPrefixRunes = 5 // "библиотеку" -> "библи" also finds "библиотека"
	similarMaxWords    = 6
	similarLimit       = 5
)

// SimilarKeywords picks the words of a title that carry its topic, cut to
// a prefix so other word forms still match. At most similarMaxWords.
func SimilarKeywords(title string) []string {
	seen := map[string]bool{}
	var out []string
	for _, w := range searchWordRe.FindAllString(strings.ToLower(title), -1) {
		if utf8.RuneCountInString(w) < 3 || similarStopWords[w] {
			continue
		}
		if r := []rune(w); len(r) > similarPrefixRunes {
			w = string(r[:similarPrefixRunes])
		}
		if !seen[w] {
			seen[w] = true
			out = append(out, w)
		}
		if len(out) == similarMaxWords {
			break
		}
	}
	return out
}

// SimilarThreads finds visible questions whose title shares at least half
// of the topic words of title, most shared first. Used to show "maybe this
// was already asked" while writing a question: a loose hint is fine there.
func (s *PostgresStore) SimilarThreads(ctx context.Context, title string) ([]models.Thread, error) {
	words := SimilarKeywords(title)
	if len(words) == 0 {
		return []models.Thread{}, nil
	}
	need := (len(words) + 1) / 2
	rows, err := s.pool.Query(ctx, `
		SELECT th.* FROM (`+threadSelect+` WHERE `+threadVisible+`) th
		JOIN LATERAL (
			SELECT count(*) AS hits FROM unnest($1::text[]) p
			WHERE to_tsvector('simple', th.title) @@ to_tsquery('simple', p || ':*')
		) m ON true
		WHERE m.hits >= $2
		ORDER BY m.hits DESC, similarity(th.title, $3) DESC, th.created_at DESC
		LIMIT $4`, words, need, title, similarLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Thread{}
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- Solved: the accepted answer ---

// SetAcceptedAnswer marks commentID as the solution of threadID, or clears
// it (nil). Only the thread's author may: ErrForbidden otherwise,
// ErrNotFound if the thread is gone, ErrInvalidTarget if the answer isn't a
// visible answer of this thread.
func (s *PostgresStore) SetAcceptedAnswer(ctx context.Context, threadID, userID int64, commentID *int64) error {
	var owner int64
	err := s.pool.QueryRow(ctx, `SELECT user_id FROM threads WHERE id = $1`, threadID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrForbidden
	}
	if commentID != nil {
		var ok bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM comments c WHERE c.id = $1 AND c.thread_id = $2 AND `+commentVisible+`)`,
			*commentID, threadID).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrInvalidTarget
		}
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE threads SET accepted_comment_id = $2, accepted_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END
		 WHERE id = $1`, threadID, commentID)
	return err
}

// --- Reports ---

// ResolveReportsFor closes every open report about a post (after a
// moderator removed it).
func (s *PostgresStore) ResolveReportsFor(ctx context.Context, targetType string, targetID int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE reports SET status = 'resolved', resolved_at = now()
		 WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, targetType, targetID)
	return err
}
