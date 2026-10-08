"""Клиенты LLM.

* OllamaClient — родной API Ollama (/api/chat). Это важно для qwen3:
  - think=False отключает «рассуждения» (на CPU они давали 3-минутные таймауты);
  - format=<JSON schema> заставляет модель выдавать валидный JSON;
  - keep_alive держит модель в памяти, num_ctx/num_predict ограничивают время.
* OpenAICompatClient — OpenAI / Gemini (OpenAI-совместимый Chat Completions), если когда-нибудь понадобится.
"""
import json
import re
import time

import httpx


class LLMError(RuntimeError):
    """Ошибка инфраструктуры LLM (не «не знаю»). code — машинное имя причины."""
    def __init__(self, message, code='llm_unavailable'):
        super().__init__(message)
        self.code = code


_THINK = re.compile(r'<think>.*?</think>', re.S)
RETRYABLE = {'llm_overloaded'}


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

    def __init__(self, model, base_url, timeout, headers=None, http=None):
        if not model.strip():
            raise ValueError('LLM_MODEL is empty.')
        if timeout <= 0:
            raise ValueError('LLM_TIMEOUT_SECONDS must be positive.')
        self.model = model.strip()
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

    def _check(self, response):
        status = response.status_code
        if status < 400:
            return
        if status == 404:
            raise LLMError(f'Model "{self.model}" not found. Run: ollama pull {self.model}', code='llm_model_missing')
        if status in (401, 403):
            raise LLMError('LLM rejected the API key.', code='llm_auth')
        if status == 429 or status >= 500:
            raise LLMError(f'LLM server returned HTTP {status}.', code='llm_overloaded')
        raise LLMError(f'LLM server returned HTTP {status}.')

    def chat_json(self, messages, schema=None, max_tokens=None):
        """Возвращает текст ответа (JSON). 2 попытки при перегрузке сервера."""
        for attempt in range(2):
            try:
                return self._chat_once(messages, schema, max_tokens)
            except LLMError as exc:
                if exc.code not in RETRYABLE or attempt == 1:
                    raise
                time.sleep(1.5)

    def _chat_once(self, messages, schema, max_tokens):
        raise NotImplementedError

    def ping(self):
        raise NotImplementedError

    def warmup(self):
        return None


class OllamaClient(_BaseClient):
    provider = 'ollama'

    def __init__(self, model='qwen3:4b', base_url='http://127.0.0.1:11434', timeout=120.0,
                 num_ctx=4096, num_predict=350, keep_alive='30m', temperature=0.2, http=None):
        super().__init__(model, base_url, timeout, http=http)
        self.num_ctx, self.num_predict, self.keep_alive, self.temperature = num_ctx, num_predict, keep_alive, temperature
        self._supports_think = True

    def _chat_once(self, messages, schema, max_tokens):
        payload = {
            'model': self.model, 'messages': messages, 'stream': False,
            'keep_alive': self.keep_alive,
            'options': {'temperature': self.temperature, 'num_ctx': self.num_ctx,
                        'num_predict': max_tokens or self.num_predict},
        }
        payload['format'] = schema if schema else 'json'
        if self._supports_think:
            payload['think'] = False
        response = self._post('/api/chat', payload)
        if response.status_code == 400 and 'think' in response.text.lower() and self._supports_think:
            # Старая версия Ollama / модель без режима thinking: повторяем без параметра.
            self._supports_think = False
            payload.pop('think', None)
            response = self._post('/api/chat', payload)
        self._check(response)
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

    def __init__(self, provider, model, api_key, base_url='', timeout=60.0, temperature=0.2, http=None):
        if provider not in self.URLS:
            raise ValueError('provider must be openai or gemini')
        if not api_key.strip():
            raise ValueError(f'Set LLM_API_KEY for provider {provider}.')
        self.provider = provider
        super().__init__(model, base_url or self.URLS[provider], timeout,
                         headers={'Authorization': 'Bearer ' + api_key.strip()}, http=http)
        self.temperature = temperature

    def _chat_once(self, messages, schema, max_tokens):
        payload = {'model': self.model, 'messages': messages, 'stream': False, 'temperature': self.temperature,
                   'response_format': {'type': 'json_object'}}
        if max_tokens:
            payload['max_tokens'] = max_tokens
        response = self._post('/chat/completions', payload)
        self._check(response)
        try:
            text = response.json()['choices'][0]['message']['content']
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMError('Provider returned an unexpected response.', code='llm_bad_response') from exc
        text = clean_text(text)
        if not text:
            raise LLMError('Provider returned an empty answer.', code='llm_bad_response')
        return text

    def ping(self):
        return {'provider': self.provider, 'model': self.model, 'reachable': True, 'model_available': True}


def make_client(settings):
    if settings.llm_provider == 'ollama':
        return OllamaClient(settings.llm_model, settings.llm_base_url or 'http://127.0.0.1:11434',
                            settings.llm_timeout, settings.llm_num_ctx, settings.llm_num_predict,
                            settings.llm_keep_alive)
    if settings.llm_provider in OpenAICompatClient.URLS:
        return OpenAICompatClient(settings.llm_provider, settings.llm_model, settings.llm_api_key,
                                  settings.llm_base_url, settings.llm_timeout)
    raise ValueError('LLM_PROVIDER must be ollama, openai or gemini.')
