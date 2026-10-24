-- Suggested next questions under an AI answer (buttons in the chat). Saved
-- with the answer so they are still there after a reload.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS followups TEXT[];
