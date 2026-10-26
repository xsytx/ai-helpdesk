-- Saved questions: a student's bookmarks (Профиль → Сохранённые).
CREATE TABLE IF NOT EXISTS saved_threads (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id  BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_threads_user ON saved_threads(user_id, created_at DESC);

-- Restrictions set by staff, each with a reason and an end (NULL = no end):
--   ban  (banned_at)  = can't log in or use the site;
--   mute (muted_at)   = can read and use the AI chat, but not post or edit.
-- A restriction whose end has passed simply stops counting.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_reason TEXT NOT NULL DEFAULT '';
