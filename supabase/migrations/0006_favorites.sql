-- Избранные посты пользователя (локальное «сохранить к себе»; в Telegram не уходит).
create table if not exists public.favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  link       text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, link)
);
alter table public.favorites enable row level security;

drop policy if exists favorites_all on public.favorites;
create policy favorites_all on public.favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
