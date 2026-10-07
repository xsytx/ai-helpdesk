# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SDU Helpdesk (backend) — a student forum (Threads/Twitter/Reddit-style feed, nested
reply threads, tags instead of boards, upvotes, notifications, search,
moderation). Go backend + PostgreSQL, plain HTML/CSS/vanilla-JS frontend,
single binary. See `README.md` for the full feature list, API reference,
and database design notes — it's kept thorough and current; read it
before making non-trivial changes rather than re-deriving behavior from
code alone.

## Commands

```bash
go run ./cmd/server           # run the server (needs Postgres — see below)
go build ./...                # build everything
go vet ./...                  # static checks
(cd .. && docker compose up -d --build)   # whole stack (compose file is in the repo root)
```

There are no automated tests in this repo (`*_test.go` — none exist) and
no linter/formatter config beyond standard `gofmt`. Run `gofmt -l .` to
check formatting.

Requires Go 1.26+ and PostgreSQL. Copy `.env.example` to `.env` and edit
`DATABASE_URL` etc. — `loadDotEnv` in `cmd/server/main.go` loads it on
startup, but a real environment variable always wins over `.env`. On
startup the server applies `internal/store/migrations/001_init.sql`
automatically (every statement is idempotent — safe to run on every
restart) and generates `jwt.secret` if it doesn't exist.

To become an admin locally: set `ADMIN_EMAILS` (comma-separated) in
`.env`, restart, then log out/in. There is deliberately no API to grant
admin.

## Architecture

Layering is strict and one-directional: `cmd/server` (wiring) →
`internal/handlers` (HTTP/JSON) → `internal/store` (the `Store`
interface) → `internal/store/postgres.go` (the only place SQL is
written). Handlers never touch SQL directly; everything they need is a
method on `store.Store` (`internal/store/store.go`).

- **`cmd/server/main.go`** — reads env/`.env`, connects to Postgres, runs
  migrations, promotes `ADMIN_EMAILS` to admin, constructs
  `handlers.Handlers`, and
  registers every route on `http.ServeMux` (Go 1.22+ method+pattern
  routing, e.g. `"POST /api/threads"`). This is the one file that knows
  the full route table and which middleware wraps which route — check it
  first when adding an endpoint.
- **`internal/handlers`** — one file per resource area (`auth.go`,
  `forum.go` for threads/comments, `moderation.go`, `notifications.go`,
  `profile.go`, `subscriptions.go`, `tags.go`, `faq.go`,
  `attachments.go`, `feed.go`). All share the single `Handlers` struct
  (`handlers.go`) holding `Store`, `JWTSecret`, `Mailer`, `UploadDir`,
  `BaseURL`, `AllowedEmailDomains`. `helpers.go` has
  shared JSON/pagination helpers.
- **`internal/store`** — `store.go` defines the `Store` interface and
  sentinel errors (`ErrNotFound`, `ErrConflict`, `ErrForbidden`,
  `ErrLocked`, `ErrUsernameTaken`, ...) that handlers switch on to pick
  HTTP status codes. `postgres.go` is the single ~1200-line
  implementation via `pgx/v5`. Ownership-checked mutations (e.g.
  `UpdateThread`, `DeleteComment`) return `ErrForbidden` if the row
  exists but belongs to someone else, `ErrNotFound` if it doesn't exist.
  Admin-only variants (`AdminDeleteThread`, etc.) skip the ownership
  check — the handler layer is responsible for the role check first.
- **`internal/store/migrations/001_init.sql`** — the entire schema,
  embedded into the binary and applied idempotently on every startup.
  **When adding a column to an existing table, add it in two places**:
  the inline column in `CREATE TABLE` (helps fresh DBs only) *and* a
  matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (needed for
  existing DBs) — this is the one recurring gotcha in this file.
- **`internal/auth`** — PBKDF2-HMAC-SHA256 password hashing
  (`password.go`) and a hand-rolled HS256 JWT (`jwt.go`). No external
  auth/JWT library.
- **`internal/middleware`** — `Auth`/`OptionalAuth` (Bearer token →
  context user id, via `middleware.UserID(r)`), `CORS`, and `RateLimit`
  (per-IP token bucket via `golang.org/x/time/rate`; each call to
  `RateLimit` makes an independent set of buckets, so different route
  groups get independent limits — see the two limiters wired in
  `main.go`).
- **`internal/mailer`** — sends real email via SMTP when `SMTP_HOST` is
  set; otherwise logs the message to stdout instead of failing, so every
  email-triggering flow (verify, password reset, subscriber
  notifications) is testable locally without an SMTP server. Check
  `Mailer.IsStub()` before assuming delivery happened.
- **`internal/markdown`** — thread/comment bodies render server-side to
  safe HTML via `goldmark`.
- **`web/`** — static frontend, one HTML page per view plus a matching
  `web/js/<page>.js`. `web/js/api.js` is shared by every page: a
  `Session` object (JWT + user cached in `localStorage`), a thin
  `api(path, options)` fetch wrapper that attaches the bearer token and
  throws on non-2xx, plus shared render helpers (avatar initials,
  author links, HTML escaping). No build step, no framework, no bundler
  — edit the HTML/JS files directly and reload.

## Notable behavioral points worth knowing before touching related code

- Posting requires a logged-in, verified, unbanned user. Older posts
  from the MVP's anonymous-posting period belong to the
  `anonymous@system.local` system account (see README "Anonymous
  posts") — keep that account, those rows reference it.
- Vote counts (`threads.score`/`comments.score`) are denormalized and
  kept in sync inside a transaction with `SELECT ... FOR UPDATE` in the
  `Vote` query — don't update scores by any other path.
- Notification dedup: at most one *unread* notification per
  (recipient, thread, type) via a partial unique index; new activity on
  an already-unread notification updates that row (`ON CONFLICT ... DO
  UPDATE`) rather than creating a duplicate.
- A ban is checked at login, post/comment creation, and voting; email
  verification is checked at post/comment creation only. If you add a
  new write path, decide deliberately whether it needs
  `requireNotBanned`/`requireVerified` rather than assuming it's
  already covered.
