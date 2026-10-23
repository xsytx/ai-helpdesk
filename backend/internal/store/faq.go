package store

import (
	"context"
	_ "embed"
	"errors"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/models"
)

//go:embed migrations/004_faq.sql
var faqSQL string

// FAQInput is an FAQ entry as an admin writes it: the English question and
// answer plus Kazakh and Russian translations.
type FAQInput struct {
	Question, QuestionKZ, QuestionRU string
	Answer, AnswerKZ, AnswerRU       string
	Category                         string
	Pinned                           bool
}

// FAQCategories are the allowed values of faqs.category (see 004_faq.sql).
var FAQCategories = []string{"general", "account", "study", "campus", "forum"}

const faqColumns = "id, question, question_kz, question_ru, answer, answer_kz, answer_ru, category, pinned, sort_order, created_at, updated_at"

func scanFAQ(row pgx.Row) (models.FAQ, error) {
	var f models.FAQ
	err := row.Scan(&f.ID, &f.Question, &f.QuestionKZ, &f.QuestionRU, &f.Answer, &f.AnswerKZ, &f.AnswerRU,
		&f.Category, &f.Pinned, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return f, ErrNotFound
	case isPgErrorCode(err, pgUniqueViolation):
		return f, ErrConflict
	}
	return f, err
}

func (s *PostgresStore) ListFAQs(ctx context.Context) ([]models.FAQ, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+faqColumns+` FROM faqs ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.FAQ, 0)
	for rows.Next() {
		f, err := scanFAQ(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetFAQ(ctx context.Context, id int64) (models.FAQ, error) {
	return scanFAQ(s.pool.QueryRow(ctx, `SELECT `+faqColumns+` FROM faqs WHERE id = $1`, id))
}

func (s *PostgresStore) CreateFAQ(ctx context.Context, in FAQInput) (models.FAQ, error) {
	return scanFAQ(s.pool.QueryRow(ctx,
		`INSERT INTO faqs (question, question_kz, question_ru, answer, answer_kz, answer_ru, category, pinned, sort_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(sort_order), -1) + 1 FROM faqs))
		 RETURNING `+faqColumns,
		in.Question, in.QuestionKZ, in.QuestionRU, in.Answer, in.AnswerKZ, in.AnswerRU, in.Category, in.Pinned))
}

func (s *PostgresStore) UpdateFAQ(ctx context.Context, id int64, in FAQInput) (models.FAQ, error) {
	return scanFAQ(s.pool.QueryRow(ctx,
		`UPDATE faqs SET question = $2, question_kz = $3, question_ru = $4,
		                 answer = $5, answer_kz = $6, answer_ru = $7,
		                 category = $8, pinned = $9, updated_at = now()
		 WHERE id = $1
		 RETURNING `+faqColumns,
		id, in.Question, in.QuestionKZ, in.QuestionRU, in.Answer, in.AnswerKZ, in.AnswerRU, in.Category, in.Pinned))
}

func (s *PostgresStore) DeleteFAQ(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM faqs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) ReorderFAQs(ctx context.Context, ids []int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var found int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM faqs WHERE id = ANY($1)`, ids).Scan(&found); err != nil {
		return err
	}
	if found != len(ids) {
		return ErrNotFound
	}
	// The listed entries get 0..n-1 in the given order, the rest follow.
	if _, err := tx.Exec(ctx,
		`WITH wanted AS (
		     SELECT id, ord - 1 AS pos FROM unnest($1::bigint[]) WITH ORDINALITY AS u(id, ord)
		 ), others AS (
		     SELECT id, cardinality($1::bigint[]) + row_number() OVER (ORDER BY sort_order, id) - 1 AS pos
		     FROM faqs WHERE id <> ALL($1)
		 )
		 UPDATE faqs f SET sort_order = p.pos
		 FROM (SELECT * FROM wanted UNION ALL SELECT * FROM others) p
		 WHERE f.id = p.id AND f.sort_order IS DISTINCT FROM p.pos`, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
