-- A community answer in the chat remembers which answer or reply it was, so
-- "Открыть обсуждение" opens the question at that post (and it blinks).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_comment_id BIGINT REFERENCES comments(id) ON DELETE SET NULL;
