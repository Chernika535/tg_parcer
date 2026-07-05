-- Аналитика для администратора: обезличенные события просмотров.
-- Пишем и читаем ТОЛЬКО через edge-функцию analytics (service role минует RLS),
-- поэтому политик нет — прямого клиентского доступа к таблице не будет.
create table if not exists public.analytics_events (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  kind    text not null,            -- 'site' | 'feed' | 'channel' | 'post'
  target  text,                     -- id ленты / ник канала / ссылка поста
  session text,                     -- анонимный идентификатор браузера (для уникальных)
  uid     uuid                      -- если пользователь авторизован (необязательно)
);
create index if not exists analytics_kind_ts_idx on public.analytics_events (kind, ts);
create index if not exists analytics_kind_target_ts_idx on public.analytics_events (kind, target, ts);
create index if not exists analytics_ts_idx on public.analytics_events (ts);

alter table public.analytics_events enable row level security;
-- Никаких политик: доступ только у service role (внутри edge-функции).
