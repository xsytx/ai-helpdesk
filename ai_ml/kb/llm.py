"""Клиенты LLM.

* OllamaClient — родной API Ollama (/api/chat). Это важно для qwen3:
  - think=False отключает «рассуждения» (на CPU они давали 3-минутные таймауты);
  - format=<JSON schema> заставляет модель выдавать валидный JSON;
  - keep_alive держит модель в памяти, num_ctx/num_predict ограничивают время.
* OpenAICompatClient — OpenAI / Gemini (OpenAI-совместимый Chat Completions).

Запасная модель (LLM_FALLBACK_MODEL): если основная перегружена (503/429,
в том числе исчерпан бесплатный лимит) или её больше нет (404, модель
сняли с поддержки), запрос повторяется на запасной. У каждой модели Gemini
свой лимит, так что запасная почти удваивает запас.
"""
import json
import logging
import re
import time

import httpx

LOGGER = logging.getLogger(__name__)


class LLMError(RuntimeError):
    """Ошибка инфраструктуры LLM (не «не знаю»). code — машинное имя причины."""
    def __init__(self, message, code='llm_unavailable'):
        super().__init__(message)
        self.code = code


_THINK = re.compile(r'<think>.*?</think>', re.S)
RETRYABLE = {'llm_overloaded'}
# Ошибки, при которых пробуем запасную модель (не таймаут: он удвоил бы ожидание).
FALLBACK_ON = {'llm_overloaded', 'llm_model_missing'}


def clean_text(text):
    return _THINK.sub('', text or '').strip()


def parse_json_object(text):
    """Достаёт JSON-объект из ответа модели; терпим к обёрткам ```json и лишнему тексту."""
    text = clean_text(text)
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    try:
        value = json.loads(text)
    except ValueError:
        start, end = text.find('{'), text.rfind('}')
        if start < 0 or end <= start:
            raise ValueError('No JSON object in model output')
        value = json.loads(text[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError('Model output is not a JSON object')
    return value


class _BaseClient:
    provider = 'base'

    def __init__(self, model, base_url, timeout, headers=None, http=None, fallback_model=''):
        if not model.strip():
            raise ValueError('LLM_MODEL is empty.')
        if timeout <= 0:
            raise ValueError('LLM_TIMEOUT_SECONDS must be positive.')
        self.model = model.strip()
        fallback = (fallback_model or '').strip()
        self.fallback_model = '' if fallback == self.model else fallback
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.http = http or httpx.Client(base_url=self.base_url, headers=headers or {},
                                         timeout=httpx.Timeout(timeout, connect=5.0))

    def _post(self, path, payload):
        try:
            return self.http.post(path, json=payload)
        except httpx.ConnectError as exc:
            raise LLMError(f'LLM server is not reachable at {self.base_url}. Is Ollama running?') from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f'LLM did not answer within {self.timeout:.0f}s.', code='llm_timeout') from exc
        except httpx.HTTPError as exc:
            raise LLMError(f'LLM request failed: {type(exc).__name__}.') from exc

    def _missing_hint(self, model):
        return "Check LLM_MODEL against the provider's list of models (it may be retired or misspelled)."

    def _check(self, response, model=None):
        status = response.status_code
        if status < 400:
            return
        model = model or self.model
        if status == 404:
            raise LLMError(f'Model "{model}" not found. {self._missing_hint(model)}', code='llm_model_missing')
        if status in (401, 403):
            raise LLMError('LLM rejected the API key.', code='llm_auth')
        if status == 429 or status >= 500:
            raise LLMError(f'LLM server returned HTTP {status}.', code='llm_overloaded')
        raise LLMError(f'LLM server returned HTTP {status}.')

    def chat_json(self, messages, schema=None, max_tokens=None):
        """Возвращает текст ответа (JSON): 2 попытки при перегрузке, затем запасная модель."""
        models = [self.model] + ([self.fallback_model] if self.fallback_model else [])
        for i, model in enumerate(models):
            try:
                return self._with_retry(messages, schema, max_tokens, model)
            except LLMError as exc:
                if exc.code not in FALLBACK_ON or i == len(models) - 1:
                    raise
                LOGGER.warning('LLM model %s failed (%s): using the fallback model %s', model, exc.code, models[i + 1])

    def _with_retry(self, messages, schema, max_tokens, model):
        for attempt in range(2):
            try:
                return self._chat_once(messages, schema, max_tokens, model)
            except LLMError as exc:
                if exc.code not in RETRYABLE or attempt == 1:
                    raise
                time.sleep(1.5)

    def _chat_once(self, messages, schema, max_tokens, model):
        raise NotImplementedError

    def chat_json_stream(self, messages, schema=None, max_tokens=None):
        """Текст ответа по кусочкам (генератор). Без потоковой поддержки — один кусок целиком."""
        yield self.chat_json(messages, schema, max_tokens)

    def ping(self):
        raise NotImplementedError

    def warmup(self):
        return None


class OllamaClient(_BaseClient):
    provider = 'ollama'

    def __init__(self, model='qwen3:4b', base_url='http://127.0.0.1:11434', timeout=120.0,
                 num_ctx=4096, num_predict=450, keep_alive='30m', temperature=0.2, http=None, fallback_model=''):
        super().__init__(model, base_url, timeout, http=http, fallback_model=fallback_model)
        self.num_ctx, self.num_predict, self.keep_alive, self.temperature = num_ctx, num_predict, keep_alive, temperature
        self._supports_think = True

    def _missing_hint(self, model):
        return f'Run: ollama pull {model}'

    def _payload(self, messages, schema, max_tokens, stream, model=None):
        payload = {
            'model': model or self.model, 'messages': messages, 'stream': stream,
            'keep_alive': self.keep_alive,
            'options': {'temperature': self.temperature, 'num_ctx': self.num_ctx,
                        'num_predict': max_tokens or self.num_predict},
        }
        payload['format'] = schema if schema else 'json'
        if self._supports_think:
            payload['think'] = False
        return payload

    def chat_json_stream(self, messages, schema=None, max_tokens=None):
        """Токены ответа по мере генерации (stream=true в Ollama). Если генератор закрыть раньше
        (студент нажал «стоп»), соединение с Ollama закрывается и модель перестаёт генерировать."""
        payload = self._payload(messages, schema, max_tokens, stream=True)
        try:
            with self.http.stream('POST', '/api/chat', json=payload) as response:
                if response.status_code >= 400:
                    body = response.read().decode('utf-8', 'replace')
                    if response.status_code == 400 and 'think' in body.lower() and self._supports_think:
                        self._supports_think = False
                        yield from self.chat_json_stream(messages, schema, max_tokens)
                        return
                    self._check(response)
                got_text = False
                for line in response.iter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError as exc:
                        raise LLMError('Ollama returned an unexpected response.', code='llm_bad_response') from exc
                    if chunk.get('error'):
                        raise LLMError(f'Ollama error: {chunk["error"]}', code='llm_overloaded')
                    piece = (chunk.get('message') or {}).get('content') or ''
                    if piece:
                        got_text = True
                        yield piece
                    if chunk.get('done'):
                        break
                if not got_text:
                    raise LLMError('Ollama returned an empty answer.', code='llm_bad_response')
        except httpx.ConnectError as exc:
            raise LLMError(f'LLM server is not reachable at {self.base_url}. Is Ollama running?') from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f'LLM did not answer within {self.timeout:.0f}s.', code='llm_timeout') from exc
        except httpx.HTTPError as exc:
            raise LLMError(f'LLM request failed: {type(exc).__name__}.') from exc

    def _chat_once(self, messages, schema, max_tokens, model):
        payload = self._payload(messages, schema, max_tokens, stream=False, model=model)
        response = self._post('/api/chat', payload)
        if response.status_code == 400 and 'think' in response.text.lower() and self._supports_think:
            # Старая версия Ollama / модель без режима thinking: повторяем без параметра.
            self._supports_think = False
            payload.pop('think', None)
            response = self._post('/api/chat', payload)
        self._check(response, model)
        try:
            content = response.json()['message']['content']
        except (ValueError, KeyError, TypeError) as exc:
            raise LLMError('Ollama returned an unexpected response.', code='llm_bad_response') from exc
        text = clean_text(content)
        if not text:
            raise LLMError('Ollama returned an empty answer.', code='llm_bad_response')
        return text

    def ping(self):
        """Диагностика для /health и `kb.cli doctor`."""
        info = {'provider': 'ollama', 'model': self.model, 'reachable': False, 'model_available': False}
        try:
            response = self.http.get('/api/tags', timeout=5.0)
            response.raise_for_status()
            names = [m.get('name', '') for m in response.json().get('models', [])]
        except (httpx.HTTPError, ValueError):
            return info
        info['reachable'] = True
        wanted = self.model if ':' in self.model else self.model + ':latest'
        info['model_available'] = wanted in names
        info['installed_models'] = names
        return info

    def warmup(self):
        """Загружает модель в память заранее, чтобы первый вопрос студента не ждал загрузки."""
        self._post('/api/generate', {'model': self.model, 'keep_alive': self.keep_alive})


