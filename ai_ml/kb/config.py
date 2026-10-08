"""Настройки сервиса. Всё читается из ai_ml/.env (см. .env.example)."""
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def _float(name, default):
    return float(os.getenv(name, '').strip() or default)


def _int(name, default):
    return int(os.getenv(name, '').strip() or default)


@dataclass(frozen=True)
class Settings:
    # --- LLM ---
    llm_provider: str = 'ollama'          # ollama | openai | gemini
    llm_model: str = 'qwen3:4b'
    llm_base_url: str = ''                # пусто = адрес по умолчанию для провайдера
    llm_api_key: str = ''                 # нужен только для openai/gemini
    llm_timeout: float = 120.0            # секунд на один запрос к модели
    llm_num_ctx: int = 4096               # окно контекста Ollama
    llm_num_predict: int = 350            # максимум токенов в ответе
    llm_keep_alive: str = '30m'           # сколько держать модель в памяти
    # --- поиск ---
    top_k: int = 5                        # сколько кандидатов показываем модели
    candidate_floor: float = 0.82         # ниже этого кандидата в список не берём
    source_only_min: float = 0.90         # если LLM упала: отдать ответ базы напрямую от этого score
    device: str = 'cpu'
    batch_size: int = 16
    # --- сервис ---
    context_file: str = 'config/university_context.txt'
    request_log: str = 'data/logs/requests.sqlite3'
    index_dir: str = 'data/index'
    max_concurrency: int = 2
    queue_timeout: float = 120.0          # сколько запрос ждёт очереди, прежде чем 503

    @classmethod
    def from_env(cls):
        d = cls()
        return cls(
            llm_provider=os.getenv('LLM_PROVIDER', d.llm_provider).strip().lower() or d.llm_provider,
            llm_model=os.getenv('LLM_MODEL', d.llm_model).strip() or d.llm_model,
            llm_base_url=os.getenv('LLM_BASE_URL', '').strip(),
            llm_api_key=os.getenv('LLM_API_KEY', '').strip(),
            llm_timeout=_float('LLM_TIMEOUT_SECONDS', d.llm_timeout),
            llm_num_ctx=_int('LLM_NUM_CTX', d.llm_num_ctx),
            llm_num_predict=_int('LLM_NUM_PREDICT', d.llm_num_predict),
            llm_keep_alive=os.getenv('LLM_KEEP_ALIVE', d.llm_keep_alive).strip() or d.llm_keep_alive,
            top_k=_int('KB_TOP_K', d.top_k),
            candidate_floor=_float('KB_CANDIDATE_FLOOR', d.candidate_floor),
            source_only_min=_float('KB_SOURCE_ONLY_MIN', d.source_only_min),
            device=os.getenv('KB_DEVICE', d.device).strip() or d.device,
            batch_size=_int('KB_BATCH_SIZE', d.batch_size),
            context_file=os.getenv('KB_CONTEXT_FILE', d.context_file).strip() or d.context_file,
            request_log=os.getenv('KB_REQUEST_LOG', d.request_log).strip() or d.request_log,
            index_dir=os.getenv('KB_INDEX_DIR', d.index_dir).strip() or d.index_dir,
            max_concurrency=_int('KB_MAX_CONCURRENCY', d.max_concurrency),
            queue_timeout=_float('KB_QUEUE_TIMEOUT_SECONDS', d.queue_timeout),
        )

    def read_context(self):
        path = resolve_path(self.context_file)
        if not path.exists():
            return ''
        text = path.read_text(encoding='utf-8').strip()
        if len(text) > 8000:
            raise ValueError('University context is longer than 8000 characters (it is sent with every request).')
        return text
