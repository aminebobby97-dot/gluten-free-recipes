-- Run LAST in the Supabase SQL Editor. Read-only: changes nothing.
-- Every row should say true in the "ok" column. (The last row turns false once
-- you save your first custom link, which is expected.)

select 'pinterest_posts.custom_destination_url exists' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'custom_destination_url') as ok
union all
select 'pinterest_posts.custom_destination_set_at exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'custom_destination_set_at')
union all
select 'pinterest_posts.custom_destination_set_by exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'custom_destination_set_by')
union all
select 'custom links must start with https://',
       exists (select 1 from pg_constraint where conname = 'pinterest_posts_custom_destination_https')
union all
select 'only an admin can change a custom link (guard trigger)',
       exists (select 1 from pg_trigger where tgname = 'pinterest_posts_guard_custom_destination' and not tgisinternal)
union all
select 'existing Pins still link to their recipe page (no custom links yet)',
       not exists (select 1 from public.pinterest_posts where custom_destination_url is not null);
