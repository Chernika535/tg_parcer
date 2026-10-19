-- Run after 20261019_blog_posts.sql in the same Supabase project.
-- Public READ for published article media; only project admins may upload/update/delete.
insert into storage.buckets (id,name,public,file_size_limit)
values ('blog-media','blog-media',true,52428800)
on conflict (id) do update set public=true,file_size_limit=52428800;
drop policy if exists blog_media_admin_insert on storage.objects;
create policy blog_media_admin_insert on storage.objects for insert to authenticated
with check (bucket_id='blog-media' and exists (
 select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
));
drop policy if exists blog_media_admin_update on storage.objects;
create policy blog_media_admin_update on storage.objects for update to authenticated
using (bucket_id='blog-media' and exists (
 select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
)) with check (bucket_id='blog-media' and exists (
 select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
));
drop policy if exists blog_media_admin_delete on storage.objects;
create policy blog_media_admin_delete on storage.objects for delete to authenticated
using (bucket_id='blog-media' and exists (
 select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
));
