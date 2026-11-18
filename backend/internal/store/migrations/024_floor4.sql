-- The plan that was called floor "3" holds the 4th floor: the right part of
-- each wing (rooms 4xx). It became "4" (and later "3B" became "3", see
-- 025_floor3.sql). Runs only for a database still on the old names (it has
-- "3B" points): afterwards "3" means the 3rd floor and must not move again.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM map_points WHERE floor = '3B') THEN
        ALTER TABLE map_points DROP CONSTRAINT IF EXISTS map_points_floor_check;
        UPDATE map_points SET floor = '4' WHERE floor = '3';
        -- A student's "it's actually here" spot, and the editor's change log (so undo keeps working).
        UPDATE location_reports SET suggested_floor = '4' WHERE suggested_floor = '3';
        UPDATE map_point_changes SET before = jsonb_set(before, '{floor}', '"4"') WHERE before ->> 'floor' = '3';
        UPDATE map_point_changes SET after = jsonb_set(after, '{floor}', '"4"') WHERE after ->> 'floor' = '3';
    END IF;
END $$;
