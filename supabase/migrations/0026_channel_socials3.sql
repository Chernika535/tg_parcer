-- Ещё площадки для линк-хаба канала: Boosty, VK и личный сайт.
alter table public.author_channels add column if not exists boosty_url text;
alter table public.author_channels add column if not exists vk_url text;
alter table public.author_channels add column if not exists website_url text;
