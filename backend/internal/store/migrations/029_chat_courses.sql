-- The AI chat answers questions about courses (Courses, after stories 16-18):
-- the courses a question named (by code or name), shown under the answer as
-- links to their cards. [{code, name}], empty for other answers.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS courses JSONB NOT NULL DEFAULT '[]';
