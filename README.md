# SDU Helpdesk

A help platform for SDU students: an AI assistant, a student forum, campus
navigation, and course descriptions, in English, Kazakh, and Russian.
Sign-in is restricted to `@sdu.edu.kz` university email addresses.

| Part | Status |
|---|---|
| Accounts (sign up, 6-digit email verification, login, forgot/change password) | Working |
| Forum (questions, answers, likes, solved answers, search, tags, "maybe already asked", unanswered filter, reports, edit/delete your own posts) | Working |
| Notifications (bell in the header when someone answers your question) | Working |
| Reputation (points and levels for helping, top helpers of the week), photos on questions | Working |
| FAQ | Working: in English, Kazakh and Russian, by category; admins edit it in the Admin panel and choose which questions are instant-answer buttons in the chat |
| Settings (avatar, password, language), public profile pages | Working |
| AI chat assistant | Working: answers from the SDU knowledge base + a local Ollama model, shown word by word as they are written (with a stop button); understands follow-up questions; 👍/👎 on answers; separate chats you can rename, pin and delete (unpinned ones are deleted after 30 days without messages) |
| Forum moderation | Working: new posts are checked by the AI; doubtful ones wait for a moderator |
| Campus maps, courses | Placeholder pages |

## What's in this repo

```
src/                React + TypeScript website (Vite, Tailwind, React Query)
backend/            Go API + PostgreSQL schema (see backend/README.md)
ai_ml/              AI service: knowledge-base search, answers, moderation (see ai_ml/README.md)
docker-compose.yml  Runs everything: database, backend, AI service, website
Dockerfile          Builds the website and serves it with nginx
nginx.conf          Serves the website, forwards /api to the backend
.env.example        Settings template: copy to .env
```

