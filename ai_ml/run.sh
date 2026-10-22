#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
.venv/bin/python -m kb.cli doctor || true
exec .venv/bin/python -m uvicorn kb.api:app --host 127.0.0.1 --port 8001 --workers 1
