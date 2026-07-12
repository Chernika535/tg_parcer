-- Серверный кэш распарсенных постов каналов. read-channels читает t.me/s не чаще
-- раза в несколько минут, остальное отдаёт из кэша — ленты открываются почти
-- мгновенно, и кэш общий для всех пользователей (популярные каналы уже «тёплые»).
create table if not exists public.channel_posts_cache (
  username    text primary key,
  posts       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.channel_posts_cache enable row level security;
-- Публичных политик нет: читает/пишет только edge-функция под service role
-- (service role обходит RLS). Пользователи напрямую к таблице не обращаются.
