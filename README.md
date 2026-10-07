# SDU Helpdesk

A help platform for SDU students: an AI assistant, a student forum, campus
navigation, and course descriptions, in English, Kazakh, and Russian.
Sign-in is restricted to `@sdu.edu.kz` university email addresses.

| Part | Status |
|---|---|
| Accounts (sign up, 6-digit email verification, login, forgot/change password) | Working |
| Forum (questions, answers, likes, best answer on top) | Working |
| FAQ | Working (content managed in the database) |
| Settings (avatar, password, language) | Working (avatar is saved in the browser only) |
| AI chat assistant | Interface only, waiting for the ML service |
| Campus maps, courses | Placeholder pages |

## What's in this repo

```
src/                React + TypeScript website (Vite, Tailwind, React Query)
backend/            Go API + PostgreSQL schema (see backend/README.md)
docker-compose.yml  Runs everything: database, backend, website
Dockerfile          Builds the website and serves it with nginx
nginx.conf          Serves the website, forwards /api to the backend
.env.example        Settings template: copy to .env
```

## Run it (Docker, recommended)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/),
and it must be **open and running**.

```bash
git clone https://github.com/xsytx/ai-helpdesk-frontend.git
cd ai-helpdesk-frontend
cp .env.example .env          # Windows PowerShell: copy .env.example .env
docker compose up -d --build
```

The first start takes a few minutes. Then open **http://localhost:3000**.

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

**Where data lives:** accounts, forum posts and FAQ are in the Postgres
Docker volume `sdu_ai_helpdesk_db-data`. Stopping or rebuilding keeps it.
`docker compose down -v` **deletes everything**, so only use it to start
from an empty database. Avatars, likes and the language choice are stored
in each user's browser.

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
| `port is already allocated` | Something else uses 3000, 8080 or 5432. Change `WEB_PORT` in `.env`, or stop the other program. |
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
