-- Частичный уникальный индекс нельзя использовать как цель ON CONFLICT без того же
-- условия — из-за этого upsert'ы в archived_posts (публикация/импорт/вебхук) падали.
-- Заменяем на обычный уникальный индекс по (chat_id, msg_id): msg_id мы всегда
-- задаём, а NULL в уникальном индексе Postgres считает различными.
drop index if exists public.archived_posts_uni;
create unique index if not exists archived_posts_uni on public.archived_posts (chat_id, msg_id);
