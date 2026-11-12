-- Photos of campus places (Sprint 5, "view location photo").
-- place_code is the code the Maps page shows a card for: a place of
-- src/features/locations/places.ts ("RED_CANTEEN"), a room code ("F205") or a
-- map point without either ("PT_42"). Admins upload, caption, order and
-- delete them in the map editor. A student may attach one photo to a
-- "Report a mistake" report: it waits as 'pending' (shown to admins only)
-- until an admin adds it to the gallery ('approved').
CREATE TABLE IF NOT EXISTS location_photos (
    id           BIGSERIAL PRIMARY KEY,
    place_code   TEXT        NOT NULL,
    path         TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT '',
    size_bytes   BIGINT      NOT NULL DEFAULT 0,
    caption      TEXT        NOT NULL DEFAULT '',
    sort_order   INTEGER     NOT NULL DEFAULT 0,
    status       TEXT        NOT NULL DEFAULT 'approved',
    report_id    BIGINT REFERENCES location_reports(id) ON DELETE SET NULL,
    uploaded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE location_photos ADD CONSTRAINT location_photos_status_check
        CHECK (status IN ('pending', 'approved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS location_photos_place_idx ON location_photos (place_code, status, sort_order, id);
-- One photo per report.
CREATE UNIQUE INDEX IF NOT EXISTS location_photos_report_once ON location_photos (report_id);
-- A student's own photo suggestion (not from a report): one waiting per student and place.
CREATE UNIQUE INDEX IF NOT EXISTS location_photos_suggest_once
    ON location_photos (uploaded_by, place_code) WHERE status = 'pending' AND report_id IS NULL;
