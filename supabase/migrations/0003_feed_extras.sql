-- Доп. поля лент: описание, обложка, имя автора, бейджи.
alter table public.feeds add column if not exists description text;
alter table public.feeds add column if not exists cover_url text;
alter table public.feeds add column if not exists author_name text;
-- official: «официальный источник» — ставит только админ
alter table public.feeds add column if not exists official boolean not null default false;
-- by_admin: лента создана администратором (выставляется автоматически)
alter table public.feeds add column if not exists by_admin boolean not null default false;

-- Обновлённые правила: статус/видимость + бейджи (official только админ; by_admin авто).
create or replace function public.enforce_feed_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare admin boolean := public.is_admin();
begin
  if new.visibility = 'private' then
    new.status := 'approved';
  elsif not admin then
    if tg_op = 'INSERT' then new.status := 'pending'; else new.status := old.status; end if;
  end if;

  -- «официальный» бейдж может ставить только админ
  if not admin then
    new.official := coalesce((case when tg_op = 'UPDATE' then old.official else false end), false);
  end if;

  -- бейдж «от администратора» — авто по роли создателя
  if tg_op = 'INSERT' then
    new.by_admin := admin;
  else
    new.by_admin := old.by_admin;
  end if;

  return new;
end;
$$;

-- Публичное хранилище для обложек.
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists covers_read on storage.objects;
create policy covers_read on storage.objects for select using (bucket_id = 'covers');

drop policy if exists covers_insert on storage.objects;
create policy covers_insert on storage.objects for insert to authenticated with check (bucket_id = 'covers');

drop policy if exists covers_update on storage.objects;
create policy covers_update on storage.objects for update to authenticated using (bucket_id = 'covers');
