# План подключения ML-чата (обзор проекта)

Цепочка: **React (`/chat`) → Go `/api/chat/*` → ML `http://127.0.0.1:8001`**. Папка `ai_ml/` не рассматривалась.

---

## 1. Backend

- **Язык / стек:** Go 1.26+, стандартная библиотека `net/http` (Go 1.22+ маршруты `METHOD /path`), без Gin/Echo. Модули: `pgx/v5`, `golang.org/x/time/rate`, свой JWT/PBKDF2 в `internal/auth`.
- **Структура:** `cmd/server/main.go` (сборка, env, роуты), `internal/handlers/` (HTTP), `internal/store/` (интерфейс + `postgres.go`), `internal/middleware/`, `internal/mlclient/`, `internal/mailer/`, `internal/markdown/`. Legacy-статика форума в `backend/web/` (отдельно от React в корне).
- **Роутинг:** один `http.ServeMux` в `main.go`; чат: `GET /api/chat/status`, `GET /api/chat/history`, `POST /api/chat/ask` — все за `middleware.Auth`.
- **Авторизация:** регистрация с доменом `@sdu.edu.kz` (`ALLOWED_EMAIL_DOMAINS`, по умолчанию `sdu.edu.kz`); JWT Bearer HS256; `middleware.Auth` кладёт `user_id` в context. Роли в БД: `user` | `moderator` | `admin` (отдельной роли `student` нет — обычный студент = `user`); админы через `ADMIN_EMAILS` при старте. Чат не проверяет `email_verified` / ban на уровне отдельного middleware — только факт JWT (как и большинство authenticated-роутов).
- **Конфиг:** `loadDotEnv(".env")` в `backend/`; ключи: `DATABASE_URL`, `JWT_SECRET_FILE`, `CORS_ALLOWED_ORIGIN`, `ML_SERVICE_URL` (default `http://127.0.0.1:8001`), `ML_REQUEST_TIMEOUT_SECONDS` (default `180`, задаёт таймаут ML-клиента и `WriteTimeout` сервера). Пример — `backend/.env.example`.
- **БД:** PostgreSQL; схема idempotent в `internal/store/migrations/001_init.sql`, применяется `pgStore.Migrate` на старте. Таблица чата — `chat_messages` (см. §3).
- **Ошибки / логи:** JSON `{"error":"..."}` через `writeJSON` / `writeError`; store-сентinelы → `writeStoreErr`. Чат: `log.Printf` на успех/ошибку ML и сбой сохранения истории (не фatal). Rate limit чата отдаёт JSON через `http.Error` с тем же форматом.

---

## 2. Frontend

- **Стек:** React 19, TypeScript, Vite 6, React Router 7, TanStack Query, Axios, Tailwind CSS v4, иконки `lucide-react`, точечно Radix (`@radix-ui/*`). Отдельного UI-кита (MUI/Chakra) нет — свои компоненты в `src/shared/ui/`.
- **Роутинг:** `src/app/router.tsx`; `/chat` внутри `ProtectedRoute` + `AppShell` (нужен логин).
- **API:** `src/shared/api/client.ts` — `axios`, `baseURL` = `VITE_API_URL` или `/api`; dev-прокси в `vite.config.ts` → `http://localhost:8080`. Токен: `localStorage` ключ `ai_helpdesk_token`, interceptor `Authorization: Bearer …`; `setAuthToken` из auth-flow.
- **Страница чата:** есть — `src/pages/ChatPage.tsx`, API — `src/features/chat/api.ts`. Главная: `AskAnythingSection` + `FaqPanel` (`src/pages/HomePage.tsx`).

---

## 3. Уже есть в коде (чат / FAQ)

| Элемент | Статус |
|--------|--------|
| `POST /api/chat/ask` | `handlers/chat.go` → `mlclient.GenerateAnswer` → ML `POST /generate-answer` |
| `GET /api/chat/history` | Пагинация `page`, `page_size` (default 100, max 200) |
| `GET /api/chat/status` | Прокси ML `GET /health` → `{ "status": "ok" \| "degraded" }` |
| Таблица `chat_messages` | `user_id`, `role` user/assistant, `text`, `forum_answer`, `ai_explanation`, `basis`, `language`, `created_at` |
| Rate limit чата | `middleware/chatlimit.go`: 1 in-flight на user + ~10 req/min |
| CORS | `middleware.CORS(CORS_ALLOWED_ORIGIN)` на весь handler |
| FAQ | Публичный `GET /api/faq`; на UI — аккордеон `FaqPanel` (не отправляет в ML) |
| Quick-reply | На **главной** три i18n-чипа в `AskAnythingSection` → navigate `/chat` с `state.initialQuery` (не кнопки FAQ из БД) |

