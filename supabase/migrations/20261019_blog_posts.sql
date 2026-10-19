-- Apply in Supabase SQL editor before enabling blog publishing.
create table if not exists public.blog_posts (
 id bigint generated always as identity primary key,
 slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
 title text not null check (length(title) between 5 and 180),
 excerpt text not null default '',
 cover_url text,
 tags text[] not null default '{}',
 blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks)='array'),
 seo_title text,
 seo_description text,
 status text not null default 'draft' check (status in ('draft','published')),
 published_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists blog_posts_published_idx on public.blog_posts(published_at desc) where status='published';
create index if not exists blog_posts_tags_idx on public.blog_posts using gin(tags);
alter table public.blog_posts enable row level security;
drop policy if exists blog_public_read on public.blog_posts;
create policy blog_public_read on public.blog_posts for select to anon,authenticated using (status='published');
drop policy if exists blog_admin_read on public.blog_posts;
create policy blog_admin_read on public.blog_posts for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
drop policy if exists blog_admin_insert on public.blog_posts;
create policy blog_admin_insert on public.blog_posts for insert to authenticated with check (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
drop policy if exists blog_admin_update on public.blog_posts;
create policy blog_admin_update on public.blog_posts for update to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
) with check (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
drop policy if exists blog_admin_delete on public.blog_posts;
create policy blog_admin_delete on public.blog_posts for delete to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
grant select on public.blog_posts to anon,authenticated;
grant insert,update,delete on public.blog_posts to authenticated;
grant usage,select on sequence public.blog_posts_id_seq to authenticated;
