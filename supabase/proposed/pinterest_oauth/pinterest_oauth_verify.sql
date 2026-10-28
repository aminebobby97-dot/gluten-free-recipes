-- Pinterest OAuth migration: verification. Read-only (SELECT only), changes nothing.
-- Every check should say true. Compare the counts with the ones from pinterest_oauth_before.sql.

select 'connection table exists' as check_name,
       (to_regclass('public.pinterest_connection') is not null)::text as ok
union all
select 'security (RLS) is on for the connection',
       (select relrowsecurity from pg_class where oid = 'public.pinterest_connection'::regclass)::text
union all
select 'only admins can use the connection (one admin rule)',
       ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'pinterest_connection') = 1)::text
union all
select 'visitors (anon) cannot read the connection',
       (not has_table_privilege('anon', 'public.pinterest_connection', 'select'))::text
union all
select 'automation worker (service_role) cannot read the connection',
       (not has_table_privilege('service_role', 'public.pinterest_connection', 'select'))::text
union all
select 'tokens must be stored encrypted',
       ((select count(*) from pg_constraint where conrelid = 'public.pinterest_connection'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%v1.%') = 2)::text
union all
select 'Pins have a published_by column',
       (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'published_by'))::text
union all
select 'no Pinterest account connected yet (normal right after the migration)',
       ((select count(*) from public.pinterest_connection) = 0)::text
union all
select 'Pinterest auto publishing is still OFF',
       (select pinterest_enabled = false from public.automation_settings)::text
union all
select 'recipe automation is still OFF',
       (select enabled = false from public.automation_settings)::text
union all select 'count: published recipes', (select count(*) from public.recipes where status = 'published')::text
union all select 'count: pins', (select count(*) from public.pinterest_posts)::text
union all select 'count: ready pins', (select count(*) from public.pinterest_posts where publication_status = 'ready')::text
union all select 'count: published pins', (select count(*) from public.pinterest_posts where publication_status = 'published')::text;
