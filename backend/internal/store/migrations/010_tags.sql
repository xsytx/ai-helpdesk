-- Tags are chosen from a fixed list (ForumTags in store/tags.go; the website
-- shows them translated). Questions from before keep what fits: old free
-- tags with a close match are moved to it, the rest are dropped. The list
-- below must match ForumTags.
INSERT INTO tags (name)
SELECT unnest(ARRAY['dorm', 'campus', 'study', 'exams', 'schedule', 'registration', 'scholarship',
                    'documents', 'food', 'student-life', 'clubs', 'it', 'other'])
ON CONFLICT (name) DO NOTHING;

-- Old free tags with an obvious match in the list.
WITH mapping(old, new) AS (VALUES
    ('location', 'campus'), ('university', 'study'), ('dormitory', 'dorm'), ('general', 'other')
)
INSERT INTO thread_tags (thread_id, tag_id)
SELECT tt.thread_id, nt.id
FROM mapping m
JOIN tags ot ON ot.name = m.old
JOIN thread_tags tt ON tt.tag_id = ot.id
JOIN tags nt ON nt.name = m.new
ON CONFLICT DO NOTHING;

DELETE FROM thread_tags tt USING tags tg
WHERE tg.id = tt.tag_id
  AND tg.name <> ALL (ARRAY['dorm', 'campus', 'study', 'exams', 'schedule', 'registration', 'scholarship',
                            'documents', 'food', 'student-life', 'clubs', 'it', 'other']);
