# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. Read this
first; `README.md` covers setup for users, `backend/CLAUDE.md` and
`ai_ml/README.md` go deeper into those parts.

## What this is

**SDU Helpdesk** — a help platform for SDU (Kazakhstan) students: an AI
assistant, a student forum with AI moderation, FAQ, an admin panel, and
placeholder pages for campus maps and courses. UI in **three languages:
Kazakh (`kz`), Russian (`ru`), English (`en`)**. Students register with an
`@sdu.edu.kz` email; admins (`ADMIN_EMAILS`) may use any domain.

Roles in practice: **student** (`user` in the DB) and **admin**. The backend
also knows `moderator` (same powers as admin for moderation) but the product
uses only student/admin.

## Layout

```
src/                 React 19 + TS website (Vite, Tailwind v4, React Router 7, TanStack Query)
backend/             Go 1.26 JSON API + PostgreSQL schema   (see backend/CLAUDE.md)
ai_ml/               Python FastAPI service: FAQ search + LLM answers + moderation (Ollama)
docker-compose.yml   web (nginx) + app (Go) + db (Postgres 16) + ai_ml
nginx.conf           serves the site, proxies /api (read timeout 200s for slow AI answers)
.env / .env.example  settings for docker compose (root .env; ai_ml/.env is only for run.bat)
```

Frontend structure (`src/`): `app/` (router, providers, `AuthContext`,
`ProtectedRoute`), `pages/`, `features/<area>/` (`api.ts` = React Query hooks
+ backend adapters, `components/`), `entities/` (shared types), `shared/`
(`ui/` kit, `api/client.ts`, `lib/`), `i18n/` (`translations.ts`,
`LocaleContext`), `styles/globals.css` (design tokens in `@theme`).

## Run and check

```bash
docker compose up -d --build        # everything; site on http://localhost:3000
npx tsc -b                          # frontend type check (there is no lint/test runner yet)
npx vite build                      # production build
npm run dev                         # Vite on :5173, proxies /api to :8080 (backend in Docker)
```

The AI needs **Ollama running on the host** (`ollama serve` / tray app) with
the model from `LLM_MODEL` pulled (default `qwen3.5:4b`). The `ai_ml`
container reaches it at `host.docker.internal:11434`. Without Ollama the site
works; chat says "assistant unavailable" and new posts are held for review.

Tests:

```bash
# Go (vet + unit tests; moderation tests need a SEPARATE test database):
docker exec sdu_ai_helpdesk-db-1 createdb -U campus_forum campus_forum_test   # once
cd backend && docker build -q --target build -t sdu-backend-build . && \
  docker run --rm --network sdu_ai_helpdesk_default \
  -e TEST_DATABASE_URL="postgres://campus_forum:campus_forum@db:5432/campus_forum_test?sslmode=disable" \
  sdu-backend-build sh -c 'cd /src && go vet ./... && go test -count=1 ./...'
# Without TEST_DATABASE_URL the moderation tests are SKIPPED, not passed.

# ai_ml unit tests (no Ollama needed) and the moderation quality eval (needs Ollama):
docker compose run --rm ai_ml python -m unittest discover -s tests
docker compose run --rm ai_ml python scripts/eval_moderation.py            # eval/moderation_cases.jsonl
docker compose run --rm ai_ml python scripts/eval_moderation.py --cases eval/moderation_holdout.jsonl
```

Go is not installed on the dev machine — build/test it through Docker as
above. Docker Hub sometimes times out (`TLS handshake timeout`): just retry.

## How the main flows work

- **Auth.** JWT (7 days) in `localStorage` (`ai_helpdesk_token`), user cache in
  `ai_helpdesk_user`. Login is shared by all tabs of one origin; `AuthContext`
  follows changes from other tabs (`storage` event) and ignores late `/api/me`
  answers for a login that changed. To be logged in as two accounts at once
  use two origins (`localhost:3000` and `127.0.0.1:3000`) or incognito.
- **Moderation (asynchronous, Story 10).** `backend/internal/handlers/moderation_queue.go`:
  1. instant word filter (`ai_ml` `/moderate` with `mode: "fast"`, no LLM);
     obvious swearing → never published, `202` + notice, queued;
  2. otherwise published at once with `moderation_status = 'checking'`;
  3. a background goroutine runs the full check (word filter + LLM): allow →
     `ok`; review/block → `held` (hidden) + queue entry
     (`hidden_after_publish = true`);
  4. admin publishes (`ok`) or rejects (`rejected`) in `/admin`.
  Held/rejected posts are visible only to their author (banner "На проверке")
  and staff. Interrupted checks resume at startup. Staff posts are moderated too.
- **AI chat.** `POST /api/chat/ask` (auth + rate limit, one question in
  flight per user) → `ai_ml` `/generate-answer` → answer with `forum_answer`
  (from the FAQ knowledge base) and `ai_explanation`. Separate conversations
  (Story 11, `003_chat.sql`): `/chat` is a new chat; its first answered
  question creates the conversation (title = the question) and the page moves
  to `/chat/:id`. Rename/pin/delete in the list (`ConversationList`; a side
  panel on wide screens, a sheet on phones). Unpinned chats idle for
  `CHAT_RETENTION_DAYS` (30) are deleted hourly. The model still gets only the
  current question, not the earlier messages of the chat.
