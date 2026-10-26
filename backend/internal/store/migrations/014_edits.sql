-- Edited posts: when a question's or answer's text last changed ("изменено"),
-- and the earlier versions (shown to the author and staff only).
ALTER TABLE threads ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- One row per replaced version: the text as it was until replaced_at.
CREATE TABLE IF NOT EXISTS post_revisions (
    id          BIGSERIAL PRIMARY KEY,
    thread_id   BIGINT REFERENCES threads(id) ON DELETE CASCADE,
    comment_id  BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((thread_id IS NULL) <> (comment_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_post_revisions_thread ON post_revisions(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_revisions_comment ON post_revisions(comment_id) WHERE comment_id IS NOT NULL;
