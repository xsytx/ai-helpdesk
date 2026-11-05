-- "Report a mistake" on the campus navigation page (Sprint 5, Story 15).
-- The places still live in the website (src/features/locations/places.ts),
-- so a report keeps the place's code ("BLOCK_F", "HALL_B", a room like
-- "F205") and its name as the student saw it, plus the entrance the route
-- started from. Admins mark a report fixed or rejected.
CREATE TABLE IF NOT EXISTS location_reports (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_code  TEXT        NOT NULL,
    place_name  TEXT        NOT NULL DEFAULT '',
    entrance    TEXT        NOT NULL DEFAULT '',
    text        TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN
    ALTER TABLE location_reports ADD CONSTRAINT location_reports_status_check
        CHECK (status IN ('open', 'fixed', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS location_reports_status_idx ON location_reports (status, created_at DESC);
-- One open report per student and place.
CREATE UNIQUE INDEX IF NOT EXISTS location_reports_open_once
    ON location_reports (user_id, place_code) WHERE status = 'open';
