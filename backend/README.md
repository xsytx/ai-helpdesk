# SDU Helpdesk — backend

> **Running the whole project?** Use `docker compose up -d --build` from the
> repository root and see [`../README.md`](../README.md). This file documents
> the Go backend itself (API, database, configuration). The React app in the
> repo root is the real frontend; `web/` below is the backend's original
> plain-HTML UI, still served on port 8080 but no longer maintained.

A student forum with a Threads/Twitter/Reddit-style feel: a scrolling
home feed of posts organized entirely by free-form tags (no boards or
categories), nested reply threads, image attachments, upvotes,
notifications, thread subscriptions, full-text search, and moderation
tools. Go backend, PostgreSQL storage, plain HTML/CSS/JS frontend,
single binary to run.

## Quick start

Requires Go 1.25+ and a running PostgreSQL server.

1. Create a database and point the app at it — either export
   `DATABASE_URL`, or copy `.env.example` to `.env` and edit it (the app
   loads `.env` automatically on startup; a real environment variable
   always wins over what's in it):

   ```bash
   createdb sdu_helpdesk
   cp .env.example .env   # then edit DATABASE_URL, ADMIN_EMAILS, etc.
   ```

2. Run the server:

   ```bash
   go run ./cmd/server
   ```

   On startup the app connects to Postgres and applies the schema in
   [`internal/store/migrations/001_init.sql`](internal/store/migrations/001_init.sql)
   automatically — every statement in it is idempotent, so this is safe
   on every restart. A handful of FAQ entries are seeded the same way.

3. Open http://localhost:8080 in your browser. The server serves the API
   (`/api/...`), uploaded images (`/uploads/...`), and the static
   frontend (`web/`) all on the same port.

On first run it also creates `jwt.secret` next to the binary — a
randomly generated signing key for login tokens. Safe to delete to
invalidate all existing sessions.

### Becoming an admin

There's deliberately no API to grant yourself the admin role. Set
`ADMIN_EMAILS` (comma-separated) in `.env` or your real environment —
every matching account is promoted to `admin` on startup. Log out and
back in afterward so your browser picks up the new role.

### Email (verification, password resets, thread-subscriber notifications)

With no `SMTP_HOST` configured, the app doesn't fail — it logs what it
would have sent to the server's stdout instead (see
`internal/mailer`), so every email-triggering flow (register → verify,
forgot password → reset, subscribing to a thread) is fully testable
locally without a real mail provider: just read the 6-digit code out of
the log (or the `dev_verification_code` / `dev_reset_code` field in the
API response). Fill in `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/
`SMTP_FROM` to send for real; nothing else needs to change.

With Docker Compose, put those `SMTP_*` values in the `.env` file in the
repository root, next to `docker-compose.yml` (it's gitignored) — Compose
passes them into the app container. For Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_USER=<your gmail>`, `SMTP_PASS=<a Google app password, not your
normal password>`, `SMTP_FROM=SDU Helpdesk <your gmail>`.

### Configuration (environment variables / `.env`)

| Variable                | Default                                                              | Meaning                              |
|--------------------------|-----------------------------------------------------------------------|---------------------------------------|
| `ADDR`                  | `:8080`                                                              | Address/port to listen on             |
| `DATABASE_URL`          | `postgres://campus_forum:campus_forum@localhost:5432/campus_forum?sslmode=disable` | PostgreSQL connection string |
| `JWT_SECRET_FILE`       | `jwt.secret`                                                         | Path to the persisted JWT signing key |
| `WEB_DIR`               | `web`                                                                | Path to the static frontend folder    |
| `UPLOAD_DIR`            | `uploads`                                                            | Where uploaded images are stored, served at `/uploads/` |
| `BASE_URL`              | `http://localhost<ADDR>`                                             | Used to build absolute links in emails |
| `CORS_ALLOWED_ORIGIN`   | `*`                                                                  | Lock down for a real deployment       |
| `ADMIN_EMAILS`          | *(empty)*                                                            | Comma-separated emails promoted to admin on every startup |
| `ALLOWED_EMAIL_DOMAINS` | `sdu.edu.kz`                                                         | Comma-separated domains (no `@`) registration is restricted to. Set explicitly to an empty value to allow any domain |
| `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM` | *(empty = log instead of send)* | Real email delivery — see above |

