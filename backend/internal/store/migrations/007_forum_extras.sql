-- Forum extras: a question's author can mark one answer as the solution
-- ("Solved"), and a student can report a post only once while that report
-- is open.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS accepted_comment_id BIGINT REFERENCES comments(id) ON DELETE SET NULL;

-- Older databases may hold repeated open reports: keep the first of each.
DELETE FROM reports a USING reports b
    WHERE a.status = 'open' AND b.status = 'open'
      AND a.reporter_id = b.reporter_id AND a.target_type = b.target_type AND a.target_id = b.target_id
      AND a.id > b.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open_once ON reports (reporter_id, target_type, target_id) WHERE status = 'open';
