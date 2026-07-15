-- Ещё площадки линк-хаба: Дзен, Rutube, Teletype.
alter table public.author_channels add column if not exists zen_url text;
alter table public.author_channels add column if not exists rutube_url text;
alter table public.author_channels add column if not exists teletype_url text;
-- Отдельный музыкальный блок: любимый трек/плейлист + короткая подпись.
alter table public.author_channels add column if not exists music_caption text;
alter table public.author_channels add column if not exists spotify_url text;
alter table public.author_channels add column if not exists yandexmusic_url text;
alter table public.author_channels add column if not exists zvuk_url text;
