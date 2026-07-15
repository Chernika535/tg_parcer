-- Ссылка на TikTok канала: заполняет владелец, показывается всем на странице канала.
alter table public.author_channels add column if not exists tiktok_url text;
