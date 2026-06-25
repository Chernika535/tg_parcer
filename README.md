# Telegram Feed Aggregator

PWA для агрегации публичных Telegram-каналов и рассылки сводок по ключевым словам.

- **Чтение каналов** — только парсинг публичной веб-версии `https://t.me/s/<channel>` (без MTProto, без аккаунтов, без номеров).
- **Доставка сводок** — Telegram Bot API (бот только отправляет, ничего не читает).
- **Планировщик** — внешний крон (cron-job.org) дёргает защищённый `/api/cron`.
- **Хостинг** — Onreza (бесплатный тариф). Бюджет — ноль.

Однопользовательское приложение, но схема и код multi-user-ready (везде `user_id`, по умолчанию `local`).

## Стек

Vite + React + TypeScript (SPA, PWA) · serverless-функции Onreza (Web `Request`/`Response`) ·
PostgreSQL (postgres.js) · Onreza KV · `node-html-parser` · `vite-plugin-pwa`.

## Структура

```
db/        schema.sql + migrate.ts (идемпотентные миграции)
api/       serverless-функции
  _lib/    db, kv, scraper, telegram, feed, digest, auth, util
src/       фронтенд (pages, components, styles)
public/    PWA-иконки
scripts/   gen-icons, test-scraper, test-parse
```

## Локальная разработка

```bash
npm install
cp .env.example .env      # заполнить DATABASE_URL, TELEGRAM_BOT_TOKEN, CRON_SECRET
npm run migrate           # применить схему
npm run dev               # фронтенд (Vite)
```

Проверки скрапера:

```bash
npm run test:parse        # оффлайн: парсинг HTML-фикстуры
npm run test:scraper telegram   # онлайн: реальный канал (нужен доступ к t.me)
```

> Примечание: в некоторых окружениях исходящий доступ к `t.me` закрыт политикой —
> тогда живой `test:scraper` не пройдёт, но `test:parse` подтверждает логику разбора.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | строка подключения managed Postgres (выдаёт Onreza) |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather (на фронт не отдаётся) |
| `CRON_SECRET` | длинная случайная строка, защищает `/api/cron` |
| `APP_USER_ID` | `local` — единственный пользователь |
| `APP_BASE_URL` | публичный URL приложения на Onreza |

KV доступен через `@onreza/runtime/kv` без отдельной переменной.

## Деплой на Onreza (GitVerse → Onreza)

1. Запушить репозиторий на GitVerse.
2. В Onreza подключить репозиторий GitVerse.
3. Завести managed PostgreSQL, прокинуть `DATABASE_URL` в переменные проекта.
4. Внести секреты: `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `APP_USER_ID=local`, `APP_BASE_URL`.
5. Build command `npm run build`, output dir `dist` (см. `onreza.json`).
6. Применить миграции: `npm run migrate` (build hook `postDeploy` в `onreza.json` либо вручную один раз).
7. Настроить крон (ниже).

> Все значения в `onreza.json`, помеченные `ONREZA:` / `$comment`, — допущения по
> разделу 0.1 спецификации. Документация (`docs.onreza.ru`) была недоступна на момент
> сборки; сверьте формат конфига, сигнатуру функций, импорт KV и переменную строки
> подключения Postgres с актуальными docs и поправьте при расхождении.

## Крон (cron-job.org)

Если Onreza не даёт нативный планировщик, создайте бесплатное задание:

- **URL:** `{APP_BASE_URL}/api/cron`
- **Метод:** `POST`
- **Заголовок:** `X-Cron-Secret: <значение CRON_SECRET>`
- **Расписание:** `*/15 * * * *` (каждые 15 минут)

Окно срабатывания сводки = шаг крона (15 мин): сводка уходит, если текущее локальное
время попадает в `[send_time, send_time + 15min)`. Защита от дублей — `last_sent_at`
не сегодня (по таймзоне пользователя).

Если Onreza поддерживает нативный cron — включите блок `cron` в `onreza.json`
(эндпоинт тот же, секрет проверяется).

## Подключение Telegram

1. Открыть бота, отправить `/start`.
2. В «Настройки» нажать «Определить chat_id» (вызывает `getUpdates`).
3. Фоллбэк: ввести `chat_id` вручную (взять у @userinfobot).

## API

```
GET/POST/PATCH/DELETE /api/feeds          CRUD лент
GET    /api/feed?id=ID&limit=50           лента с постами (posted_at desc)
GET/POST/PATCH/DELETE /api/digests        CRUD парсингов
POST   /api/digests/run  { id }           ручной прогон сводки
GET/PATCH /api/settings                   chat_id, timezone
POST   /api/telegram-connect              определить chat_id
POST   /api/cron  (X-Cron-Secret)         планировщик
```

## Известные ограничения

- `t.me/s/` отдаёт только последние ~20 постов и только для каналов с включённым превью.
  Истории вглубь нет; канал без превью / приватный не читается — это вне рамок проекта
  (в ленте помечается как недоступный, ленту не ломает).
- Парсинг по HTML хрупкий: при смене вёрстки Telegram чинится по логам скрапера
  (`// SCRAPER: markup changed?`).
- Бесплатный тариф Onreza встаёт при достижении лимита (трафик/сборка/CU) до следующего
  месяца. Отсюда агрессивный кэш (KV TTL 10 мин + таблица `posts`) и чистка постов старше 14 дней.
- Фильтр сводок — по подстрокам ключевых слов. Без смысловой фильтрации и
  LLM-суммаризации (платно, вне бюджета).
- Поиск только по добавленным каналам, не по всему Telegram.
