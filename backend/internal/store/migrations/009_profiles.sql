-- Public profiles, avatars on the server, photos in answers.

-- A user's avatar: '' = none (initials), a preset id ("avatar3"), or the
-- URL of an uploaded photo ("/uploads/avatars/<user>/<name>.jpg").
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT '';

-- A photo belongs to a question (comment_id NULL) or to one of its answers.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_attachments_comment ON attachments (comment_id) WHERE comment_id IS NOT NULL;
