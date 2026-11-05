-- Run FIRST in the Supabase SQL Editor. Read-only: changes nothing.
-- Shows what the keyword replenishment migration will change.

select
  -- Must be true: the Phase 2 automation migration is applied.
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'generation_attempts') as automation_migration_applied,
  -- Expected false before the migration, true after.
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'keyword_replenishments') as has_keyword_replenishments,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_attempts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''keywords''%'
  ) as attempts_allow_keywords,
  -- For reference: these are NOT changed by the migration.
  (select count(*) from public.keywords) as keywords,
  (select count(*) from public.generation_attempts) as ai_attempts,
  (select daily_budget_usd from public.automation_settings where id) as daily_budget_usd;
