# Telegram Feed Aggregator

PWA для агрегации публичных Telegram-каналов: ленты постов читаются прямо на сайте,
с входом через Telegram, ролями и модерацией общедоступных лент.

- **Фронтенд** — Vite + React + TypeScript (статика, PWA), хостинг на Onreza.
- **Бэкенд** — Supabase: Postgres + авторизация + права доступа (RLS) + edge-функции.
- **Вход** — через Telegram (Login Widget, проверка подписи на сервере).
- **Чтение каналов** — серверный парсинг `t.me/s/<channel>` (edge-функция `read-channels`).
- Бюджет — ноль (бесплатные тарифы Onreza и Supabase).

## Возможности

- Вход через Telegram, личный кабинет, роли **пользователь / администратор**.
- **Приватные** ленты (видны только владельцу) и **общедоступные** (после модерации).
- Администратор: публикует ленты без модерации и **принимает/отклоняет** заявки.
- Гостям (без входа) доступны одобренные общедоступные ленты.
- Чтение постов прямо на сайте — без перехода в Telegram.

## Настройка и деплой

См. **[SETUP.md](./SETUP.md)** — пошагово: Supabase, схема БД, бот @BotFather,
секреты, деплой edge-функций, `config.json`, заливка на Onreza, назначение админа.

Коротко:
1. Создать проект Supabase, применить `supabase/migrations/0001_init.sql`.
2. Задеплоить `supabase/functions/telegram-auth` и `read-channels`, прописать `TELEGRAM_BOT_TOKEN`.
3. В @BotFather: создать бота, `/setdomain` на домен сайта.
4. Заполнить `public/config.json` и `dist/config.json` (URL/anon-ключ Supabase, username бота).
5. Запушить репозиторий (включая `dist/`) — Onreza отдаёт готовую статику без сборки.

> **Onreza не запускает сборку** и берёт папку `dist/` как есть. После любого изменения
> исходников пересоберите и закоммитьте `dist/`:
> ```bash
> npm run build && git add -A && git commit -m "rebuild" && git push
> ```

## Структура

```
src/
  lib/      supabase (рантайм-конфиг), auth (Telegram-вход), data (ленты/модерация/чтение)
  pages/    PublicFeeds, MyFeeds, FeedView, FeedEdit, Admin, Login, Account
  components/ PostCard, ChannelInput, TelegramLogin, States
supabase/
  migrations/0001_init.sql        схема, роли, RLS, триггеры модерации
  functions/telegram-auth         вход через Telegram (проверка подписи, выдача сессии)
  functions/read-channels         серверное чтение t.me/s
public/config.json                рантайм-конфиг (правится без пересборки)
```

## Известные ограничения

- `t.me/s/` отдаёт только последние ~20 постов и только для каналов с включённым превью.
  Приватный / без превью канал помечается как недоступный, ленту не ломает.
- Парсинг по HTML хрупкий: при смене вёрстки Telegram чинится в `read-channels`.
- Бесплатные тарифы Supabase/Onreza имеют лимиты (трафик, размер БД, время функций).
- Данные сессии — в браузере; роли и ленты — в общей БД Supabase.
