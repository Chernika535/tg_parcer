-- Blog taxonomy: one primary section per article, tags remain independent.
create table if not exists public.blog_sections (
 id bigint generated always as identity primary key,
 slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
 title text not null,
 description text not null default '',
 seo_title text,
 seo_description text,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.blog_sections enable row level security;
create policy blog_sections_read on public.blog_sections for select to anon, authenticated using (true);
create policy blog_sections_admin_insert on public.blog_sections for insert to authenticated with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
create policy blog_sections_admin_update on public.blog_sections for update to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
create policy blog_sections_admin_delete on public.blog_sections for delete to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
grant select on public.blog_sections to anon,authenticated;
grant insert,update,delete on public.blog_sections to authenticated;
grant usage,select on sequence public.blog_sections_id_seq to authenticated;
alter table public.blog_posts add column if not exists section_id bigint references public.blog_sections(id) on delete set null;
alter table public.blog_posts add column if not exists content_html text;
create index if not exists blog_posts_section_idx on public.blog_posts(section_id, published_at desc);
insert into public.blog_sections(slug,title,description,sort_order) values ('obshchee','Общее','Статьи и заметки Полистай',0) on conflict (slug) do nothing;
update public.blog_posts set section_id=(select id from public.blog_sections where slug='obshchee') where section_id is null;