Тесты: `backend/internal/handlers/chat_test.go`, `internal/mlclient/client_test.go`.

---

## 4. План работ по файлам (доработка / проверка интеграции)

Большая часть пунктов ТЗ **уже реализована** в незакоммиченных файлах; ниже — что создавать/менять для «подключено и работает в dev/Docker».

### 4.1 ML-клиент и конфиг

- **Уже:** `backend/internal/mlclient/client.go`, `client_test.go`; wiring в `cmd/server/main.go`; `backend/.env.example`.
- **Изменить:** `docker-compose.yml` — проброс `ML_SERVICE_URL` / `ML_REQUEST_TIMEOUT_SECONDS` для сервиса `app` (для ML на хосте: `http://host.docker.internal:8001`, как в корневом `README.md`).

### 4.2 Эндпоинт `/api/chat/ask`

- **Уже:** `handlers/chat.go`, регистрация в `main.go`.
- **Проверить:** ML на `:8001`, JWT с фронта, формат тела `{ "question": "..." }`, ответ с `request_id`, `status`, `answer`, `forum_answer`, `ai_explanation`, `basis`.

### 4.3 История чата

- **Уже:** миграция `chat_messages`, `store.CreateChatMessage` / `ListChatMessages`, `ChatHistory`, фронт `fetchChatHistory` + `historyToUiMessages`.

### 4.4 Rate limit + CORS + status

- **Уже:** `chatlimit.go`, `CORS` в `main.go`, `ChatStatus`.
- **Проверить:** 429 на фронте (`chatTooManyRequests`), баннер degraded при `503`/status.

### 4.5 Страница чата (база)

- **Уже:** `ChatPage.tsx`, маршрут `/chat`, навигация из `AppShell` и `AskAnythingSection`.

### 4.6 Отображение ответов и ошибки

- **Уже:** KB + AI blocks, fallback, retry, таймаут axios 190s, i18n в `translations.ts`.
- **Опционально:** quick-reply чипы на самой `ChatPage` (сейчас только на Home).

### 4.7 README

- **Уже:** разделы в корневом `README.md` и `backend/README.md`.
- **Синхронизировать:** docker-compose + `.env.example` в корне (если есть) с ML-переменными; шаги запуска `ai_ml` + backend + `npm run dev`.

### Frontend (если дорабатывать)

- `src/features/chat/api.ts`, `src/pages/ChatPage.tsx`, `src/i18n/translations.ts` — уже основные точки.
- `src/features/chat/components/AskAnythingSection.tsx` — quick-reply с главной.

### Backend (если дорабатывать)

- Перечисленные выше файлы чата/mlclient/store/migration — без новых сущностей, если ТЗ не расширять.

---

## 5. Расхождения с ТЗ и минимальные отклонения

| ТЗ / ожидание | Факт | Минимальное решение |
|---------------|------|---------------------|
| Роли `student` / `admin` | `user` / `moderator` / `admin` | Считать `user` = student; документировать; не переименовывать enum в БД |
| ML только `127.0.0.1:8001` | Default совпадает; Docker-backend не видит host localhost | Только env `ML_SERVICE_URL` (host.docker.internal или network alias), без смены API |
| FAQ quick-reply в чате | Чипы на Home + FAQ-аккордеон без ML | Оставить как есть или продублировать 3 suggestion-кнопки на `ChatPage` |
| `ai_ml` в compose | ML вне docker-compose | Запуск ML вручную на хосте (как в README); не трогать `ai_ml/` |
| Два фронтенда | React (корень) + legacy `backend/web` | Чат только в React; legacy не расширять |
| Авторизация чата | Только JWT, без отдельной проверки verified/ban на ask | При необходимости — один вызов существующих проверок из forum handlers в `ChatAsk` (минимальный diff) |

---

## 6. Чеклист ручной проверки

1. ML API слушает `8001`; Ollama/модель по `ai_ml/README.md` (не изучалось).
2. Backend: `ML_SERVICE_URL` указывает на ML с той же сети, что и процесс `app`.
3. Login → `/chat` → вопрос → ответ; история после перезагрузки.
4. Остановить ML → `GET /api/chat/status` → degraded, `POST /ask` → 503.
5. Два параллельных ask → 429 «wait for current answer».
