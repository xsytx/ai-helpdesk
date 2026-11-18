#!/usr/bin/env bash
# Backs up everything the site keeps: the database (pg_dump, custom format)
# and the uploaded files (forum and place photos, avatars) into a folder
# OUTSIDE the repository (default: ../backups next to it), and keeps the
# newest 10 of each. Run from Git Bash while `docker compose` is up:
#
#   bash scripts/backup.sh            # -> ../backups/db-<time>.dump, uploads-<time>.tar
#   bash scripts/backup.sh D:/sdu     # another folder (a USB stick, OneDrive…)
#
# Restore (stops nothing; replaces the database contents and the files):
#   docker exec -i sdu_ai_helpdesk-db-1 pg_restore -U campus_forum -d campus_forum --clean --if-exists < db-<time>.dump
#   docker exec -i sdu_ai_helpdesk-app-1 tar -C /data -xf - < uploads-<time>.tar
#   docker compose restart app
set -euo pipefail
# Git Bash on Windows would turn container paths like /data into C:/Program Files/Git/data.
export MSYS_NO_PATHCONV=1

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/../backups}"
mkdir -p "$out"
stamp="$(date +%Y%m%d-%H%M%S)"
db="$out/db-$stamp.dump"
files="$out/uploads-$stamp.tar"
# A step that fails leaves no half-written files behind.
trap 'rm -f "$db" "$files"' ERR

docker exec sdu_ai_helpdesk-db-1 pg_dump -U campus_forum -Fc campus_forum > "$db"
docker exec sdu_ai_helpdesk-app-1 tar -C /data -cf - uploads > "$files"

# A dump that pg_restore can't list is broken: don't keep it silently.
tables="$(docker exec -i sdu_ai_helpdesk-db-1 pg_restore -l < "$db" | grep -c 'TABLE DATA' || true)"
if [ "${tables:-0}" -eq 0 ]; then
  echo "backup FAILED: $db has no table data" >&2
  exit 1
fi

# Keep the newest 10 of each kind.
ls -1t "$out"/db-[0-9]*.dump 2>/dev/null | tail -n +11 | xargs -r rm --
ls -1t "$out"/uploads-[0-9]*.tar 2>/dev/null | tail -n +11 | xargs -r rm --

echo "backup ok: $db ($(du -h "$db" | cut -f1), $tables tables), $files ($(du -h "$files" | cut -f1))"
