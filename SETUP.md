# Настройка (Supabase + Telegram + Onreza)

Приложение — статический фронтенд на Onreza + бэкенд на Supabase (бесплатно).
Пройдите шаги по порядку. Всё бесплатно, карта не нужна.

---

## 1. Создать проект Supabase

1. Зайдите на https://supabase.com → New project. Запомните пароль БД.
2. Дождитесь готовности проекта.
3. **Project Settings → API** — скопируйте:
   - **Project URL** (вида `https://xxxx.supabase.co`)
   - **anon public** ключ (он публичный — попадёт в браузер, это нормально).

## 2. Применить схему БД

**SQL Editor → New query** → вставьте содержимое `supabase/migrations/0001_init.sql` → Run.
Создаст таблицы `profiles`, `feeds`, роли, права (RLS) и модерацию.

## 3. Создать бота и получить токен

1. В Telegram откройте **@BotFather** → `/newbot` → задайте имя и username.
2. Скопируйте **токен** (вида `123456:ABC...`).
3. Привяжите домен сайта к боту (нужно для входа):
   `/setdomain` → выберите бота → введите домен вашего сайта на Onreza,
   например `tg-parcer-xxxx.onreza.app` (без `https://`).

## 4. Прописать секреты для серверных функций

**Project Settings → Edge Functions → Secrets** (или Manage secrets) — добавьте:

| Имя | Значение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота из шага 3 |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет в функции сам.
Если их нет — добавьте вручную (Service role key в **Settings → API**, держите его в секрете,
на фронт не попадает).

## 5. Задеплоить Edge Functions

Установите Supabase CLI (https://supabase.com/docs/guides/cli), затем в корне репозитория:

```bash
supabase login
supabase link --project-ref <ref-из-URL-проекта>
supabase functions deploy telegram-auth
supabase functions deploy read-channels
```

> Если функция требует «проверки JWT», для `read-channels` можно отключить (чтение
> публичных каналов доступно и гостям): `supabase functions deploy read-channels --no-verify-jwt`.
> `telegram-auth` тоже вызывается до входа — деплойте с `--no-verify-jwt`.

## 6. Настроить фронтенд (без пересборки)

Откройте `dist/config.json` (он отдаётся как есть) и впишите свои значения:

```json
{
  "supabaseUrl": "https://xxxx.supabase.co",
  "supabaseAnonKey": "ВАШ-ANON-КЛЮЧ",
  "botUsername": "ИмяВашегоБотаБезСобачки"
}
```

Тот же файл есть в `public/config.json` — поправьте оба и закоммитьте,
чтобы значения не потерялись при следующей сборке.

## 7. Залить на Onreza

Закоммитьте и запушьте репозиторий (включая `dist/`). Onreza отдаст статику.
Никаких build-команд настраивать не нужно.

## 8. Сделать себя администратором

1. Войдите в приложении через Telegram (кнопка «Вход»).
2. В Supabase **SQL Editor**:
   ```sql
   update public.profiles set role = 'admin'
   where telegram_id = ВАШ_TELEGRAM_ID;
   ```
   (ваш `telegram_id` можно увидеть в таблице `profiles` после первого входа,
   либо узнать у @userinfobot.)
3. Перезайдите — появится вкладка «Модерация».

## 9. Пара общедоступных лент «из коробки»

Войдя администратором, создайте 1–2 ленты с доступом **Общедоступная** — у админа
они публикуются сразу и видны всем, в том числе без входа.

---

## Как это работает

- **Вход** — Telegram Login Widget. Подпись данных проверяется секретом бота
  в функции `telegram-auth` (сервер), затем выдаётся сессия Supabase.
- **Роли** — `profiles.role` (`user` / `admin`). Права разделяются через RLS.
- **Ленты** — приватные (видны только владельцу) и общедоступные (после модерации).
  Админ публикует без модерации.
- **Модерация** — админ во вкладке «Модерация» одобряет/отклоняет публичные заявки.
- **Чтение каналов** — функция `read-channels` парсит `t.me/s/<channel>` на сервере
  (без CORS-проблем браузера).
- **Гость** (без входа) видит только одобренные общедоступные ленты.
