-- Forum search (see SearchThreads in search.go): prefix full-text search now
-- also looks into answers, and the typo-tolerant trigram match into the
-- question text, not only the title. These indexes keep both fast.
CREATE INDEX IF NOT EXISTS idx_threads_body_trgm ON threads USING GIN (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_comments_search ON comments USING GIN (to_tsvector('simple', body));
