-- Лента по умолчанию в избранном у ВСЕХ пользователей (feed_id = 21).
-- Это обычная звёздочка: пользователь может физически убрать её из избранного,
-- и она не вернётся. Существующим — разовый бэкфилл, новым — триггер при
-- создании профиля.

-- 1) Бэкфилл: добавить ленту 21 в избранное всем, у кого её ещё нет.
insert into public.feed_favorites (user_id, feed_id)
select p.id, 21
from public.profiles p
where exists (select 1 from public.feeds f where f.id = 21)
  and not exists (
    select 1 from public.feed_favorites ff
    where ff.user_id = p.id and ff.feed_id = 21
  )
on conflict do nothing;

-- 2) Триггер: новым пользователям сразу класть ленту 21 в избранное.
create or replace function public.seed_default_favorites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feed_favorites (user_id, feed_id)
  values (new.id, 21)
  on conflict do nothing;
  return new;
exception when foreign_key_violation then
  -- Лента 21 могла быть удалена — не мешаем регистрации.
  return new;
end;
$$;

drop trigger if exists seed_favorites on public.profiles;
create trigger seed_favorites
after insert on public.profiles
for each row execute function public.seed_default_favorites();
