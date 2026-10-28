-- Pinterest OAuth migration: run BEFORE the migration. Read-only, changes nothing.
-- Write down the numbers. "connection_table_exists" should be false the first time.
select
  (select count(*) from public.recipes where status = 'published') as published_recipes,
  (select count(*) from public.pinterest_posts) as pins,
  (select count(*) from public.pinterest_posts where publication_status = 'ready') as ready_pins,
  (select count(*) from public.pinterest_posts where publication_status = 'published') as published_pins,
  (to_regclass('public.pinterest_connection') is not null) as connection_table_exists,
  (select enabled from public.automation_settings) as recipe_automation_on,
  (select pinterest_enabled from public.automation_settings) as pinterest_auto_publishing_on,
  (select count(*) from pg_policies where schemaname = 'public') as security_rules;