## Features

- **Accounts**: sign up / log in with email + password (PBKDF2-SHA256
  hashing), sessions via JWT bearer tokens. Registration is restricted to
  `@sdu.edu.kz` addresses by default (`ALLOWED_EMAIL_DOMAINS`, empty to
  lift it) — this is SDU's own forum. Display name (this forum's
  username) must be unique, case-insensitively. A 6-digit verification
  code is emailed/logged on registration, and registering walks you
  straight into entering it (`verify-email.html`); an unverified account
  can still browse, vote, and edit its profile, but can't create threads
  or comments (a banner on your own profile links back to the code-entry
  page for anyone who skipped it). Forgot/reset-password flow for a
  locked-out account — also a 6-digit emailed code (15-minute expiry,
  dead after 5 wrong guesses) — plus a change-password form on your own
  profile for a routine update.
- **Home feed**: `index.html` is a Threads-style feed of every thread,
  with a compose box up top, New/Top/Most-commented/Saved sort tabs, and
  a "Load more" button. There's no board/category page — tags are the
  only organizing structure.
- **Threads & nested replies**: create a post with Markdown formatting
  (bold/italic/links/code/lists — rendered server-side via `goldmark`),
  optional tags, and up to one image attachment upload after posting.
  Reply to a thread or to any comment (unlimited depth on the backend,
  capped visual indent on the frontend). Posting requires a logged-in
  account with a verified email; posts show their real author. (Posts
  from an earlier anonymous-posting period belong to a shared
  "Anonymous" system account — see "Anonymous posts" below.)
- **Upvotes**: upvote/downvote threads and comments; clicking the same
  arrow again removes your vote, the other arrow flips it.
- **Tags**: free-form labels — the only way threads are organized. A
  trending-tags widget and a dedicated browse-by-tag view
  (`search.html?tag=...`) make them discoverable; typing `#tagname` into
  the header search box jumps straight there. The browse-by-tag shortcut
  list is capped at 8 tags — it's a scannable shortcut, not a full index
  of every tag (that's what typing `#tag` is for).
- **Search**: full-text search (`search.html`) across thread titles and
  bodies, weighted so a match in the title ranks above the same match in
  the body. A trigram word-similarity fallback also catches partial
  words and small typos ("hous" finds "Housing question…") that
  full-text search's whole-token matching misses on its own.
- **Notifications & subscriptions**: creating a thread or commenting on
  one auto-subscribes you to it; a bell in the header tells you about
  new activity on threads you're subscribed to (and specifically about
  replies to your own comments), with a best-effort email alongside the
  in-app notification. Repeated activity on the same thread before you
  read the first notification collapses into that one row (fresh
  actor/comment, bumped timestamp) instead of piling up duplicates, and
  the header bell polls a dedicated lightweight count endpoint rather
  than loading a full page of notifications just to show a badge number.
- **Profiles**: every username links to a public profile listing that
  user's threads/comments, plus an editable major/bio and a "✓ Verified"
  badge next to the name for accounts with a confirmed `@sdu.edu.kz`
  email (the address itself stays private — only the yes/no is public).
- **FAQ**: a public `faq.html` page, content managed from the admin panel.
- **Moderation**: `moderator`/`admin` roles (granted via `ADMIN_EMAILS`
  only) can lock threads, delete anyone's post, ban/unban users, and
  work through user-filed reports from `admin.html`.
