-- Избранные теги: пользователь сохраняет тег, чтобы читать общую ленту из всех
-- публичных лент с этим тегом.
create table if not exists public.tag_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);
alter table public.tag_favorites enable row level security;
drop policy if exists tag_fav_all on public.tag_favorites;
create policy tag_fav_all on public.tag_favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
