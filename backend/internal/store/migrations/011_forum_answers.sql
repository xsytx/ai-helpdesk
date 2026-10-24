-- Stories 8-9: the AI chat may answer with a forum answer ("community
-- answer"). The saved message remembers where it came from, so the chat
-- history can link to the discussion. The answer text itself is kept in
-- forum_answer; source_type stays 'forum' even if the thread is deleted later.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_thread_id BIGINT REFERENCES threads(id) ON DELETE SET NULL;
