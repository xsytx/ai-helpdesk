-- AI chat conversations (Story 11): a student has many separate chats
-- instead of one endless history. A conversation is created by its first
-- question; its title is that question (shortened) until the student renames
-- it. updated_at is the time of the last message: unpinned conversations
-- without a message for CHAT_RETENTION_DAYS (default 30) are deleted.
CREATE TABLE IF NOT EXISTS chat_conversations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    pinned      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations (user_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations (updated_at) WHERE NOT pinned;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id BIGINT REFERENCES chat_conversations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at, id);

-- History from before conversations existed becomes one conversation per
-- user, titled with its first question. Runs once: afterwards every message
-- has a conversation.
WITH orphans AS (
    SELECT m.user_id, min(m.created_at) AS first_at, max(m.created_at) AS last_at,
           COALESCE((SELECT left(regexp_replace(f.text, '\s+', ' ', 'g'), 60)
                     FROM chat_messages f
                     WHERE f.user_id = m.user_id AND f.conversation_id IS NULL AND f.role = 'user'
                     ORDER BY f.created_at, f.id LIMIT 1), '') AS title
    FROM chat_messages m
    WHERE m.conversation_id IS NULL
    GROUP BY m.user_id
), created AS (
    INSERT INTO chat_conversations (user_id, title, created_at, updated_at)
    SELECT user_id, title, first_at, last_at FROM orphans
    RETURNING id, user_id
)
UPDATE chat_messages m SET conversation_id = c.id
FROM created c
WHERE m.user_id = c.user_id AND m.conversation_id IS NULL;
