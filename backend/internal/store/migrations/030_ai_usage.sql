-- AI daily limit (sprint 7): how many questions the AI chat answered for a
-- student on a day (Almaty date). Kept apart from the chat history, so
-- deleting chats doesn't reset the count; the admin dashboard sums it.
CREATE TABLE IF NOT EXISTS ai_usage (
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       DATE   NOT NULL,
    questions INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS ai_usage_day_idx ON ai_usage (day);
