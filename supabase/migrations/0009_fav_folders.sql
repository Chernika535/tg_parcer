-- Папки для избранных постов: необязательная метка на записи favorites.
alter table public.favorites add column if not exists folder text;
create index if not exists favorites_folder_idx on public.favorites (user_id, folder);
