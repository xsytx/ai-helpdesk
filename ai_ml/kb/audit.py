"""Persistent request journal; no API keys or raw exception messages."""
from contextlib import contextmanager
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class RequestJournal:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS answer_requests (
                request_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                question TEXT NOT NULL, language TEXT NOT NULL,
                status TEXT NOT NULL, http_status INTEGER,
                duration_ms INTEGER, response_json TEXT)""")
            db.execute('CREATE INDEX IF NOT EXISTS requests_status_date ON answer_requests(status, created_at)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self, request_id, question, language):
        with self.connect() as db:
            db.execute('INSERT INTO answer_requests (request_id, created_at, question, language, status) VALUES (?, ?, ?, ?, ?)',
                       (request_id, datetime.now(timezone.utc).isoformat(), question, language, 'processing'))

    def finish(self, request_id, response, http_status, duration_ms):
        with self.connect() as db:
            db.execute('UPDATE answer_requests SET status=?, http_status=?, duration_ms=?, response_json=? WHERE request_id=?',
                       (response.get('status', 'error'), http_status, duration_ms,
                        json.dumps(response, ensure_ascii=False, allow_nan=False), request_id))
