-- Переключатель «архивировать новые посты из Telegram» по каждому каналу.
-- Вебхук архивирует прямой пост только если для канала включён этот флаг.
alter table public.author_channels add column if not exists archive_live boolean not null default false;
