-- Архив постов канала на нашей стороне: посты, опубликованные через нас (и позже —
-- импортированные), сохраняются навсегда и показываются на странице канала даже
-- если Telegram недоступен. Медиа лежат в нашем Storage (постоянные ссылки).
create table if not exists public.archived_posts (
  id           bigint generated always as identity primary key,
  owner_id     uuid references auth.users(id) on delete set null,
  chat_id      text not null,
  username     text,                                   -- нормализованный ник канала
  msg_id       bigint,                                 -- id сообщения в Telegram (дедуп с живым чтением)
  posted_at    timestamptz not null default now(),
  text         text,
  media        jsonb not null default '[]'::jsonb,     -- медиа в форме читателя (наши Storage-ссылки)
  disable_preview boolean not null default false,
  source       text not null default 'publish',        -- publish | import
  created_at   timestamptz not null default now()
);
create index if not exists archived_posts_username_idx on public.archived_posts (lower(username), posted_at desc);
-- Один и тот же пост не дублируем (по каналу+сообщению).
create unique index if not exists archived_posts_uni on public.archived_posts (chat_id, msg_id) where msg_id is not null;

alter table public.archived_posts enable row level security;
-- Страница канала публичная — читать можно всем; писать только edge-функция под
-- service role (service role обходит RLS).
drop policy if exists archived_read on public.archived_posts;
create policy archived_read on public.archived_posts for select using (true);
