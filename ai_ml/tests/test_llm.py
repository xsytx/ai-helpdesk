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


def gemini_with(handler, fallback=''):
    http = httpx.Client(base_url='http://gemini.test', transport=httpx.MockTransport(handler))
    return OpenAICompatClient('gemini', 'main-flash', 'k', http=http, fallback_model=fallback)


def answer(content):
    return httpx.Response(200, json={'choices': [{'message': {'content': content}}]})


class FallbackTests(unittest.TestCase):
    def run_with(self, statuses, fallback='spare-lite'):
        """statuses: model -> HTTP status it answers (200 = an answer)."""
        seen = []

        def handler(request):
            model = json.loads(request.content)['model']
            seen.append(model)
            status = statuses[model]
            return answer('{"from":"%s"}' % model) if status == 200 else httpx.Response(status, text='x')
        with patch('kb.llm.time.sleep'):
            try:
                return gemini_with(handler, fallback).chat_json([]), seen
            except LLMError as exc:
                return exc, seen

    def test_overloaded_main_model_falls_back(self):
        out, seen = self.run_with({'main-flash': 503, 'spare-lite': 200})
        self.assertEqual(out, '{"from":"spare-lite"}')
        self.assertEqual(seen, ['main-flash', 'main-flash', 'spare-lite'])  # one retry, then the spare

    def test_daily_limit_and_retired_model_fall_back(self):
        for status in (429, 404):
            out, seen = self.run_with({'main-flash': status, 'spare-lite': 200})
            self.assertEqual(out, '{"from":"spare-lite"}', status)

    def test_healthy_main_model_never_touches_the_spare(self):
        out, seen = self.run_with({'main-flash': 200, 'spare-lite': 200})
        self.assertEqual(seen, ['main-flash'])

    def test_other_errors_do_not_fall_back(self):
        out, seen = self.run_with({'main-flash': 401, 'spare-lite': 200})
        self.assertEqual(out.code, 'llm_auth')
        self.assertEqual(seen, ['main-flash'])

    def test_both_down_reports_the_spare_error(self):
        out, seen = self.run_with({'main-flash': 503, 'spare-lite': 503})
        self.assertEqual(out.code, 'llm_overloaded')
        self.assertEqual(seen, ['main-flash', 'main-flash', 'spare-lite', 'spare-lite'])

    def test_no_fallback_configured(self):
        out, seen = self.run_with({'main-flash': 503}, fallback='')
        self.assertEqual(out.code, 'llm_overloaded')
        self.assertEqual(seen, ['main-flash', 'main-flash'])

    def test_missing_model_message_fits_the_provider(self):
        out, _ = self.run_with({'main-flash': 404}, fallback='')
        self.assertNotIn('ollama', str(out).lower())
        c = client_with(lambda r: httpx.Response(404, text='x'))
        with self.assertRaises(LLMError) as ctx:
            c.chat_json([])
        self.assertIn('ollama pull qwen3:4b', str(ctx.exception))


class ParseTests(unittest.TestCase):
    def test_tolerant_parsing(self):
        self.assertEqual(parse_json_object('```json\n{"a":1}\n```'), {'a': 1})
        self.assertEqual(parse_json_object('Вот ответ: {"a": 2} готово'), {'a': 2})
        for bad in ['', 'нет json', '[1]']:
            with self.assertRaises(ValueError):
                parse_json_object(bad)
