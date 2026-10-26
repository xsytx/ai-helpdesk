"""HTTP-интерфейс для Go-backend: POST /generate-answer, POST /moderate, GET /health."""
import asyncio
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .audit import RequestJournal
from .config import ROOT, Settings, resolve_path
from .llm import LLMError
from .moderation import ModerationService

LOGGER = logging.getLogger(__name__)
TRANSIENT = {'llm_overloaded', 'llm_timeout', 'llm_unavailable'}


class HistoryItem(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    role: Literal['user', 'assistant']
    text: str = Field(max_length=4000)


class ForumItem(BaseModel):
    """Опубликованный вопрос форума с лучшим ответом (присылает backend, Stories 8-9)."""
    model_config = ConfigDict(extra='forbid', strict=True)
    thread_id: int
    comment_id: int | None = None
    title: str = Field(max_length=500)
    body: str = Field(default='', max_length=4000)
    answer: str = Field(max_length=10000)
    accepted: bool = False
    likes: int = 0
    staff: bool = False


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    question: str = Field(min_length=1, max_length=2000)
    # 'auto' (по умолчанию) — язык определяется по тексту вопроса
    language: Literal['auto', 'ru', 'kk', 'en'] = 'auto'
    # Предыдущие сообщения этого чата (старые первыми): помогают понять уточняющий вопрос.
    history: list[HistoryItem] = Field(default_factory=list, max_length=20)
    # Отвеченные вопросы форума: бот может взять лучший ответ как «ответ сообщества».
    forum: list[ForumItem] = Field(default_factory=list, max_length=500)

    @field_validator('question')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Question must not be blank')
        return value.strip()


class AnswerResponse(BaseModel):
    request_id: str
    status: Literal['answered', 'fallback']
    answer: str = ''
    forum_answer: str | None
    ai_explanation: str
    language: Literal['ru', 'kk', 'en']
    basis: Literal['retrieved', 'context', 'general', 'none']
    reason: str | None
    source: dict | None
    source_type: str | None
    retrieval_score: float | None
    # Вопросы, которые студент, вероятно, задаст дальше (кнопки под ответом).
    followups: list[str] = []


class ErrorResponse(BaseModel):
    request_id: str
    status: Literal['error'] = 'error'
    error: str


class ModerationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    text: str = Field(min_length=1, max_length=10000)
    # 'fast' = word filter only (milliseconds, no LLM): used before publishing a post.
    mode: Literal['full', 'fast'] = 'full'

    @field_validator('text')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Text must not be blank')
        return value


class ModerationResponse(BaseModel):
    request_id: str
    decision: Literal['allow', 'block', 'review']
    publish_allowed: bool
    categories: list[Literal['profanity', 'harassment', 'hate', 'threat', 'sexual_harassment']]
    reason: str
    policy_version: str


class ModerationError(BaseModel):
    request_id: str
    decision: Literal['review'] = 'review'
    publish_allowed: bool = False
    error: str


def background(payload):
    """history/forum для сервиса — только непустые (сервис их не требует)."""
    out = {}
    if payload.history:
        out['history'] = [h.model_dump() for h in payload.history]
    if payload.forum:
        out['forum'] = [f.model_dump() for f in payload.forum]
    return out


def build_runtime(settings):
    """Тяжёлая часть: эмбеддер, индекс, клиент LLM. Вызывается один раз при старте."""
    from .embedding import E5
    from .forum import ForumSearch
    from .generation import AnswerService
    from .index import VectorIndex
    from .llm import make_client
    from .retrieval import Retriever
    client = make_client(settings)
    index = VectorIndex.load(resolve_path(settings.index_dir))
    encoder = E5(settings.device, settings.batch_size)
    retriever = Retriever(encoder, index, settings.top_k, settings.candidate_floor)
    forum = ForumSearch(encoder, settings.forum_top_k, settings.forum_floor)
    service = AnswerService(retriever, client, settings.read_context(), settings.source_only_min, forum)
    return service, ModerationService(client), client, len(index)


def create_app(service=None, journal=None, moderator=None, llm_client=None, settings=None):
    """service/journal/moderator можно подменить в тестах — тогда модели не загружаются."""
    state = {}

    @asynccontextmanager
    async def lifespan(app):
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
        cfg = settings or Settings.from_env()
        log_path = resolve_path(cfg.request_log)
        app.state.journal = journal if journal is not None else RequestJournal(log_path)
        svc, mod, client, size = service, moderator, llm_client, state.get('index_size')
        if svc is None:
            svc, built_mod, client, size = build_runtime(cfg)
            mod = mod or built_mod
        app.state.service = svc
        app.state.moderator = mod if mod is not None else ModerationService(client)
        app.state.llm = client
        app.state.index_size = size
        app.state.gate = threading.BoundedSemaphore(max(1, cfg.max_concurrency))
        app.state.queue_timeout = cfg.queue_timeout
        if client is not None:
            # Прогрев модели в фоне: первый студент не ждёт загрузку qwen3 в память.
            def warm():
                try:
                    client.warmup()
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning('LLM warm-up failed: %s', exc)
            threading.Thread(target=warm, daemon=True).start()
        yield

    app = FastAPI(title='SDU AI Helpdesk', version='1.0.0', lifespan=lifespan)

    @app.get('/health')
    def health():
        llm = app.state.llm.ping() if app.state.llm is not None else {}
        ok = bool(llm.get('reachable') and llm.get('model_available')) if llm else True
        return {'status': 'ok' if ok else 'degraded', 'index_records': app.state.index_size, 'llm': llm}

    @app.post('/generate-answer', response_model=AnswerResponse,
              responses={502: {'model': ErrorResponse}, 503: {'model': ErrorResponse}})
    def generate(payload: AnswerRequest):
        request_id = str(uuid4())
        started = perf_counter()

        def failure(code):
            return {'request_id': request_id, 'status': 'error', 'error': code}

        try:
            app.state.journal.start(request_id, payload.question, payload.language)
        except Exception:
            LOGGER.error('Request journal unavailable: %s', request_id)
            return JSONResponse(failure('logging_unavailable'), status_code=503)

        if not app.state.gate.acquire(timeout=app.state.queue_timeout):
            result, status = failure('service_busy'), 503
        else:
            try:
                raw = app.state.service.answer(payload.question, payload.language, **background(payload))
                result = AnswerResponse(request_id=request_id, **raw).model_dump()
                status = 200
            except LLMError as exc:
                result = failure(exc.code)
                status = 503 if exc.code in TRANSIENT else 502
            except Exception:
                LOGGER.exception('Answer pipeline failed: %s', request_id)
                result, status = failure('pipeline_unavailable'), 503
            finally:
                app.state.gate.release()
        try:
            app.state.journal.finish(request_id, result, status, round((perf_counter() - started) * 1000))
        except Exception:
            LOGGER.error('Request journal update failed: %s', request_id)
            return JSONResponse(failure('logging_unavailable'), status_code=503)
        return JSONResponse(result, status_code=status)

    @app.post('/generate-answer/stream')
    async def generate_stream(payload: AnswerRequest, request: Request):
        """Тот же ответ, что /generate-answer, но по мере генерации: NDJSON-строки
        {"type":"delta","text":…}, {"type":"reset"}, в конце {"type":"done", …поля AnswerResponse}
        или {"type":"error","error":код}.

        Генерация идёт в отдельном потоке; если клиент ушёл (студент нажал «стоп»), поток
        закрывает соединение с моделью сразу, не дожидаясь конца ответа, — GPU освобождается."""
        request_id = str(uuid4())
        started = perf_counter()
        try:
            app.state.journal.start(request_id, payload.question, payload.language)
        except Exception:
            LOGGER.error('Request journal unavailable: %s', request_id)
            return JSONResponse({'request_id': request_id, 'status': 'error', 'error': 'logging_unavailable'},
                                status_code=503)
        extra = background(payload)
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        cancelled = threading.Event()

        def emit(event):
            loop.call_soon_threadsafe(queue.put_nowait, json.dumps(event, ensure_ascii=False) + '\n')

        def work():
            result, status = {'request_id': request_id, 'status': 'error', 'error': 'stopped'}, 499
            stream, have_slot = None, False
            try:
                # The LLM slot is taken here and always given back (finally).
                if not app.state.gate.acquire(timeout=app.state.queue_timeout):
                    result, status = {'request_id': request_id, 'status': 'error', 'error': 'service_busy'}, 503
                    emit({'type': 'error', 'error': 'service_busy'})
                    return
                have_slot = True
                stream = app.state.service.answer_stream(payload.question, payload.language, **extra)
                for kind, value in stream:
                    if cancelled.is_set():
                        break
                    if kind == 'delta':
                        emit({'type': 'delta', 'text': value})
                    elif kind == 'reset':
                        emit({'type': 'reset'})
                    else:
                        result, status = AnswerResponse(request_id=request_id, **value).model_dump(), 200
                        emit({'type': 'done', **result})
            except LLMError as exc:
                result, status = {'request_id': request_id, 'status': 'error', 'error': exc.code}, 503
                emit({'type': 'error', 'error': exc.code})
            except Exception:
                LOGGER.exception('Answer stream failed: %s', request_id)
                result, status = {'request_id': request_id, 'status': 'error', 'error': 'pipeline_unavailable'}, 503
                emit({'type': 'error', 'error': 'pipeline_unavailable'})
            finally:
                close = getattr(stream, 'close', None)
                if close is not None:
                    close()  # closes the connection to the model: it stops generating
                if have_slot:
                    app.state.gate.release()
                try:
                    app.state.journal.finish(request_id, result, status, round((perf_counter() - started) * 1000))
                except Exception:
                    LOGGER.error('Request journal update failed: %s', request_id)
                loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=work, name=f'answer-{request_id[:8]}', daemon=True).start()

        async def events():
            try:
                while True:
                    try:
                        line = await asyncio.wait_for(queue.get(), timeout=0.3)
                    except asyncio.TimeoutError:
                        line = ''
                    if await request.is_disconnected():
                        LOGGER.info('Answer stream stopped by the client: %s', request_id)
                        return
                    if line is None:
                        return
                    if line:
                        yield line
            finally:
                cancelled.set()

        return StreamingResponse(events(), media_type='application/x-ndjson')

    @app.post('/moderate', response_model=ModerationResponse,
              responses={503: {'model': ModerationError}})
    def moderate(payload: ModerationRequest):
        request_id = str(uuid4())
        if payload.mode == 'fast':
            # No LLM, so no need to wait for a slot in the LLM queue.
            result = ModerationResponse(request_id=request_id, **app.state.moderator.quick_check(payload.text))
            LOGGER.info('Moderation (fast) %s: %s', request_id, result.decision)
            return result
        if not app.state.gate.acquire(timeout=app.state.queue_timeout):
            return JSONResponse(ModerationError(request_id=request_id, error='service_busy').model_dump(), status_code=503)
        try:
            result = ModerationResponse(request_id=request_id, **app.state.moderator.moderate(payload.text))
            LOGGER.info('Moderation %s: %s', request_id, result.decision)
            return result
        except Exception:
            LOGGER.exception('Moderation failed: %s', request_id)
            return JSONResponse(ModerationError(request_id=request_id, error='moderation_unavailable').model_dump(), status_code=503)
        finally:
            app.state.gate.release()

    return app


def get_app():
    logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'), format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    return create_app()


app = get_app()
