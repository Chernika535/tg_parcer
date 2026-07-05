-- Опубликованные через сервис сообщения — чтобы автор мог их отредактировать
-- или удалить прямо из кабинета (через Bot API editMessage*/deleteMessage).
create table if not exists public.posted_messages (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  chat_id         text not null,
  message_ids     bigint[] not null,          -- все сообщения поста (альбом = несколько)
  text_message_id bigint,                       -- где лежит текст/подпись (для правки)
  is_caption      boolean not null default false, -- текст является подписью к медиа
  text            text,
  parse_mode      text,
  sent_at         timestamptz not null default now()
);
alter table public.posted_messages enable row level security;
drop policy if exists posted_messages_all on public.posted_messages;
create policy posted_messages_all on public.posted_messages for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists posted_messages_owner_idx on public.posted_messages (owner_id, sent_at desc);
