-- Map editor extras (Sprint 5).
-- 1. "It's actually here": a student's report may carry the spot they tapped
--    on the floor plan; an admin applies it to the point in one click.
ALTER TABLE location_reports ADD COLUMN IF NOT EXISTS suggested_floor TEXT NOT NULL DEFAULT '';
ALTER TABLE location_reports ADD COLUMN IF NOT EXISTS suggested_x INTEGER;
ALTER TABLE location_reports ADD COLUMN IF NOT EXISTS suggested_y INTEGER;

-- 2. Every change to a map point (who, when, the point before and after), so
--    an accidental drag or delete can be seen and undone.
CREATE TABLE IF NOT EXISTS map_point_changes (
    id         BIGSERIAL PRIMARY KEY,
    point_id   BIGINT      NOT NULL,
    -- create, update or delete
    action     TEXT        NOT NULL,
    user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    before     JSONB,
    after      JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_point_changes_recent_idx ON map_point_changes (created_at DESC, id DESC);

-- 3. The advising desk became a place of the Maps page (ADVISING, with its 3D
--    tour view): link the point collected for it, once (only while unlinked).
UPDATE map_points SET place = 'ADVISING'
WHERE place = '' AND lower(name) IN ('advising desk', 'advisory desk')
  AND NOT EXISTS (SELECT 1 FROM map_points WHERE place = 'ADVISING');
