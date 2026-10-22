import json
import unittest
from unittest.mock import patch
import httpx
from kb.llm import LLMError, OllamaClient, OpenAICompatClient, parse_json_object


def client_with(handler, **kw):
    http = httpx.Client(base_url='http://ollama.test', transport=httpx.MockTransport(handler))
    return OllamaClient('qwen3:4b', 'http://ollama.test', http=http, **kw)


def ok(content):
    return httpx.Response(200, json={'message': {'role': 'assistant', 'content': content}, 'done': True})


class OllamaTests(unittest.TestCase):
    def test_payload_disables_thinking_and_uses_schema(self):
        seen = {}

        def handler(request):
            seen.update(json.loads(request.content))
            seen['path'] = request.url.path
            return ok('{"match":0,"answer":"x"}')
        schema = {'type': 'object'}
        self.assertEqual(client_with(handler).chat_json([{'role': 'user', 'content': 'hi'}], schema), '{"match":0,"answer":"x"}')
        self.assertEqual(seen['path'], '/api/chat')
        self.assertIs(seen['think'], False)
        self.assertIs(seen['stream'], False)
        self.assertEqual(seen['format'], schema)
        self.assertEqual(seen['options']['num_ctx'], 4096)
        self.assertEqual(seen['keep_alive'], '30m')

    def test_think_tags_are_stripped(self):
        c = client_with(lambda r: ok('<think>hmm</think>{"a":1}'))
        self.assertEqual(c.chat_json([]), '{"a":1}')

    def test_retries_without_think_when_unsupported(self):
        calls = []

        def handler(request):
            body = json.loads(request.content)
            calls.append('think' in body)
            if 'think' in body:
                return httpx.Response(400, json={'error': '"qwen3" does not support think'})
            return ok('{}')
        self.assertEqual(client_with(handler).chat_json([]), '{}')
        self.assertEqual(calls, [True, False])

    def test_error_codes(self):
        def code(status):
            c = client_with(lambda r: httpx.Response(status, text='x'))
            with patch('kb.llm.time.sleep'):
                with self.assertRaises(LLMError) as ctx:
                    c.chat_json([])
            return ctx.exception.code
        self.assertEqual(code(404), 'llm_model_missing')
        self.assertEqual(code(503), 'llm_overloaded')
        self.assertEqual(code(400), 'llm_unavailable')

    def test_overload_retried_once(self):
        n = {'v': 0}

        def handler(request):
            n['v'] += 1
            return httpx.Response(503) if n['v'] == 1 else ok('{}')
        with patch('kb.llm.time.sleep'):
            self.assertEqual(client_with(handler).chat_json([]), '{}')

    def test_connection_refused_is_fast_and_clear(self):
        def handler(request):
            raise httpx.ConnectError('refused')
        with self.assertRaises(LLMError) as ctx:
            client_with(handler).chat_json([])
        self.assertEqual(ctx.exception.code, 'llm_unavailable')
        self.assertIn('Ollama', str(ctx.exception))

    def test_timeout_code(self):
        def handler(request):
            raise httpx.ReadTimeout('slow')
        with self.assertRaises(LLMError) as ctx:
            client_with(handler).chat_json([])
        self.assertEqual(ctx.exception.code, 'llm_timeout')

    def test_ping(self):
        c = client_with(lambda r: httpx.Response(200, json={'models': [{'name': 'qwen3:4b'}]}))
        self.assertTrue(c.ping()['model_available'])
        c = client_with(lambda r: httpx.Response(200, json={'models': [{'name': 'llama3:8b'}]}))
        info = c.ping()
        self.assertTrue(info['reachable'])
        self.assertFalse(info['model_available'])


class OpenAITests(unittest.TestCase):
    def test_chat_completions(self):
        def handler(request):
            self.assertEqual(request.headers['authorization'], 'Bearer k')
            return httpx.Response(200, json={'choices': [{'message': {'content': '{"ok":1}'}}]})
        http = httpx.Client(base_url='http://x', headers={'Authorization': 'Bearer k'}, transport=httpx.MockTransport(handler))
        c = OpenAICompatClient('openai', 'gpt', 'k', http=http)
        self.assertEqual(c.chat_json([]), '{"ok":1}')

    def test_requires_key(self):
        with self.assertRaises(ValueError):
            OpenAICompatClient('openai', 'gpt', '')


class ParseTests(unittest.TestCase):
    def test_tolerant_parsing(self):
        self.assertEqual(parse_json_object('```json\n{"a":1}\n```'), {'a': 1})
        self.assertEqual(parse_json_object('Вот ответ: {"a": 2} готово'), {'a': 2})
        for bad in ['', 'нет json', '[1]']:
            with self.assertRaises(ValueError):
                parse_json_object(bad)
