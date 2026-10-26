-- Public bucket for recipe photography and Pinterest images.
-- Files are publicly readable by URL; only admins can upload, replace or delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "recipe-images: admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-images' and (select public.is_admin()));

create policy "recipe-images: admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'recipe-images' and (select public.is_admin()))
  with check (bucket_id = 'recipe-images' and (select public.is_admin()));

create policy "recipe-images: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-images' and (select public.is_admin()));

-- Listing objects through the API is limited to admins; public URLs still work
-- because the bucket is public.
create policy "recipe-images: admin select"
  on storage.objects for select to authenticated
  using (bucket_id = 'recipe-images' and (select public.is_admin()));
