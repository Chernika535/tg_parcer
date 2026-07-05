-- Локальные лайки постов (публичный счётчик, но число видит только автор канала).
create table if not exists public.post_likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  link       text not null,
  channel    text not null,          -- нормализованный ник канала (для агрегации автору)
  created_at timestamptz not null default now(),
  primary key (user_id, link)
);
alter table public.post_likes enable row level security;
drop policy if exists post_likes_all on public.post_likes;
create policy post_likes_all on public.post_likes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists post_likes_channel_idx on public.post_likes (channel);
