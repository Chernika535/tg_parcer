-- Соцссылки канала: YouTube и подкаст (mave.digital и т.п.) с маленькой обложкой
-- и названием. Заполняет владелец, показываются всем на странице канала.
alter table public.author_channels add column if not exists youtube_url text;
alter table public.author_channels add column if not exists podcast_url text;
alter table public.author_channels add column if not exists podcast_title text;
alter table public.author_channels add column if not exists podcast_cover text;
