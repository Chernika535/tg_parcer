-- При удалении аккаунта его ПУБЛИЧНЫЕ ленты больше не удаляются каскадом, а
-- «осиротевают» (owner_id -> NULL). Ленты остаются в сервисе, автор отвязывается,
-- а администратор по-прежнему может их редактировать/удалять (RLS через is_admin()).
alter table public.feeds alter column owner_id drop not null;
alter table public.feeds drop constraint if exists feeds_owner_id_fkey;
alter table public.feeds add constraint feeds_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;
