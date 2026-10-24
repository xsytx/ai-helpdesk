-- Reputation (points for helping) and "top helpers of the week".
-- Points are counted from existing data (see store/reputation.go); this only
-- adds what is needed to count them by period, and indexes to keep it fast.

-- When an answer was marked as the solution (NULL = not marked). Older
-- solutions count from their question's date.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
UPDATE threads SET accepted_at = created_at WHERE accepted_comment_id IS NOT NULL AND accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_votes_target ON votes (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_threads_accepted ON threads (accepted_comment_id) WHERE accepted_comment_id IS NOT NULL;