- **FAQ (Story 12, `004_faq.sql`).** Each entry has KZ/RU/EN texts
  (`question`/`answer` = English, `_kz`/`_ru` next to them), a category and
  `pinned` = shown as a chat button. Buttons call `POST /api/chat/faq`: the
  answer comes from the table at once (no LLM, works with Ollama off) and is
  saved in the conversation with `basis: "faq"`; a typed question equal to an
  FAQ question is answered the same way. Admins edit, order and pin entries
  in `/admin?section=faq` (`FaqEditor`); the editor requires all three
  languages.
- **Forum extras.** Search box and tag filter on `/forum` live in the URL
  (`?q=` → `/api/search`, `?tag=` → `/api/tags/{name}/threads`; popular tags
  from `/api/tags/trending`); tags are added in the new-question dialog
  (`TagInput`, max 8). Authors edit/delete their own question or answer from
  the "⋯" menu (`PostMenu`, `features/forum/postActions.ts`); admins may
  delete any post. Edits are moderated again: `409` = held post, `422` =
  edit breaks the rules. Editing a question sends its tags too (the backend
  replaces them).
- **Notifications.** The header bell (`NotificationBell`) polls
  `/api/notifications/unread-count` every 30 s and lists
  `/api/notifications` when opened; a click marks it read and opens the
  question. Notifications about posts the moderation hid are not shown
  (`notificationVisible` in `postgres.go`) until a moderator publishes them.
- **Auto-refresh.** React Query polling: feed 15 s, thread 10 s (1.5 s while
  a post is `checking`), admin queue 5 s, admin badge 10 s; paused in
  background tabs; never refetches over a like that is still saving.

## Rules and conventions

- **Every UI text in all three languages.** Add keys to `en`, `kz` and `ru`
  in `src/i18n/translations.ts` (TypeScript complains if one is missing).
  Counts use `plural(count, "key")` with `keyOne/Few/Many/Other` forms
  (Russian needs all four). Kazakh is `kk` for `Intl`/`<html lang>`.
  Watch for mixed alphabets in texts (a Cyrillic "С" + Latin letters).
- **Backend is the source of truth for who may register** — the frontend only
  checks the email format (`isValidEmail`), never the domain.
- **Every public SQL read must hide held posts**: use `threadVisible` /
  `commentVisible` in `backend/internal/store/postgres.go`.
- **Schema changes** are idempotent SQL applied on every start
  (`001_init.sql` + `003_chat.sql` + `004_faq.sql` in `Migrate`, `002_moderation.sql` in
  `MigrateModeration`): `CREATE ... IF NOT EXISTS` /
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Store interface**: adding a method to `store.Store` also needs a stub on
  `chatTestStore` in `backend/internal/handlers/chat_test.go`.
- **UI building blocks**: `shared/ui` (`Button`, `Card`, `Input`,
  `PasswordField`, `OtpInput`, `RollingNumber`), tokens like `text-primary`,
  `bg-background-2`, `text-label`, `rounded-2xl`. Animations go through
  `shared/lib/motion.ts` and must respect `prefers-reduced-motion`.
- **Links** use React Router `viewTransition` (page fade; the `main` area is
  `view-transition-name: page`, which makes it its own stacking context —
  full-screen overlays must be portalled to `document.body`).
- **Onboarding tour** (`features/onboarding/tour.ts`) points at elements with
  `data-tour="..."`; keep those attributes when restyling the shell.
- **Browser storage** goes through `shared/lib/storage.ts` (`safeStorage`,
  `safeSession`), which never throws.
- **Commit messages** have no AI co-author/attribution lines.

## Gotchas

- Windows checkout with `core.autocrlf=true`: files are CRLF in the working
  tree (Git stores LF). Editing tools that write LF create mixed endings;
  `gofmt -l` lists every Go file for the same reason — not a real problem.
- `ADMIN_EMAILS` is applied at backend startup (and at registration); after
  changing it run `docker compose up -d`, then log out/in.
- The small local model (`qwen3.5:4b`, fits a 4 GB GPU) is weak in Kazakh and
  sometimes picks an odd moderation category; decisions are measured by the
  eval above (last run: 100% recall, 0% false positives on 60 + 24 cases).
- `ai_ml/.cache/` holds the 1.1 GB search model (git-ignored, shared with the
  container) — don't delete it unless you want to download it again.

## State and next steps (as of 2026-10-23)

Done: accounts, forum (likes, best answer, auto-refresh), FAQ, settings,
onboarding tour, AI chat with separate conversations (Story 11: list,
`/chat/:id`, rename/pin/delete, 30-day auto-delete), FAQ in three languages
with categories and instant-answer buttons in the chat (Story 12, admin
editor with order/pin), async AI moderation + admin panel (filters, sort,
log), staff emails, error/404 pages, performance pass (small logo, bundled
font, on-demand tour code).

Also done: forum search and tags, edit/delete own posts, notifications bell.

Planned next: a "smarter assistant" sprint (follow-up questions with chat
context, 👍/👎 on AI answers, "ask on the forum" when the AI can't answer,
"make it an FAQ" for admins from frequent/👎 questions), then maps and
courses. Follow-up context needs an `ai_ml` `/generate-answer` change (send
the last few messages). Optional: stop admins approving their own flagged
posts.
