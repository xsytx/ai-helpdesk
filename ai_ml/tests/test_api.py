import json
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

from fastapi.testclient import TestClient
from kb.api import create_app
from kb.audit import RequestJournal
from kb.config import Settings
from kb.llm import LLMError

ANSWER = dict(status='answered', forum_answer='Original', ai_explanation='Explained', answer='Explained', language='ru',
              basis='retrieved', reason=None, source={'id': 'f1'}, source_type='faq', retrieval_score=0.9)


class ApiTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'requests.sqlite3'
        self.service = Mock()
        self.service.answer.return_value = dict(ANSWER)
        self.moderator = Mock()
        self.moderator.moderate.return_value = {'decision': 'allow', 'publish_allowed': True, 'categories': [],
                                                'reason': 'ok', 'policy_version': 'toxicity-v2'}
        self.llm = Mock()
        self.llm.ping.return_value = {'reachable': True, 'model_available': True, 'model': 'qwen3:4b'}
        self.settings = Settings(queue_timeout=0.3, max_concurrency=1)
        app = create_app(self.service, RequestJournal(self.path), self.moderator, self.llm, self.settings)
        self.client = self.enterContext(TestClient(app))

    def rows(self):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute('SELECT question, status, http_status FROM answer_requests').fetchall()

    def test_success_default_language_is_auto_and_logged(self):
        r = self.client.post('/generate-answer', json={'question': '  Вопрос?  '})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['forum_answer'], 'Original')
        self.service.answer.assert_called_once_with('Вопрос?', 'auto')
        self.assertEqual(self.rows(), [('Вопрос?', 'answered', 200)])

    def test_explicit_language_and_validation(self):
        self.client.post('/generate-answer', json={'question': 'Q?', 'language': 'kk'})
        self.service.answer.assert_called_with('Q?', 'kk')
        for body in [{'question': '   '}, {'question': 'x' * 2001}, {'question': 'Q', 'language': 'de'}, {'question': 'Q', 'x': 1}, {}]:
            self.assertEqual(self.client.post('/generate-answer', json=body).status_code, 422, body)

    def test_fallback_is_http_200(self):
        self.service.answer.return_value = dict(ANSWER, status='fallback', basis='none', reason='llm_timeout',
                                                forum_answer=None, source=None, source_type=None)
        r = self.client.post('/generate-answer', json={'question': 'Q?'})
        self.assertEqual((r.status_code, r.json()['status']), (200, 'fallback'))

    def test_pipeline_errors_hide_details(self):
        self.service.answer.side_effect = RuntimeError('postgres://user:secret@host')
        r = self.client.post('/generate-answer', json={'question': 'Q?'})
        self.assertEqual((r.status_code, r.json()['error']), (503, 'pipeline_unavailable'))
        self.assertNotIn('secret', r.text)
        self.service.answer.side_effect = LLMError('x', 'llm_model_missing')
        self.assertEqual(self.client.post('/generate-answer', json={'question': 'Q?'}).status_code, 502)

    def test_request_waits_in_queue_instead_of_instant_503(self):
        def slow(question, language):
            time.sleep(0.1)
            return dict(ANSWER)
        self.service.answer.side_effect = slow
        codes = []
        threads = [threading.Thread(target=lambda: codes.append(self.client.post('/generate-answer', json={'question': 'Q?'}).status_code)) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(codes, [200, 200])

    def test_busy_after_queue_timeout(self):
        def slow(question, language):
            time.sleep(0.8)
            return dict(ANSWER)
        self.service.answer.side_effect = slow
        codes = []
        threads = [threading.Thread(target=lambda: codes.append(self.client.post('/generate-answer', json={'question': 'Q?'}).status_code)) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(codes), [200, 503])

    def test_moderate(self):
        r = self.client.post('/moderate', json={'text': 'Привет'})
        self.assertEqual((r.status_code, r.json()['decision']), (200, 'allow'))
        self.moderator.moderate.return_value = {'decision': 'block', 'publish_allowed': False, 'categories': ['profanity'],
                                                'reason': 'profanity_filter', 'policy_version': 'toxicity-v2'}
        self.assertEqual(self.client.post('/moderate', json={'text': 'x'}).json()['categories'], ['profanity'])
        self.assertEqual(self.client.post('/moderate', json={'text': '  '}).status_code, 422)

    def test_health(self):
        body = self.client.get('/health').json()
        self.assertEqual(body['status'], 'ok')
        self.llm.ping.return_value = {'reachable': True, 'model_available': False}
        self.assertEqual(self.client.get('/health').json()['status'], 'degraded')