class OpenAICompatClient(_BaseClient):
    URLS = {'openai': 'https://api.openai.com/v1', 'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai'}

    def __init__(self, provider, model, api_key, base_url='', timeout=60.0, temperature=0.2, http=None, fallback_model=''):
        if provider not in self.URLS:
            raise ValueError('provider must be openai or gemini')
        if not api_key.strip():
            raise ValueError(f'Set LLM_API_KEY for provider {provider}.')
        self.provider = provider
        super().__init__(model, base_url or self.URLS[provider], timeout,
                         headers={'Authorization': 'Bearer ' + api_key.strip()}, http=http, fallback_model=fallback_model)
        self.temperature = temperature

    def _chat_once(self, messages, schema, max_tokens, model):
        payload = {'model': model, 'messages': messages, 'stream': False, 'temperature': self.temperature,
                   'response_format': {'type': 'json_object'}}
        if max_tokens:
            payload['max_tokens'] = max_tokens
        response = self._post('/chat/completions', payload)
        self._check(response, model)
        try:
            text = response.json()['choices'][0]['message']['content']
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMError('Provider returned an unexpected response.', code='llm_bad_response') from exc
        text = clean_text(text)
        if not text:
            raise LLMError('Provider returned an empty answer.', code='llm_bad_response')
        return text

    def ping(self):
        return {'provider': self.provider, 'model': self.model, 'fallback_model': self.fallback_model,
                'reachable': True, 'model_available': True}


def make_client(settings):
    if settings.llm_provider == 'ollama':
        return OllamaClient(settings.llm_model, settings.llm_base_url or 'http://127.0.0.1:11434',
                            settings.llm_timeout, settings.llm_num_ctx, settings.llm_num_predict,
                            settings.llm_keep_alive, fallback_model=settings.llm_fallback_model)
    if settings.llm_provider in OpenAICompatClient.URLS:
        return OpenAICompatClient(settings.llm_provider, settings.llm_model, settings.llm_api_key,
                                  settings.llm_base_url, settings.llm_timeout,
                                  fallback_model=settings.llm_fallback_model)
    raise ValueError('LLM_PROVIDER must be ollama, openai or gemini.')
