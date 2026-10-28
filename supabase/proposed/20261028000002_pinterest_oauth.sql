-- PROPOSED for review. NOT APPLIED. Not in supabase/migrations/, so
-- `supabase db push` ignores it. Move it there once it has been applied.
--
-- Pinterest OAuth connection (Pinterest API v5).
--   * pinterest_connection: one row holding the connected Pinterest account,
--     its OAuth tokens (ENCRYPTED by the website with
--     PINTEREST_TOKEN_ENCRYPTION_KEY before they are saved; the database never
--     sees a plain token), the cached board list and the chosen board.
--   * pinterest_posts gains published_by, so a manual publish records who did it.
--
-- Security
--   * Row Level Security: admins only. Nobody else can read or change the row.
--   * anon has no access at all.
--   * service_role (the daily automation worker) has NO access either, so the
--     worker cannot read the tokens or post to Pinterest. Pins are only ever
--     published by an admin clicking "Publish Pin" in the dashboard.
--   * The token columns only accept the website's encrypted format ("v1." ...),
--     so a plain token can never be stored by mistake.
--
-- Additive only: existing tables, rows, policies and settings are unchanged.
-- automation_settings.enabled and pinterest_enabled stay false.

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

drop trigger if exists pinterest_connection_updated_at on public.pinterest_connection;
create trigger pinterest_connection_updated_at
before update on public.pinterest_connection
for each row execute function public.set_updated_at();

alter table public.pinterest_connection enable row level security;

revoke all on public.pinterest_connection from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.pinterest_connection to authenticated;

drop policy if exists "pinterest_connection: admin all" on public.pinterest_connection;
create policy "pinterest_connection: admin all"
  on public.pinterest_connection for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Who published a Pin (manual publishing from the dashboard).
alter table public.pinterest_posts
  add column if not exists published_by uuid references auth.users (id) on delete set null;
