-- How many times the site asked the AI per day and for what (sprint 7): the
-- free Gemini quota is shared by the chat, the moderation of new posts and
-- reviews, and review summaries; the admin dashboard compares the day's total
-- with AI_DAILY_QUOTA. Almaty dates, like ai_usage.
CREATE TABLE IF NOT EXISTS ai_calls (
    day   DATE NOT NULL,
    kind  TEXT NOT NULL CHECK (kind IN ('chat', 'moderation', 'summary')),
    calls INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind)
);
