-- Campus map points (Sprint 5): rooms, stairs, toilets, entrances and services
-- placed on the floor-plan images (public/maps/floor1.png …). x, y are pixels
-- of the plan image, origin top-left: they never depend on the screen.
-- Admins edit them in the admin panel ("Map editor"); students see the same
-- points on the Maps page. Filled once from map_points_seed.json (the points
-- collected with the prototype editor) while the table is empty.
CREATE TABLE IF NOT EXISTS map_points (
    id         BIGSERIAL PRIMARY KEY,
    -- Room code as students type it ("F205", "I110/111"); empty for stairs, toilets…
    code       TEXT        NOT NULL DEFAULT '',
    name       TEXT        NOT NULL DEFAULT '',
    type       TEXT        NOT NULL,
    -- 1, 2, 3B (the half-floor, shown on the floor 3 plan) or 3.
    floor      TEXT        NOT NULL,
    x          INTEGER     NOT NULL,
    y          INTEGER     NOT NULL,
    -- The place on the Maps page this point belongs to (RED_CANTEEN, HALL_A), or empty.
    place      TEXT        NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN
    ALTER TABLE map_points ADD CONSTRAINT map_points_floor_check CHECK (floor IN ('1', '2', '3B', '3'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A room code names one room.
CREATE UNIQUE INDEX IF NOT EXISTS map_points_code_once ON map_points (upper(code)) WHERE code <> '';
CREATE INDEX IF NOT EXISTS map_points_floor_idx ON map_points (floor);