- **Rate limiting**: per-IP limits on auth endpoints (register/login/
  forgot-password) and on content creation (threads/comments) — see
  `middleware.RateLimit`.

## Anonymous posts

For a while the MVP let anyone post without an account; those posts
were attributed to a shared system account (email
`anonymous@system.local`, display name "Anonymous", seeded idempotently
by the migration). Posting now requires login again — `CreateThread`/
`CreateComment` sit behind `authMw` and check `requireNotBanned` and
`requireVerified` — so new posts carry their real author. The system
account is kept because older posts still reference it: its
`password_hash`/`salt` are empty, which can never match a real password,
so nobody can log in as it, and its posts can only be removed by a
moderator via `AdminDeleteThread`/`AdminDeleteComment`.

## Project layout

```
cmd/server/main.go                    Wires everything together, HTTP routes, .env loading
internal/models/                      Domain types (User, Thread, Comment, Tag, ...)
internal/store/                       Persistence layer (Store interface + PostgreSQL impl)
internal/store/migrations/001_init.sql  PostgreSQL schema, embedded into the binary
internal/auth/                        Password hashing (PBKDF2) + JWT issue/verify
internal/mailer/                      Email sending — logs instead of sending with no SMTP_HOST
internal/markdown/                    Markdown → safe HTML rendering (goldmark)
internal/middleware/                  Auth, CORS, rate limiting
internal/handlers/                    HTTP handlers (the REST API)
web/                                  Static frontend (HTML/CSS/vanilla JS)
uploads/                              Uploaded images (UPLOAD_DIR), gitignored
```

## API reference

All request/response bodies are JSON. Authenticated requests need
`Authorization: Bearer <token>`. List endpoints that take `page`/
`page_size` return `{..., page, page_size, total}`.

| Method | Path                              | Auth | Description                       |
|--------|-----------------------------------|------|------------------------------------|
| POST   | `/api/register`                   | –    | `{email, password, display_name}` → `{token, user}`; emails a 6-digit verification code |
| POST   | `/api/login`                      | –    | `{email, password}` → `{token, user}` (403 if banned) |
| POST   | `/api/verify-email`               | ✓    | `{code}` — consumes your own pending verification code |
| POST   | `/api/resend-verification`        | ✓    | Emails a fresh code, replacing any still-pending one |

