-- Run FIRST in the Supabase SQL Editor. Read-only: changes nothing.
-- Shows what the automatic Pins migration will change.

select
  -- Must be true: the Pinterest OAuth migration is applied.
  to_regclass('public.pinterest_connection') is not null as pinterest_connection_exists,
  -- Expected false before the migration, true after.
  has_table_privilege('service_role', 'public.pinterest_connection', 'SELECT') as worker_can_read_connection,
  has_table_privilege('service_role', 'public.pinterest_connection', 'UPDATE') as worker_can_update_connection,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'publish_started_at') as has_publish_started_at,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pinterest_posts' and column_name = 'published_via') as has_published_via,
  -- For reference: these switches are NOT changed by the migration.
  (select enabled from public.automation_settings where id) as automation_enabled,
  (select publish_mode from public.automation_settings where id) as publish_mode,
  (select pinterest_enabled from public.automation_settings where id) as pinterest_enabled,
  (select count(*) from public.pinterest_posts) as pins;
