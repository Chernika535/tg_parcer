-- Бейджи official/by_admin теперь задаёт админ галочками в редакторе.
-- У не-админа оба всегда выключены (защита на сервере).
create or replace function public.enforce_feed_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare admin boolean := public.is_admin();
begin
  if new.visibility = 'private' then
    new.status := 'approved';
  elsif not admin then
    if tg_op = 'INSERT' then new.status := 'pending'; else new.status := old.status; end if;
  end if;

  if not admin then
    new.official := false;
    new.by_admin := false;
  end if;

  return new;
end;
$$;
