-- Pinterest Pins migration: verification. Read-only, changes nothing.
-- Every check should say true. Compare the counts with the ones from pinterest_before.sql.

select 'Pin status "ready" exists' as check_name,
       (exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'pin_status' and e.enumlabel = 'ready'))::text as ok
union all
select 'new Pin columns exist',
       ((select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'pinterest_posts'
           and column_name in ('board_name', 'keywords', 'image_text', 'image_path', 'prepared_at', 'edited_at', 'edited_by')) = 7)::text
union all
select 'one Pin per recipe (duplicate protection)',
       (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pinterest_posts_one_per_recipe'))::text
union all
select 'ready Pins must have an image',
       (exists (select 1 from pg_constraint where conname = 'pinterest_posts_image_when_prepared'))::text
union all
select 'published Pins still need a Pinterest id',
       (exists (select 1 from pg_constraint where conname = 'pinterest_posts_published_has_id'))::text
union all
select 'security (RLS) is still on for Pins',
       (select relrowsecurity from pg_class where oid = 'public.pinterest_posts'::regclass)::text
union all
select 'Pinterest publishing is still OFF',
       (select pinterest_enabled = false from public.automation_settings)::text
union all
select 'recipe automation is still OFF',
       (select enabled = false from public.automation_settings)::text
union all select 'count: recipes', (select count(*) from public.recipes)::text
union all select 'count: published recipes', (select count(*) from public.recipes where status = 'published')::text
union all select 'count: pins', (select count(*) from public.pinterest_posts)::text
union all select 'count: security rules', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('recipes', 'categories', 'keywords', 'publishing_jobs', 'pinterest_posts', 'admin_users'))::text;
