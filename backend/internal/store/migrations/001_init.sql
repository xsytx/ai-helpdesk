-- SDU Helpdesk schema (PostgreSQL)
-- Applied automatically by the server on startup (see internal/store),
-- so it is safe to run manually or let the app do it — every statement
-- here is idempotent.

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    banned_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADD COLUMN IF NOT EXISTS below (here and further down) is what actually
-- makes this migration idempotent across versions: CREATE TABLE IF NOT
-- EXISTS above is a no-op on a database that already has the table, so a
-- column added in a later version of this file needs its own statement
-- to reach a database created by an earlier version.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'moderator', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS major TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

-- display_name doubles as this forum's username, so it must be unique
-- (case-insensitively — "Aidana" and "aidana" are the same name). A
-- database that predates this constraint may already have collisions
-- (test accounts registered before uniqueness was enforced); resolve
-- those first — keeping the oldest account's name as-is and suffixing
-- every later duplicate ("-2", "-3", ...) — or the CREATE UNIQUE INDEX
-- below fails outright. On a database with no collisions this UPDATE
-- simply matches zero rows.
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY lower(display_name) ORDER BY id) AS rn
    FROM users
)
UPDATE users SET display_name = users.display_name || '-' || ranked.rn
FROM ranked
WHERE users.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name_lower ON users (lower(display_name));

-- The shared system account that owns posts made during the earlier
-- anonymous-posting period (posting now requires a real account, but
-- those rows still reference this user). password_hash/salt are left empty, which
-- VerifyPassword can never match against any real password (a
-- length-mismatched constant-time compare is just false), so nobody can
-- log in as this account through the normal login flow.
INSERT INTO users (email, password_hash, salt, display_name, role)
VALUES ('anonymous@system.local', '', '', 'Anonymous', 'user')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS threads (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    score       INTEGER NOT NULL DEFAULT 0,
    locked_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE threads ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- The events feature (structured date/location on a thread, an
-- "Upcoming events" widget) was removed — drop its columns/index from
-- any database that still has them.
DROP INDEX IF EXISTS idx_threads_event_date;
ALTER TABLE threads DROP COLUMN IF EXISTS event_date;
ALTER TABLE threads DROP COLUMN IF EXISTS event_location;

-- Boards/categories were replaced by free-form tags as the only
-- organizing structure — drop the legacy tables/column from any
-- database created by an earlier version of this file. category_members
-- goes first since it references categories; the FK on threads drops
-- along with the column itself.
DROP TABLE IF EXISTS category_members;
ALTER TABLE threads DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS categories;

CREATE TABLE IF NOT EXISTS comments (
    id                BIGSERIAL PRIMARY KEY,
    thread_id         BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    body              TEXT NOT NULL,
    score             INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Replies cascade-delete with their parent comment, same as a thread's
-- comments cascade-delete with the thread — consistent with how deletion
-- works everywhere else in this app, though it does mean deleting a
-- heavily-replied-to comment takes its whole reply subtree with it.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

-- target_type is 'thread' or 'comment'; value is 1 or -1
CREATE TABLE IF NOT EXISTS votes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('thread', 'comment')),
    target_id   BIGINT NOT NULL,
    value       SMALLINT NOT NULL CHECK (value IN (1, -1)),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_type, target_id);

-- 'comment_on_thread' = someone commented directly on your thread;
-- 'reply_to_comment' = someone replied to your comment specifically.
CREATE TABLE IF NOT EXISTS notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,    -- recipient
    actor_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,    -- who triggered it
    type       TEXT NOT NULL CHECK (type IN ('comment_on_thread', 'reply_to_comment')),
    thread_id  BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    comment_id BIGINT REFERENCES comments(id) ON DELETE SET NULL,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A plain ADD COLUMN can't widen an existing CHECK, so it's dropped and
-- recreated instead — cheap, and safe to run on every startup.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('comment_on_thread', 'reply_to_comment'));

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- Caps notification volume: at most one UNREAD row per (recipient,
-- thread, type). A second comment on the same thread before you've read
-- the first notification updates that row (new actor/comment, bumped
-- created_at) via ON CONFLICT instead of piling up a duplicate — see
-- CreateComment. Once read, read_at is no longer NULL, so the next event
-- on that thread starts a fresh row rather than resurrecting the old one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unread_dedupe
    ON notifications(user_id, thread_id, type) WHERE read_at IS NULL;

-- target_type/target_id mirror the votes table's polymorphic pattern
-- (no FK, since a report can outlive its target being deleted).
CREATE TABLE IF NOT EXISTS reports (
    id          BIGSERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('thread', 'comment')),
    target_id   BIGINT NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Full-text search over thread title+body, weighted so a match in the
