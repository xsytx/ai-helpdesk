-- 👍/👎 on AI chat answers. The admin panel lists the 👎 ones, the ones
-- the AI could not answer (basis 'none') and questions many students ask, so
-- an admin can turn them into FAQ entries.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating IN (-1, 1));
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_messages_disliked ON chat_messages (rated_at DESC) WHERE rating = -1;
CREATE INDEX IF NOT EXISTS idx_chat_messages_unanswered ON chat_messages (created_at DESC)
    WHERE role = 'assistant' AND basis = 'none';
CREATE INDEX IF NOT EXISTS idx_chat_messages_questions ON chat_messages (created_at DESC) WHERE role = 'user';
