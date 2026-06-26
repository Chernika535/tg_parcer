-- Telegram Feed Aggregator — Supabase schema, roles, RLS, moderation.
-- Применяется через Supabase CLI (supabase db push) или в SQL Editor.

-- ---------- Профили пользователей ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  telegram_id  bigint unique,
  username     text,
  display_name text,
  photo_url    text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now()
);

-- ---------- Ленты ----------
create table if not exists public.feeds (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  channels    text[] not null default '{}',
  visibility  text not null default 'private' check (visibility in ('private', 'public')),
  -- для приватных всегда 'approved'; для публичных: pending → approved/rejected
  status      text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_feeds_owner on public.feeds(owner_id);
create index if not exists idx_feeds_public on public.feeds(visibility, status);

-- ---------- Хелпер: текущий пользователь — админ? ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Триггер: правила статуса/видимости лент ----------
create or replace function public.enforce_feed_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility = 'private' then
    -- приватная лента всегда «одобрена» (видна только владельцу)
    new.status := 'approved';
  elsif not public.is_admin() then
    -- публичная лента от обычного пользователя: модерация обязательна
    if tg_op = 'INSERT' then
      new.status := 'pending';
    else
      -- обычный пользователь не может сам менять статус своей публичной ленты
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_feed_rules on public.feeds;
create trigger trg_enforce_feed_rules
  before insert or update on public.feeds
  for each row execute function public.enforce_feed_rules();

-- ---------- Триггер: запрет самоповышения роли ----------
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_escalation on public.profiles;
create trigger trg_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.feeds enable row level security;

-- profiles: читать можно всем (имена авторов публичных лент), менять — только себя
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

-- feeds: видно свои + одобренные публичные + всё для админа
drop policy if exists feeds_select on public.feeds;
create policy feeds_select on public.feeds for select using (
  (visibility = 'public' and status = 'approved')
  or owner_id = auth.uid()
  or public.is_admin()
);

drop policy if exists feeds_insert on public.feeds;
create policy feeds_insert on public.feeds for insert
  with check (owner_id = auth.uid());

drop policy if exists feeds_update on public.feeds;
create policy feeds_update on public.feeds for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists feeds_delete on public.feeds;
create policy feeds_delete on public.feeds for delete
  using (owner_id = auth.uid() or public.is_admin());
