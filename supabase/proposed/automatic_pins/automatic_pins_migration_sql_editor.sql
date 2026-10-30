-- Automatic Pins migration, for the Supabase SQL Editor.
-- Same content as supabase/proposed/20261030000001_automatic_pins.sql.
-- Additive only, no DROP statements, safe to run twice. Switches nothing on.

begin;

-- The daily worker may read and refresh the (encrypted) Pinterest sign-in.
-- It still cannot create or delete the connection.
grant select, update on public.pinterest_connection to service_role;

-- When the current publish attempt started, and who published the Pin.
alter table public.pinterest_posts
  add column if not exists publish_started_at timestamptz,
  add column if not exists published_via text
    check (published_via is null or published_via in ('admin', 'automation'));

commit;
