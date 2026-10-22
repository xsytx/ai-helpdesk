"""Сквозной тест: настоящие индекс/ретривер/промпт/HTTP-клиент; подменены только E5 и сервер Ollama."""
import json
import re
import tempfile
import unittest
from pathlib import Path

import httpx
import numpy as np
from fastapi.testclient import TestClient

from kb.api import create_app
from kb.audit import RequestJournal
from kb.config import Settings, resolve_path
from kb.generation import AnswerService
from kb.index import VectorIndex
from kb.llm import OllamaClient
from kb.moderation import ModerationService
from kb.retrieval import Retriever

INDEX = VectorIndex.load(resolve_path('data/index'))


class FakeEncoder:
    """Имитация E5: знакомый вопрос -> его вектор с шумом (как перефразировка), незнакомый -> случайный вектор."""
    def __init__(self):
        self.by_question = {r['question']: i for i, r in enumerate(INDEX.records)}

    def encode(self, texts, query=False):
        text = texts[0]
        if text.startswith('~'):
            v = INDEX.vectors[self.by_question[text[1:]]].copy()
            v += np.random.default_rng(1).normal(0, 0.012, v.shape).astype(np.float32)
        else:
            v = np.random.default_rng(abs(hash(text)) % 2**32).normal(size=INDEX.vectors.shape[1]).astype(np.float32)
        return (v / np.linalg.norm(v))[None, :]


class FakeOllama:
    """Ведёт себя как qwen3: читает промпт, выбирает кандидата по словам вопроса, отвечает JSON-ом."""
    def __init__(self):
        self.requests = []

    def __call__(self, request):
        if request.url.path == '/api/tags':
            return httpx.Response(200, json={'models': [{'name': 'qwen3:4b'}]})
        if request.url.path == '/api/generate':
            return httpx.Response(200, json={'done': True})
        body = json.loads(request.content)
        self.requests.append(body)
        user = body['messages'][1]['content']
        lang = re.search(r'LANGUAGE: (\w+)', user).group(1)
        question = user.split('STUDENT QUESTION:\n', 1)[1]
        cands = re.findall(r'\[(\d+)\] Q: (.*)\n    A: (.*)', user)
        match = 0
        if cands and question.startswith('~'):
            match = int(next(n for n, q, a in cands if q == question[1:]))
        general = {'Russian': 'Общий ответ модели без базы.', 'English': 'A general answer from the model without the database.',
                   'Kazakh': 'Дерекқорсыз модельдің жалпы жауабы, толығырақ түсіндірме.'}[lang]
        answer = f'Пояснение к ответу: {cands[match - 1][2]}' if match else general
        return httpx.Response(200, json={'message': {'content': json.dumps({'match': match, 'answer': answer}, ensure_ascii=False)}, 'done': True})


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.ollama = FakeOllama()
        http = httpx.Client(base_url='http://ollama.test', transport=httpx.MockTransport(self.ollama))
        client = OllamaClient('qwen3:4b', 'http://ollama.test', http=http)
        settings = Settings()
        service = AnswerService(Retriever(FakeEncoder(), INDEX, settings.top_k, settings.candidate_floor), client,
                                settings.read_context(), settings.source_only_min)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        app = create_app(service, RequestJournal(Path(tmp.name) / 'r.sqlite3'), ModerationService(client), client, settings)
        self.client = self.enterContext(TestClient(app))

    def ask(self, q, **kw):
        r = self.client.post('/generate-answer', json={'question': q, **kw})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_paraphrase_of_known_question_uses_database(self):
        rec = next(r for r in INDEX.records if r['language'] == 'ru' and len(r['answer']) > 40)
        body = self.ask('~' + rec['question'])
        self.assertEqual((body['status'], body['basis']), ('answered', 'retrieved'))
        self.assertEqual(body['forum_answer'], rec['answer'])
        self.assertTrue(body['ai_explanation'].startswith('Пояснение'))
        self.assertGreater(body['retrieval_score'], 0.9)
        sent = self.ollama.requests[-1]
        self.assertIs(sent['think'], False)
        self.assertEqual(sent['model'], 'qwen3:4b')
        self.assertIn(rec['question'], sent['messages'][1]['content'])

    def test_unknown_question_is_answered_by_model_itself(self):
        body = self.ask('Как работает квантовая запутанность?')
        self.assertEqual((body['status'], body['basis']), ('answered', 'general'))
        self.assertIsNone(body['forum_answer'])
        self.assertEqual(body['answer'], 'Общий ответ модели без базы.')
        sent = self.ollama.requests[-1]['messages'][1]['content']
        self.assertIn('FAQ CANDIDATES: none', sent)  # случайный вектор не набирает порог -> модель не отвлекается на базу

    def test_language_is_detected_per_question(self):
        self.assertEqual(self.ask('How does quantum entanglement work?')['language'], 'en')
        self.assertEqual(self.ask('Кванттық шатасу қалай жұмыс істейді?')['language'], 'kk')

    def test_health_and_moderation(self):
        self.assertEqual(self.client.get('/health').json()['status'], 'ok')
        r = self.client.post('/moderate', json={'text': 'ты хуйло'}).json()
        self.assertEqual((r['decision'], r['categories']), ('block', ['profanity']))
