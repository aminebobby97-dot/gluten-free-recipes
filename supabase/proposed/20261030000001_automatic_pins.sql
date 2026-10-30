-- PROPOSED for review. NOT APPLIED. Not in supabase/migrations/, so
-- `supabase db push` ignores it. Move it there once it has been applied.
--
-- Automatic Pinterest publishing by the daily worker.
--   * The worker's service role may READ and UPDATE the single
--     pinterest_connection row, so it can use the Pinterest sign-in and refresh
--     it. It still cannot insert or delete the row (connecting and
--     disconnecting stay admin-only). Tokens remain encrypted: the key
--     (PINTEREST_TOKEN_ENCRYPTION_KEY) is only in Vercel and in the GitHub
--     `automation` environment, never in the database.
--   * pinterest_posts gains
--       publish_started_at  when the current publish attempt started, so a Pin
--                           whose result is unknown (timeout, crash) can be
--                           checked against Pinterest before any retry
--       published_via       'admin' (Publish Pin button) or 'automation'
--
-- Additive only and safe to run twice: no DROP, no existing column, row,
-- policy or setting changes. automation_settings.enabled, publish_mode and
-- pinterest_enabled are left exactly as they are.

grant select, update on public.pinterest_connection to service_role;

alter table public.pinterest_posts
  add column if not exists publish_started_at timestamptz,
  add column if not exists published_via text
    check (published_via is null or published_via in ('admin', 'automation'));
