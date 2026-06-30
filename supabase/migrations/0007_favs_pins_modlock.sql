-- Избранные ленты, закрепления (pins) и блокировка правок присланных лент.

-- 1) Избранные ЛЕНТЫ (лайк ленты)
create table if not exists public.feed_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  feed_id bigint not null references public.feeds(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, feed_id)
);
alter table public.feed_favorites enable row level security;
drop policy if exists feed_fav_all on public.feed_favorites;
create policy feed_fav_all on public.feed_favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Закрепления лент (админ). tag = '' → в общей ленте; tag = '<тег>' → в категории.
create table if not exists public.feed_pins (
  id bigserial primary key,
  feed_id bigint not null references public.feeds(id) on delete cascade,
  tag text not null default '',
  rank int not null default 0,
  created_at timestamptz not null default now(),
  unique (feed_id, tag)
);
alter table public.feed_pins enable row level security;
drop policy if exists feed_pins_select on public.feed_pins;
create policy feed_pins_select on public.feed_pins for select using (true);
drop policy if exists feed_pins_write on public.feed_pins;
create policy feed_pins_write on public.feed_pins for all
  using (public.is_admin()) with check (public.is_admin());

-- 3) Правки присланных лент: владелец редактирует только приватные и отклонённые;
--    публичные на модерации/одобренные правит только админ. При правке отклонённой
--    владельцем — лента снова уходит на модерацию (status → pending).
create or replace function public.enforce_feed_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare admin boolean := public.is_admin();
begin
  if new.visibility = 'private' then
    new.status := 'approved';
  elsif not admin then
    if tg_op = 'INSERT' then
      new.status := 'pending';
    elsif old.status = 'rejected' then
      new.status := 'pending';
    else
      new.status := old.status;
    end if;
  end if;

  if not admin then
    new.official := false;
    new.by_admin := false;
  end if;

  return new;
end;
$$;

-- Запрет правок владельцем после отправки на модерацию (кроме приватных/отклонённых).
drop policy if exists feeds_update on public.feeds;
create policy feeds_update on public.feeds for update
  using (
    public.is_admin()
    or (owner_id = auth.uid() and (visibility = 'private' or status = 'rejected'))
  )
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and (visibility = 'private' or status = 'rejected'))
  );
