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

-- Asynchronous moderation (Story 10): a post that passes the instant word
-- filter is published at once and checked by the AI in the background.
--   ok        visible, checked (also every post from before this change)
--   checking  visible, the AI check is still running
--   held      hidden: the AI said review/block, waiting for a moderator
--   rejected  hidden for good: a moderator rejected it
-- Only ok/checking posts are shown publicly; the author still sees their own
-- held/rejected posts (marked "under review"), and so do moderators.
ALTER TABLE threads  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'ok';
CREATE INDEX IF NOT EXISTS idx_threads_moderation_open  ON threads  (moderation_status) WHERE moderation_status <> 'ok';
CREATE INDEX IF NOT EXISTS idx_comments_moderation_open ON comments (moderation_status) WHERE moderation_status <> 'ok';
-- Date filters on the moderation log.
CREATE INDEX IF NOT EXISTS idx_moderation_queue_created ON moderation_queue (created_at);
-- true = the post was published first and hidden by the background AI check;
-- false = the instant word filter stopped it before publishing.
ALTER TABLE moderation_queue ADD COLUMN IF NOT EXISTS hidden_after_publish BOOLEAN NOT NULL DEFAULT false;
