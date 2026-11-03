-- Run FIRST in the Supabase SQL Editor. Read-only: changes nothing.
-- Shows what the custom destination URL migration will change.

select
  -- Must be true: the earlier Pinterest migrations are applied.
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'publish_started_at') as automatic_pins_migration_applied,
  -- Expected false before the migration, true after.
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'custom_destination_url') as has_custom_destination_url,
  exists (select 1 from pg_trigger where tgname = 'pinterest_posts_guard_custom_destination') as has_guard_trigger,
  -- For reference: these are NOT changed by the migration.
  (select count(*) from public.pinterest_posts) as pins,
  (select count(*) from public.pinterest_posts where publication_status = 'published') as published_pins,
  (select pinterest_enabled from public.automation_settings where id) as automatic_pins_switch;
