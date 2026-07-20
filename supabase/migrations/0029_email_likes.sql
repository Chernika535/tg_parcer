-- E-mail для связи в линк-хабе.
alter table public.author_channels add column if not exists email_contact text;

-- Храним данные поста при лайке — чтобы показывать раздел «Понравилось».
alter table public.post_likes add column if not exists data jsonb;

-- Лайки каналов (♥ на канале).
create table if not exists public.channel_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  channel    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, channel)
);
alter table public.channel_likes enable row level security;
drop policy if exists channel_likes_all on public.channel_likes;
create policy channel_likes_all on public.channel_likes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
