# SDU AI Helpdesk — ML-сервис (поиск по базе знаний + Ollama qwen3:4b)

Внутренний HTTP-сервис для Go-backend. Студент задаёт вопрос → сервис находит в базе знаний
похожие вопросы → **LLM сама решает**, подходит ли найденный ответ, и пишет итоговый ответ.
Если в базе ничего подходящего нет — LLM отвечает сама. Модель **не привязана к датасету**.

## Как это работает

```
вопрос ─► язык (auto) ─► E5-эмбеддинг ─► top-5 похожих вопросов базы (cosine ≥ 0.82, без жёсткого порога)
                                              │
                                              ▼
                       ОДИН вызов qwen3:4b (think=off, JSON-схема):
                       {"match": N, "answer": "..."}
                          │                         │
                  match = N > 0                 match = 0
        forum_answer = ответ базы (дословно)   forum_answer = null
        ai_explanation = пересказ + пояснение  ai_explanation = ответ модели из общих знаний
        basis = "retrieved"                    basis = "general"
```

* Релевантность решает модель (она видит 5 кандидатов), а не порог сходства. Кандидаты часто нерелевантны — `match=0` нормальный исход.
* Выдумывать факты об SDU (телефоны, даты, цены, комнаты, фамилии) модели запрещено промптом: если факта нет — честно говорит и советует Student Service Center / деканат.
* Язык ответа = язык вопроса (`language: "auto"`; ru / kk / en можно задать явно). `forum_answer` остаётся на языке базы.
* Если Ollama недоступна/таймаут: при сходстве ≥ 0.90 отдаётся ответ базы (`reason: source_only_*`), иначе честное «сервис временно недоступен».
* Если упал сам поиск — сервис отвечает без базы (`reason: retrieval_unavailable`), а не падает.

## Запуск

1. Ollama: `ollama serve` и `ollama pull qwen3:4b` (нужна Ollama ≥ 0.9 — для параметра `think`).
2. Python 3.11/3.12. Из папки `ai_ml`:
   * Windows: `run.bat`   * Linux/macOS: `./run.sh`

   Скрипт создаёт `.venv`, ставит зависимости, запускает диагностику (`kb.cli doctor`) и сервис на `http://127.0.0.1:8001`.
   При **первом** старте скачивается модель эмбеддингов `intfloat/multilingual-e5-base` (~1.1 ГБ, нужен интернет).
3. Проверка: `http://127.0.0.1:8001/health` и `http://127.0.0.1:8001/docs`.

Вручную: `python -m venv .venv`, `pip install -r requirements.txt`, `python -m kb.cli doctor`,
`python -m uvicorn kb.api:app --host 127.0.0.1 --port 8001 --workers 1`.

Postgres/pgvector больше **не нужны**: 941 вектор лежит в `data/index/` и ищется в памяти за доли миллисекунды.

## API

`POST /generate-answer`
```json
{"question": "Как получить справку об обучении?", "language": "auto"}
```
`language` необязателен (`auto` | `ru` | `kk` | `en`). Ответ (контракт прежний):
`request_id, status (answered|fallback), answer, forum_answer, ai_explanation, language, basis (retrieved|general|none), reason, source, source_type, retrieval_score`.

* `answer` — итоговый текст для показа; в UI: «Ответ из базы знаний» = `forum_answer`, «Объяснение AI» = `ai_explanation`.
* `status=fallback` приходит с HTTP 200; ошибки инфраструктуры — 502/503 с полем `error`.
* `source_type` сейчас всегда `faq` (это FAQ-таблица, не форум; выбор самого залайканного ответа форума — отдельный этап).

`POST /moderate` → `{"text": "..."}`: сначала детерминированный фильтр мата ru/kk/en
(`config/profanity_patterns.txt`, дополняйте без перекомпиляции), затем LLM-проверка на оскорбления/ненависть/угрозы/домогательства.
Новая категория `profanity`. Если LLM недоступна — решение `review` (автопубликации нет).

`GET /health` — индекс загружен, Ollama доступна, модель установлена (`status: ok|degraded`).

## Команды

```
python -m kb.cli doctor                              # проверка окружения
python -m kb.cli ask --question "Что такое GPA?"     # весь пайплайн из консоли
python -m kb.cli search --question "..." --top-k 5   # какие кандидаты и с каким score видит модель
python -m kb.cli index                               # пересобрать индекс после правки data/raw/faq.csv
python -m kb.cli prepare                             # только очистка CSV
python -m unittest discover -s tests                 # тесты (56, без Ollama и без скачивания моделей)
```

## Настройка (`.env`)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `LLM_MODEL` | `qwen3:4b` | модель Ollama |
| `LLM_BASE_URL` | пусто → `127.0.0.1:11434` | если Ollama на другой машине |
| `LLM_TIMEOUT_SECONDS` | 120 | таймаут одного запроса |
| `LLM_NUM_PREDICT` | 350 | максимум токенов ответа (главный рычаг скорости на CPU) |
| `KB_TOP_K` / `KB_CANDIDATE_FLOOR` | 5 / 0.82 | сколько кандидатов и от какого сходства показывать модели |
| `KB_SOURCE_ONLY_MIN` | 0.90 | порог «отдать ответ базы», если LLM недоступна |
| `KB_MAX_CONCURRENCY` | 2 | параллельные запросы (остальные ждут в очереди) |

Скорость зависит от железа: на CPU 4B-модель отвечает заметно дольше, чем на GPU. Если долго — уменьшите
`LLM_NUM_PREDICT`, держите Ollama запущенной (модель прогревается при старте и держится 30 мин).

## Что стоит сделать дальше

* Наполнить `config/university_context.txt` проверенными фактами SDU (контакты, адреса, правила) — модель будет брать их как достоверные.
* Подобрать `KB_CANDIDATE_FLOOR` на 30–50 реальных вопросах (`kb.cli search` показывает score) и оценить качество на вопросах вне базы.
* Почистить данные: 668 из 941 записей имеют статус `needs_review`, 56 ответов короче 15 символов («Да», «Жоқ»), есть устаревающие факты (имя ректора и т.п.). Подробности — `docs/ANALYSIS.md`.
* Подключить форум: сейчас источник — FAQ-таблица.
