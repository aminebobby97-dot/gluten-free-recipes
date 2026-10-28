-- Pinterest Pins migration: run BEFORE the migration. Read-only, changes nothing.
-- Write down the numbers. "duplicate_pins" must be 0 (if not, tell Claude before continuing).
select
  (select count(*) from public.recipes) as recipes,
  (select count(*) from public.recipes where status = 'published') as published_recipes,
  (select count(*) from public.pinterest_posts) as pins,
  (select count(*) from (select recipe_id, variant from public.pinterest_posts group by 1, 2 having count(*) > 1) d) as duplicate_pins,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('recipes', 'categories', 'keywords', 'publishing_jobs', 'pinterest_posts', 'admin_users')) as security_rules;
