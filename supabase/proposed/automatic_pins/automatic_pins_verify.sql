-- Run LAST in the Supabase SQL Editor. Read-only: changes nothing.
-- Every row should say true in the "ok" column.

select 'worker can read the Pinterest connection' as check_name,
       has_table_privilege('service_role', 'public.pinterest_connection', 'SELECT') as ok
union all
select 'worker can update the Pinterest connection',
       has_table_privilege('service_role', 'public.pinterest_connection', 'UPDATE')
union all
select 'worker still cannot insert a connection',
       not has_table_privilege('service_role', 'public.pinterest_connection', 'INSERT')
union all
select 'worker still cannot delete the connection',
       not has_table_privilege('service_role', 'public.pinterest_connection', 'DELETE')
union all
select 'visitors still have no access to the connection',
       not has_table_privilege('anon', 'public.pinterest_connection', 'SELECT')
union all
select 'pinterest_posts.publish_started_at exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'publish_started_at')
union all
select 'pinterest_posts.published_via exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'published_via')
union all
select 'automatic Pinterest publishing is still off (pinterest_enabled = false)',
       not coalesce((select pinterest_enabled from public.automation_settings where id), false);
