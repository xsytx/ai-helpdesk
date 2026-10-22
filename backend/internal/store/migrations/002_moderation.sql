-- Posts that the AI moderation did not let through automatically.
-- A row is created instead of a thread/comment; a moderator/admin then
-- approves it (the thread/comment is created from this row) or rejects it.
-- The row is kept afterwards: text + AI verdict + human decision is exactly
-- the labelled data needed to evaluate or retrain the moderation model.
CREATE TABLE IF NOT EXISTS moderation_queue (
    id                   BIGSERIAL PRIMARY KEY,
    kind                 TEXT NOT NULL CHECK (kind IN ('thread', 'comment')),
    user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                TEXT NOT NULL DEFAULT '',
    body                 TEXT NOT NULL,
    tags                 TEXT[] NOT NULL DEFAULT '{}',
    thread_id            BIGINT REFERENCES threads(id) ON DELETE CASCADE,
    parent_comment_id    BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    decision             TEXT NOT NULL CHECK (decision IN ('block', 'review')),
    categories           TEXT[] NOT NULL DEFAULT '{}',
    reason               TEXT NOT NULL DEFAULT '',
    policy_version       TEXT NOT NULL DEFAULT '',
    ml_request_id        TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ,
    admin_note           TEXT NOT NULL DEFAULT '',
    published_thread_id  BIGINT REFERENCES threads(id) ON DELETE SET NULL,
    published_comment_id BIGINT REFERENCES comments(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_queue_status_created ON moderation_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_queue_user ON moderation_queue (user_id, created_at DESC);
