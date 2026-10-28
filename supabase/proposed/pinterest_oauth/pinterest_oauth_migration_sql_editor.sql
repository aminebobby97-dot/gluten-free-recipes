-- Pinterest OAuth migration for the Supabase SQL Editor.
-- The same SQL as supabase/proposed/20261028000002_pinterest_oauth.sql, wrapped
-- in one transaction: if any statement fails, nothing is changed.
-- Run supabase/proposed/pinterest_oauth/pinterest_oauth_before.sql first and
-- supabase/proposed/pinterest_oauth/pinterest_oauth_verify.sql after.
-- Safe to run more than once. It contains no DROP, DELETE or TRUNCATE. It only ADDS a table and one column: no recipe,
-- Pin, setting or existing security rule is changed or deleted.

begin;

create table if not exists public.pinterest_connection (
  id boolean primary key default true check (id), -- forces a single row
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  pinterest_username text check (pinterest_username is null or char_length(pinterest_username) <= 200),
  pinterest_account_type text check (pinterest_account_type is null or char_length(pinterest_account_type) <= 40),
  profile_image text check (profile_image is null or char_length(profile_image) <= 2048),
  scopes text[] not null default '{}',
  -- AES-256-GCM ciphertext written by the website. Never a plain token.
  access_token_encrypted text not null check (access_token_encrypted like 'v1.%'),
  refresh_token_encrypted text not null check (refresh_token_encrypted like 'v1.%'),
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  -- Bumped on every token change, so two refreshes at once cannot overwrite each other.
  token_version integer not null default 1 check (token_version >= 1),
  last_refreshed_at timestamptz,
  -- Boards as last read from Pinterest: [{ "id", "name", "privacy", "pin_count" }].
  boards jsonb not null default '[]'::jsonb check (jsonb_typeof(boards) = 'array'),
  boards_fetched_at timestamptz,
  selected_board_id text check (selected_board_id is null or selected_board_id ~ '^[0-9]{1,40}$'),
  selected_board_name text check (selected_board_name is null or char_length(selected_board_name) <= 180),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  connected_at timestamptz not null default now(),
  connected_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- No DROP statements anywhere in this file: re-running it replaces the trigger
-- in place and skips the policy if it already exists.
create or replace trigger pinterest_connection_updated_at
before update on public.pinterest_connection
for each row execute function public.set_updated_at();

alter table public.pinterest_connection enable row level security;

-- REVOKE only touches the new pinterest_connection table: it removes the
-- default access Supabase gives every role on a new table, so that only the
-- grant below (admins, through RLS) remains.
revoke all on public.pinterest_connection from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.pinterest_connection to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pinterest_connection' and policyname = 'pinterest_connection: admin all'
  ) then
    create policy "pinterest_connection: admin all"
      on public.pinterest_connection for all to authenticated
      using ((select public.is_admin())) with check ((select public.is_admin()));
  end if;
end $$;

-- Who published a Pin (manual publishing from the dashboard).
alter table public.pinterest_posts
  add column if not exists published_by uuid references auth.users (id) on delete set null;

commit;
