-- Course reviews (Sprint 6, stories 17-18). One review per student and
-- course: four scores, a short text and the term the course was taken.
-- Students see reviews without names; staff see who wrote them.
-- Moderation like forum posts, in its own small flow: the instant word filter
-- refuses obvious abuse before saving; otherwise the review is shown at once
-- ('checking') and the AI checks it in the background: 'ok', or 'held'
-- (hidden, waiting for an admin who publishes it or rejects it).
CREATE TABLE IF NOT EXISTS course_reviews (
    id                BIGSERIAL PRIMARY KEY,
    course_code       TEXT     NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    user_id           BIGINT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    difficulty        SMALLINT NOT NULL,
    workload          SMALLINT NOT NULL,
    usefulness        SMALLINT NOT NULL,
    recommend         BOOLEAN  NOT NULL,
    text              TEXT     NOT NULL,
    taken_year        INTEGER  NOT NULL,
    taken_term        TEXT     NOT NULL,
    status            TEXT     NOT NULL DEFAULT 'checking',
    moderation_reason TEXT     NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at         TIMESTAMPTZ,
    UNIQUE (course_code, user_id)
);

DO $$ BEGIN
    ALTER TABLE course_reviews ADD CONSTRAINT course_reviews_values_check CHECK (
        difficulty BETWEEN 1 AND 5 AND workload BETWEEN 1 AND 5 AND usefulness BETWEEN 1 AND 5
        AND taken_term IN ('fall', 'spring', 'summer')
        AND status IN ('checking', 'ok', 'held', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews (course_code, status, created_at DESC);
CREATE INDEX IF NOT EXISTS course_reviews_status_idx ON course_reviews (status) WHERE status IN ('checking', 'held');

-- "Helpful" marks (one per student and review; never on your own).
CREATE TABLE IF NOT EXISTS review_helpful (
    review_id  BIGINT NOT NULL REFERENCES course_reviews(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (review_id, user_id)
);

-- Reports about a review (one open report per student and review).
CREATE TABLE IF NOT EXISTS review_reports (
    id          BIGSERIAL PRIMARY KEY,
    review_id   BIGINT NOT NULL REFERENCES course_reviews(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT   NOT NULL DEFAULT '',
    status      TEXT   NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
DO $$ BEGIN
    ALTER TABLE review_reports ADD CONSTRAINT review_reports_status_check CHECK (status IN ('open', 'resolved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS review_reports_open_once ON review_reports (review_id, user_id) WHERE status = 'open';
