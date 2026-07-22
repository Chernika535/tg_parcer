-- Бакет для «памяти» прокси картинок (функция img кэширует сюда изображения).
-- Приватный: отдаём через функцию под service role, наружу напрямую не светим.
insert into storage.buckets (id, name, public)
values ('imgcache', 'imgcache', false)
on conflict (id) do nothing;
