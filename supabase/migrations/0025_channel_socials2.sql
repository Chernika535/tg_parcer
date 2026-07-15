-- Ещё соцссылки канала: Bandlink (музыканты) и ЛитРес (писатели).
alter table public.author_channels add column if not exists bandlink_url text;
alter table public.author_channels add column if not exists litres_url text;