With no `SMTP_HOST` configured, `/api/register` and `/api/resend-verification`
also return `dev_verification_code` in their JSON response, and the
frontend (`verify-email.html`) displays and prefills it automatically —
otherwise there'd be nowhere to read the code from except the server's
stdout. This never happens once real SMTP is configured (see
`Mailer.IsStub()` in `internal/mailer`); the code only reaches the actual
inbox at that point.
| POST   | `/api/forgot-password`            | –    | `{email}` — emails a 6-digit reset code; always the same response, to avoid account enumeration (plus `dev_reset_code` with no SMTP configured) |
| POST   | `/api/reset-password/verify`      | –    | `{email, code}` — checks a reset code without using it up |
| POST   | `/api/reset-password`             | –    | `{email, code, new_password}` — consumes the code |
| GET    | `/api/me`                         | ✓    | Current user                      |
| PATCH  | `/api/me`                         | ✓    | `{display_name, major, bio}`      |
| POST   | `/api/me/password`                | ✓    | `{current_password, new_password}` — routine password change, not the forgot-password flow |
| GET    | `/api/feed`                       | –    | `?sort=new\|top\|comments&page=&page_size=` — home feed, every thread |
| GET    | `/api/stats`                      | –    | Platform-wide counts (users/threads/comments/tags) |
| GET    | `/api/search`                     | –    | `?q=&page=&page_size=` — full-text search |
| GET    | `/api/tags/trending` / `/api/tags/{name}/threads` | – | Trending tags / browse by tag |
| POST   | `/api/threads`                    | ✓    | `{title, body, tags?}` — verified email required |
| GET    | `/api/threads/{id}`               | –    | `{thread, comments, subscribed}` (comments are flat; nest client-side via `parent_comment_id`) |
| PATCH / DELETE | `/api/threads/{id}`       | ✓    | Owner, or moderator for delete    |
| POST   | `/api/threads/{id}/attachments`   | ✓    | Multipart `file` field (owner only, image ≤5MB) |
| POST / DELETE | `/api/threads/{id}/subscribe` | ✓ | Follow / unfollow a thread's activity |
| POST   | `/api/threads/{id}/comments`      | ✓    | `{body, parent_comment_id?}` — verified email required |
| PATCH / DELETE | `/api/comments/{id}`      | ✓    | Owner, or moderator for delete    |
| POST   | `/api/threads/{id}/vote` / `/api/comments/{id}/vote` | ✓ | `{value: 1 \| -1}` |
| GET    | `/api/users/{id}` / `/threads` / `/comments` | – | Public profile + their posts |
| GET    | `/api/notifications`              | ✓    | `{notifications, unread, ...}`    |
| GET    | `/api/notifications/unread-count` | ✓    | `{unread}` — lightweight count for the header bell badge |
| POST   | `/api/notifications/{id}/read` / `/read-all` | ✓ | Mark read |
| POST   | `/api/threads/{id}/report` / `/api/comments/{id}/report` | ✓ | `{reason}` |
| GET    | `/api/faq`                        | –    | List FAQ entries                  |
| POST / PATCH / DELETE | `/api/faq[/{id}]`     | moderator | `{question, answer, sort_order}` |
| POST   | `/api/threads/{id}/lock`          | moderator | `{locked: bool}`             |
| POST   | `/api/users/{id}/ban`             | moderator | `{banned: bool}`             |
| GET    | `/api/reports`                    | moderator | `?status=open\|resolved`     |
| POST   | `/api/reports/{id}/resolve`       | moderator | —                             |

## Database

Storage is PostgreSQL, via [`pgx`](https://github.com/jackc/pgx) (`internal/store/postgres.go`).
The schema lives in `internal/store/migrations/001_init.sql` and is applied
automatically on every startup — every statement in it is idempotent
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.), which
is also how new columns reach a database created by an older version of
this file: **adding a column to an existing table means adding both the
inline column in `CREATE TABLE` *and* a matching `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS`** — the former only helps fresh databases.

Notable design points:

- `threads.score` / `comments.score` are denormalized counters kept in
  sync by the `Vote` query, which runs the read-modify-write inside a
  transaction with `SELECT ... FOR UPDATE` so concurrent votes on the
  same target serialize correctly.
- `votes` has a `UNIQUE (user_id, target_type, target_id)` constraint,
  used for the upvote-toggle behavior (voting the same way again
  removes the vote; voting the other way flips it).
