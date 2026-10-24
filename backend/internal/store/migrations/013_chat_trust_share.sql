-- How much a community answer in the chat can be trusted, as it was when
-- the bot used it: the accepted answer, its likes, written by staff.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_accepted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_staff BOOLEAN NOT NULL DEFAULT false;

-- A chat shared as a read-only link (/shared/<token>). NULL = not shared.
-- Shared chats are not auto-deleted, so the link keeps working.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_share_token
    ON chat_conversations(share_token) WHERE share_token IS NOT NULL;
