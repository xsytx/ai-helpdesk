-- The plan that was called floor "3" holds the 4th floor: the right part of
-- each wing (rooms 4xx). It is "4" now; every 3rd-floor room is on the "3B"
-- plan. Safe to run on every start: rows already moved don't match again.
ALTER TABLE map_points DROP CONSTRAINT IF EXISTS map_points_floor_check;
UPDATE map_points SET floor = '4' WHERE floor = '3';
ALTER TABLE map_points ADD CONSTRAINT map_points_floor_check CHECK (floor IN ('1', '2', '3B', '4'));

-- A student's "it's actually here" spot, and the editor's change log (so undo keeps working).
UPDATE location_reports SET suggested_floor = '4' WHERE suggested_floor = '3';
UPDATE map_point_changes SET before = jsonb_set(before, '{floor}', '"4"') WHERE before ->> 'floor' = '3';
UPDATE map_point_changes SET after = jsonb_set(after, '{floor}', '"4"') WHERE after ->> 'floor' = '3';
