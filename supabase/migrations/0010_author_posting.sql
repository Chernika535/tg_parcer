-- Кабинет автора: постинг в свои каналы через бота (бот — админ канала).
-- Каналы, привязанные автором. Привязка возможна, только если бот — админ канала
-- с правом публикации И сам автор — админ/создатель этого канала (проверяется в функции).
create table if not exists public.author_channels (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  chat_id    text not null,
  username   text,
  title      text,
  created_at timestamptz not null default now(),
  unique (owner_id, chat_id)
);
alter table public.author_channels enable row level security;
drop policy if exists author_channels_all on public.author_channels;
create policy author_channels_all on public.author_channels for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Запланированные и отправленные посты.
create table if not exists public.scheduled_posts (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  chat_id         text not null,
  text            text,
  parse_mode      text,                                   -- 'HTML' | null
  media           jsonb not null default '[]'::jsonb,     -- [{type:'photo'|'video'|'voice', url}]
  disable_preview boolean not null default false,
  publish_at      timestamptz not null,
  status          text not null default 'pending',        -- pending | sent | failed | canceled
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
alter table public.scheduled_posts enable row level security;
drop policy if exists scheduled_posts_all on public.scheduled_posts;
create policy scheduled_posts_all on public.scheduled_posts for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists scheduled_due_idx on public.scheduled_posts (status, publish_at);
