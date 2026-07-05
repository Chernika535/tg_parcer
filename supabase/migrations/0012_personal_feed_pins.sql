-- Личные закрепления лент в разделе «Мои» — на сервере, чтобы не терялись
-- между входами/устройствами (раньше хранились только в localStorage).
create table if not exists public.feed_personal_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  feed_id bigint not null references public.feeds(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, feed_id)
);
alter table public.feed_personal_pins enable row level security;
drop policy if exists feed_personal_pins_all on public.feed_personal_pins;
create policy feed_personal_pins_all on public.feed_personal_pins for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