-- title ranks above the same match in the body (see SearchThreads).
-- 'simple' config is language-agnostic (no stemming), which suits a forum
-- with mixed-language posts. This replaces an earlier unweighted index
-- (idx_threads_search) — drop that one so databases created before this
-- change get the weighted version too, not just new ones; the
-- replacement lives under a new name so this DROP is only ever a real
-- no-op after the first run, not an index rebuild on every startup.
DROP INDEX IF EXISTS idx_threads_search;
CREATE INDEX IF NOT EXISTS idx_threads_search_weighted ON threads
    USING GIN ((setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', body), 'B')));

-- pg_trgm backs a word-similarity fallback (see SearchThreads) so partial
-- words and small typos ("hous", "houseing") still surface matches that
-- full-text search's whole-token matching would otherwise miss.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_threads_title_trgm ON threads USING GIN (title gin_trgm_ops);

-- Managed by moderators/admins via /api/faq; question is UNIQUE so the
-- seed INSERT below stays idempotent.
CREATE TABLE IF NOT EXISTS faqs (
    id         BIGSERIAL PRIMARY KEY,
    question   TEXT NOT NULL UNIQUE,
    answer     TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faqs_sort ON faqs(sort_order, id);

-- The SDU Threads MVP seeded the four questions below; remove them from
-- databases created by that version (a no-op once they're gone).
DELETE FROM faqs WHERE question IN (
    'What is SDU Threads?',
    'How do upvotes work?',
    'How do I report something?',
    'Can I edit or delete my own posts?'
);

INSERT INTO faqs (question, answer, sort_order) VALUES
    ('What is SDU Helpdesk?', 'SDU Helpdesk is a help platform for SDU students. Ask the AI assistant a question, discuss it with other students on the forum, find rooms and buildings on campus, and read course descriptions and student reviews — all in one place.', 0),
    ('Who can use SDU Helpdesk?', 'Any SDU student with a university email address (@sdu.edu.kz). Sign up with your university email and confirm it with the 6-digit code we send you.', 1),
    ('How do I ask a question on the forum?', 'Open Forum and click "New question". Give it a short title and describe your question in detail — other students can then reply with their answers.', 2),
    ('How do I change my profile picture or password?', 'Go to Settings. You can pick one of the preset avatars or upload your own photo (up to 2 MB), and change your password by entering your current password and a new one.', 3),
    ('Can I use SDU Helpdesk in Kazakh or Russian?', 'Yes — switch between English, Қазақша and Русский with the language selector at the top of the page or in Settings.', 4)
ON CONFLICT (question) DO NOTHING;

-- Uploaded files live on local disk under UPLOAD_DIR (see cmd/server);
-- this row is just the pointer + metadata. path is relative to UPLOAD_DIR
-- and doubles as the URL served at /uploads/<path>.
CREATE TABLE IF NOT EXISTS attachments (
    id           BIGSERIAL PRIMARY KEY,
    thread_id    BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);

-- The only organizing structure for threads now that boards/categories
-- are gone — free-form, user-supplied labels.
CREATE TABLE IF NOT EXISTS tags (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS thread_tags (
    thread_id BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    tag_id    BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_tags_tag ON thread_tags(tag_id);

-- Subscribing to a thread gets you a notification (and, if SMTP is
-- configured, an email — see internal/mailer) on every new top-level
-- comment, not just replies aimed directly at you or your comments.
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id  BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, thread_id)
);

-- Direct messages were removed — drop the table from any database that
-- still has it.
DROP TABLE IF EXISTS messages;

-- "token" now holds a short numeric code (e.g. "042917") the user reads
-- out of their email and types back in, rather than a long random link
-- token — see VerifyEmailCode. A code is short enough that two different
-- users could coincidentally get the same one, so it can no longer be
-- globally UNIQUE on its own; matching is instead scoped to (user_id,
-- token) together, and at most one row per user is kept (a resend
-- replaces the previous code — see CreateEmailVerification's upsert).
CREATE TABLE IF NOT EXISTS email_verifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS email_verifications_token_key;
-- A database from before "one code per user" was enforced may have
-- several old rows per user (one per past resend) — keep only the
-- newest and drop the rest, or the unique index below fails outright.
DELETE FROM email_verifications a USING email_verifications b
    WHERE a.user_id = b.user_id AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);

-- token holds a 6-digit code the user types back in (it used to be a long
-- link token). At most one pending code per user, like email_verifications;
-- attempts counts wrong guesses so a code dies after a few misses.
CREATE TABLE IF NOT EXISTS password_resets (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
-- A 6-digit code isn't globally unique the way a link token was.
ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_token_key;
-- Databases from the link-token era can hold several rows per user; keep
-- only the newest so the unique index below can be created.
DELETE FROM password_resets a USING password_resets b
    WHERE a.user_id = b.user_id AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