## Run it (Docker, recommended)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/),
and it must be **open and running**. For the AI assistant you also need
[Ollama](https://ollama.com/download) (Windows, macOS, Linux) with a model
pulled once (see [AI assistant](#ai-assistant)).

```bash
git clone https://github.com/xsytx/ai-helpdesk.git
cd ai-helpdesk
cp .env.example .env          # Windows PowerShell: copy .env.example .env
docker compose up -d --build
```

The first start takes a few minutes (the AI service also downloads a
~1.1 GB search model once). Then open **http://localhost:3000**.

Sign up with an `@sdu.edu.kz` address. If you haven't set up email (next
section), the 6-digit code is shown on the screen as "Demo only", so you
can test without a mailbox.

```bash
docker compose ps             # what's running
docker compose logs -f app    # backend logs (Ctrl+C to stop following)
docker compose stop           # stop everything (data is kept)
docker compose up -d          # start again
docker compose up -d --build  # start again after changing the code
```

## AI assistant

The chat and the forum moderation use the `ai_ml` service, which Docker
starts together with everything else. The language model itself runs in
[Ollama](https://ollama.com/download), installed normally on your computer
so it can use your GPU on any OS:

```bash
ollama pull qwen3.5:4b        # once; ~3.3 GB
```

Ollama must be running (it starts with the computer after installing). To
use another model, pull it and set `LLM_MODEL` in `.env`, then
`docker compose up -d`. Pick one that fits your GPU memory (`qwen3.5:4b`
for 4 GB, larger models for more); `ollama ps` should show it mostly on GPU.

Check it: `docker compose logs -f ai_ml`, or try questions by hand at
http://localhost:8001/docs. A first answer can take 10–60 seconds on a
laptop.

Without Ollama the site still works: the chat says the assistant is
unavailable, and new forum posts wait in the Moderation page for a
moderator or admin to publish them (`MODERATION_ENABLED=false` in `.env`
skips the check instead).

## Sending real emails

Verification and password reset codes are sent by email once you add
an email account to `.env`. With Gmail:

1. Turn on 2-step verification for the Google account.
2. Create an app password at https://myaccount.google.com/apppasswords.
3. In `.env`, set:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_USER=your-address@gmail.com
   SMTP_PASS=abcdefghijklmnop          # the 16-letter app password, no spaces
   SMTP_FROM=SDU Helpdesk <your-address@gmail.com>
   ```
4. Restart: `docker compose up -d`

Never commit `.env`: it holds the password. It is already in
`.gitignore`. If it leaks, delete the app password in your Google account
and create a new one.

## Developing the website

For instant reload while editing `src/`, run the backend in Docker and the
website with Vite:

```bash
docker compose up -d db app   # database + backend only
npm install
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` to the backend on
port 8080 (see `vite.config.ts`).

No Docker at hand? Set `VITE_USE_MOCK_API=true` in `.env` and run
`npm run dev`: the forum and FAQ use built-in demo data. Login still
needs the backend.

Backend changes (`backend/`) need a rebuild: `docker compose up -d --build app`.

## Admin accounts

There's no "make me admin" button by design. Put the email in `.env`:

```
ADMIN_EMAILS=240103115@sdu.edu.kz,another@sdu.edu.kz
```

Then run `docker compose up -d`, and log out and back in.

Admin emails may be from any domain (e.g. a team Gmail); students still need
an `@sdu.edu.kz` address. Admins get the **Admin panel** in the sidebar (on
phones: Settings → Admin panel): the moderation queue of posts the AI held
back, with publish/reject, status tabs, date filters and newest/oldest order,
and the **FAQ** editor (questions and answers in all three languages, category,
order, and which questions are instant-answer buttons in the chat).

To be logged in as a student and an admin at the same time, use two
addresses (`http://localhost:3000` and `http://127.0.0.1:3000`) or an
incognito window: tabs of one address share one login.

## Looking at the database

```bash
# all tables
docker exec sdu_ai_helpdesk-db-1 psql -U campus_forum -c "\dt"

# all users (passwords are stored only as hashes)
docker exec sdu_ai_helpdesk-db-1 psql -U campus_forum -c "SELECT id, email, display_name, role FROM users"

# forum questions with their authors
docker exec sdu_ai_helpdesk-db-1 psql -U campus_forum -c "SELECT t.id, t.title, u.display_name AS author FROM threads t JOIN users u ON u.id = t.user_id"
```

Or connect a database app (DBeaver, pgAdmin) to `localhost:5432`.
Database and user are `campus_forum`, and the password is `DB_PASSWORD`
from `.env` (default `campus_forum`).

**Where data lives:** accounts (with avatars), forum posts, chats and FAQ
are in the Postgres Docker volume `sdu_ai_helpdesk_db-data`; uploaded photos
and avatars are in `sdu_ai_helpdesk_app-data`. Stopping or rebuilding keeps both.
`docker compose down -v` **deletes everything**, so only use it to start
from an empty database. The language choice and which answers you liked are
remembered in each user's browser.

## Putting it on a server

The same `docker compose up -d --build` works on any Linux server with
Docker. In the server's `.env`:

- set `WEB_PORT=80` so the site opens at `http://<server-address>`
- set `PUBLIC_URL` to that address
- set a strong `DB_PASSWORD` **before the first start**. Postgres stores the
  password when it creates the database; changing it later in `.env`
  doesn't change it in the database.
- fill in the `SMTP_*` settings so students receive their codes

The database (5432) and backend (8080) ports only accept connections from
the server itself; visitors reach everything through the website port.
HTTPS isn't included. For a public site, put a proxy that provides
HTTPS (for example Caddy, or Cloudflare) in front of the website port.

## Troubleshooting

| Problem | Fix |
|---|---|
| `docker: ... cannot find the file specified` / "daemon is not running" | Open Docker Desktop and wait until it says it's running. |
| Chat says the assistant is unavailable | Ollama isn't running, or the model in `LLM_MODEL` isn't pulled: `ollama list`. Then `docker compose logs ai_ml`. |
| `port is already allocated` | Something else uses 3000, 8080, 8001 or 5432. Change `WEB_PORT` in `.env`, or stop the other program. |
| Site loads but login says it can't reach the server | Backend isn't up yet or crashed: `docker compose logs app`. |
| "Too many attempts" | Login, sign up and code checks are limited to about one try every 5 seconds. Wait a moment. |
| Code email doesn't arrive | Check spam. Check the `SMTP_*` values in `.env`, then `docker compose up -d`. Without `SMTP_HOST` the code is shown on screen instead. |
| Changes to the code don't show up | Rebuild: `docker compose up -d --build`. |

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query,
Axios. Backend: Go, PostgreSQL 16. Feature-based layout in `src/`:
`app/` (router, providers), `pages/`, `features/<area>/` (API hooks +
components), `entities/` (shared types), `shared/` (UI kit, API client,
helpers), `i18n/` (EN/KZ/RU).
