-- Заблокированные админом каналы: исчезают из ВСЕХ подборок (публичных и личных
-- всех пользователей). Список ведёт админ, он же виден в разделе «Каналы».
create table if not exists public.blocked_channels (
  username    text primary key,          -- нормализованный ник (нижний регистр, без @)
  reason      text,
  created_at  timestamptz not null default now(),
  blocked_by  uuid references public.profiles(id) on delete set null
);
alter table public.blocked_channels enable row level security;
-- Список нужен для фильтрации у всех — читать можно всем; писать только через
-- edge-функцию под service role (с проверкой роли админа внутри).
drop policy if exists blocked_read on public.blocked_channels;
create policy blocked_read on public.blocked_channels for select using (true);
