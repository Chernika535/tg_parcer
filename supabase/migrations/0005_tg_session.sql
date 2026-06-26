-- Хранилище MTProto-сессии общего «читающего» аккаунта (один на приложение).
-- Доступ только через service_role (RLS включён, политик нет).
create table if not exists public.tg_session (
  id              text primary key default 'default',
  session         text,            -- финальная StringSession
  tmp_session     text,            -- промежуточная (между отправкой кода и входом)
  phone_code_hash text,
  updated_at      timestamptz not null default now()
);
alter table public.tg_session enable row level security;
insert into public.tg_session (id) values ('default') on conflict (id) do nothing;
