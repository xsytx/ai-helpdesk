-- 3D tour views on map points (Sprint 5): admins paste links to the official
-- SDU 3D tour (vrmir3d) in the map editor; the place card opens them inside
-- the page. A list of {url, label}; label is one language, as entered.
ALTER TABLE map_points ADD COLUMN IF NOT EXISTS tours JSONB NOT NULL DEFAULT '[]'::jsonb;
