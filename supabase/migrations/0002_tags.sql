-- Теги лент для поиска и сортировки по темам.
alter table public.feeds add column if not exists tags text[] not null default '{}';
create index if not exists idx_feeds_tags on public.feeds using gin (tags);