- `idx_users_display_name_lower`, a `UNIQUE` index on `lower(display_name)`,
  makes display name (this forum's username) unique case-insensitively.
  `CreateUser`/`UpdateProfile` catch its violation and return
  `ErrUsernameTaken` — a distinct sentinel from the plain `ErrConflict`
  used for a duplicate email, so the handler can say which field to
  change. A database from before this constraint existed may already
  have collisions (test accounts, usually); the migration resolves them
  by suffixing every later duplicate ("-2", "-3", ...) before creating
  the index, rather than failing outright.
- `email_verifications.token` holds a short numeric code (not a link
  token) since `VerifyEmail`/`ResendVerification` switched from an
  emailed link to a code the user types back in — see
  `idx_email_verifications_user`, a `UNIQUE` index on `user_id` alone
  (not `token`, since a 6-digit code isn't globally unique the way a long
  random link token was) that `CreateEmailVerification`'s `ON CONFLICT`
  upsert relies on to keep at most one active code per user.
- `comments.parent_comment_id` self-references `comments` (`ON DELETE
  CASCADE`) for the reply tree; the API still returns comments as a flat
  list and the frontend builds the tree client-side.
- `subscriptions` backs both the notification bell and the best-effort
  subscriber emails; creating a thread or commenting on one auto-inserts
  a row, so "notify the thread's author" falls out of "notify every
  subscriber" rather than needing its own special case.
- `idx_notifications_unread_dedupe` is a partial `UNIQUE` index on
  `(user_id, thread_id, type) WHERE read_at IS NULL`, so at most one
  unread notification exists per recipient/thread/type. `CreateComment`
  inserts with `ON CONFLICT ... DO UPDATE`, so a second comment on the
  same thread before you've read the first notification updates that row
  (new actor/comment, bumped `created_at`) instead of piling up a
  duplicate; once you read it, the next event starts a fresh row. The
  header bell polls `/api/notifications/unread-count`, a plain `COUNT(*)`
  that skips the full notifications JOIN just to render a badge number.
- Boards/categories used to be the organizing structure; they were
  replaced by tags. The migration file actively `DROP`s the old
  `categories`/`category_members` tables and `threads.category_id`
  column on any database that still has them (not just skips creating
  them). The other removal is the FAQ seed: the four SDU Threads-era
  questions are `DELETE`d by exact text before the SDU Helpdesk FAQ is
  inserted, so older databases pick up the new FAQ too.
- Full-text search uses a GIN index on a weighted tsvector expression —
  `setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector
  ('simple', body), 'B')` — so a match in the title outranks the same
  match in the body; the `'simple'` config skips language-specific
  stemming, since posts here are a mix of languages. `SearchThreads`
  OR's that full-text condition with a `pg_trgm` word-similarity check
  (`$1 <% title`, backed by `idx_threads_title_trgm`) so a partial word
  or small typo ("hous" for "Housing…") still finds a match, which
  whole-token full-text matching alone would miss.

## Running with Docker Compose

The compose file lives in the repository root (`../docker-compose.yml`)
and runs this backend together with Postgres 16 and the React website:

```bash
cd ..
docker compose up -d --build
```

The app (built from this folder's `Dockerfile`) waits for Postgres to be
healthy, connects, and applies the schema on boot. Uploaded images and the
JWT secret persist in the `app-data` volume, the database in `db-data`.

## Security notes for going beyond MVP

- Passwords are hashed with PBKDF2-HMAC-SHA256 (100k iterations, random
  16-byte salt per user) implemented directly against `crypto/hmac` and
  `crypto/sha256` — solid, but consider `bcrypt`/`argon2` (via
  `golang.org/x/crypto`) for new projects.
- JWTs are hand-rolled HS256 — fine for an MVP; consider `golang-jwt/jwt`
  for more claim/algorithm flexibility later.
- A ban is checked at login, at post/comment creation, and at voting; a
  missing email verification is checked at post/comment creation only
  (voting and editing your profile don't require it) — neither is
  checked on every conceivable write, so extend `requireNotBanned` /
  `requireVerified` if you find a gap. If you disable
  `ALLOWED_EMAIL_DOMAINS` for local testing, remember unverified accounts
  still can't post — verify your own test accounts too, or you'll lock
  yourself out of testing thread/comment creation.
- Rate limiting is in-memory per-IP with no eviction — fine for a single
  long-lived process at this scale, but add a cleanup goroutine (or move
  to a shared store like Redis) before real production traffic.
- There's no Google/SSO login (OAuth) — it needs a real Client ID/Secret
  from your own Google Cloud project, which nobody can generate for you.
- CORS defaults to `*`; set `CORS_ALLOWED_ORIGIN` for a real deployment.
- `DATABASE_URL` in the default and Docker Compose config carries a
  plaintext dev password — use a real secret (env var from a secrets
  manager, not committed anywhere) in any shared or production
  deployment. Keep `.env` out of version control (it's gitignored).
# go_learn
