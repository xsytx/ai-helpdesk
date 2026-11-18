-- Floors are 1, 2, 3, 4: the "3B" plan (every 3rd-floor room) is simply "3"
-- now. Runs after 024_floor4.sql, which first moved the old "3" (the 4th
-- floor) to "4". Safe on every start: no "3B" rows remain afterwards.
ALTER TABLE map_points DROP CONSTRAINT IF EXISTS map_points_floor_check;
UPDATE map_points SET floor = '3' WHERE floor = '3B';
ALTER TABLE map_points ADD CONSTRAINT map_points_floor_check CHECK (floor IN ('1', '2', '3', '4'));

UPDATE location_reports SET suggested_floor = '3' WHERE suggested_floor = '3B';
UPDATE map_point_changes SET before = jsonb_set(before, '{floor}', '"3"') WHERE before ->> 'floor' = '3B';
UPDATE map_point_changes SET after = jsonb_set(after, '{floor}', '"3"') WHERE after ->> 'floor' = '3B';
