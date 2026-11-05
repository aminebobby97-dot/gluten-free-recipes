-- Run LAST in the Supabase SQL Editor. Read-only: changes nothing.
-- Every row should say true in the "ok" column.

select 'keyword_replenishments table exists' as check_name,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'keyword_replenishments') as ok
union all
select 'row level security is on for keyword_replenishments',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.keyword_replenishments')), false)
union all
select 'admins can read top-ups (policy)',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'keyword_replenishments' and policyname = 'keyword_replenishments: admin read')
union all
select 'visitors cannot read top-ups',
       not has_table_privilege('anon', 'public.keyword_replenishments', 'select')
union all
select 'at most 2 top-ups per day (trigger)',
       exists (select 1 from pg_trigger where tgname = 'keyword_replenishments_daily_limit' and not tgisinternal)
union all
select 'the worker can record top-ups',
       has_table_privilege('service_role', 'public.keyword_replenishments', 'insert') and has_table_privilege('service_role', 'public.keyword_replenishments', 'update')
union all
select 'the worker cannot delete top-up history',
       not has_table_privilege('service_role', 'public.keyword_replenishments', 'delete')
union all
select 'AI log accepts keyword-idea calls (kind keywords)',
       exists (select 1 from pg_constraint where conname = 'generation_attempts_kind_check' and pg_get_constraintdef(oid) like '%''keywords''%')
union all
select 'AI log still accepts recipe and photo calls',
       exists (select 1 from pg_constraint where conname = 'generation_attempts_kind_check' and pg_get_constraintdef(oid) like '%''recipe''%' and pg_get_constraintdef(oid) like '%''image_check''%');
