# Putting SDU Helpdesk on a server (Azure for Students)

The server runs the same Docker setup as a laptop, plus **Caddy** in front of
it for HTTPS. No domain is needed: Azure gives the server a free address like
`sdu-helpdesk.westeurope.cloudapp.azure.com`, and Caddy gets an HTTPS
certificate for it automatically.

Without Ollama on the server (the default here), the AI chat answers the FAQ
buttons but says "assistant unavailable" for typed questions, and new forum
posts wait for an admin's approval (the instant word filter still runs).
Everything else works as on the laptop.

## 1. Create the server (Azure portal)

1. Activate **Azure for Students** (GitHub Student Pack, no card needed).
2. portal.azure.com → **Virtual machines** → **Create** → **Azure virtual machine**:
   - Resource group: new, `sdu-helpdesk`; VM name: `sdu-helpdesk`.
   - Region: one near Kazakhstan that offers the size below (e.g. *Germany West Central*, *West Europe* or *Central India*).
   - Image: **Ubuntu Server 24.04 LTS**; size: **B2s** (2 vCPU, 4 GiB).
     The student credit ($100) covers about 3 months of it; *stop* the VM
     (portal → Stop) when nobody needs the site, and it costs almost nothing.
   - Authentication: **SSH public key**, username `azureuser`, key pair: generate new
     (download the `.pem` file when asked and keep it safe).
   - Inbound ports: **SSH (22), HTTP (80), HTTPS (443)**.
   - Disks: OS disk type **Standard SSD**.
   - Review + create → Create.
3. When it's ready: VM → **Overview** → *DNS name* → **Not configured** → DNS name label
   `sdu-helpdesk` (or any free name) → Save. Write down the full name, e.g.
   `sdu-helpdesk.germanywestcentral.cloudapp.azure.com` — that's the site's address.

## 2. Prepare the server

From Git Bash on the laptop (the key from step 1):

```bash
ssh -i ~/Downloads/sdu-helpdesk_key.pem azureuser@<the address>
```

On the server:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# 4 GB of swap: building the images and the AI search model need the room.
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
exit
```

(Log in again so the `docker` group applies.)

## 3. Copy the project and its settings

On the server (GitHub asks for your username and a **personal access token**
as the password: GitHub → Settings → Developer settings → Tokens):

```bash
git clone https://github.com/<you>/<repo>.git sdu-helpdesk
```

From the laptop, copy the settings (they hold the email password: never commit them):

```bash
scp -i ~/Downloads/sdu-helpdesk_key.pem .env azureuser@<the address>:sdu-helpdesk/.env
```

Then on the server, `nano sdu-helpdesk/.env` and set:

```
WEB_PORT=127.0.0.1:3000
SITE_ADDRESS=<the address>
PUBLIC_URL=https://<the address>
DB_PASSWORD=<a new long random password>
```

(`DB_PASSWORD` can be anything new here: the server's database is created on first start.)

## 4. Start it

```bash
cd sdu-helpdesk
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The first build takes 10–20 minutes; the AI service then downloads its 1.1 GB
search model once. Open `https://<the address>`: the site with the map seed
(points, stairs, 3D links), but no users, posts or photos yet.

## 5. Move the data from the laptop

On the laptop: `bash scripts/backup.sh`, then copy the newest two files:

```bash
scp -i ~/Downloads/sdu-helpdesk_key.pem ../backups/db-<time>.dump ../backups/uploads-<time>.tar azureuser@<the address>:
```

On the server:

```bash
cd sdu-helpdesk
docker exec -i sdu_ai_helpdesk-db-1 pg_restore -U campus_forum -d campus_forum --clean --if-exists < ~/db-<time>.dump
docker exec -i sdu_ai_helpdesk-app-1 tar -C /data -xf - < ~/uploads-<time>.tar
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart app
```

Everyone signs in again once (the server has its own login key).

## Later

- **Update** after new commits: `git pull` and the `up -d --build` command from step 4.
- **Backups** every night at 3:00 (`crontab -e`, add the line):
  `0 3 * * * cd /home/azureuser/sdu-helpdesk && bash scripts/backup.sh /home/azureuser/backups`
  and now and then copy one to the laptop with `scp`.
- **Logs**: `docker compose logs -f app` (or `web`, `caddy`).
- **The AI** without a GPU: Google's Gemini API (free tier). Get a key at
  aistudio.google.com, add to the server's `.env`:
  `LLM_PROVIDER=gemini`, `LLM_MODEL=gemini-3.5-flash-lite`,
  `LLM_FALLBACK_MODEL=gemini-3.1-flash-lite`, `LLM_API_KEY=<key>`,
  `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
  then the `up -d` command from step 4 (change the existing `LLM_MODEL` line,
  don't add a second one). Google retires model names: if the chat says
  "unavailable", `docker compose logs --tail 30 ai_ml` shows the reason (404 =
  the name is gone: pick a current one in AI Studio; 503 = Google is busy; 429 =
  over the free limit). Lite models have the highest free limits (15 a minute,
  500 a day each as of 2026-11; AI Studio shows yours), and the fallback model
  takes over when the main one is busy, over its limit or retired. Answers then come whole (not word by
  word), and students' questions and new posts are sent to Google, whose free
  tier may use them to improve its products. Ollama on the VM needs 8 GB+ and
  is slow on a CPU.
