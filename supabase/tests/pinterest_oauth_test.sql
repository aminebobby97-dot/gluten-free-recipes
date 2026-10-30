-- Checks for the Pinterest OAuth migration. Run after all migrations
-- (including 20261028000002_pinterest_oauth.sql) and the seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pinterest_oauth_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');

-- 1. An admin can save a connection with encrypted tokens.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.pinterest_connection (access_token_encrypted, refresh_token_encrypted, access_token_expires_at, connected_by)
values ('v1.aaa.bbb.ccc', 'v1.ddd.eee.fff', now() + interval '30 days', '00000000-0000-0000-0000-00000000000a');

do $$
begin
  if (select count(*) from public.pinterest_connection) <> 1 then
    raise exception 'admin cannot read the connection';
  end if;

  -- 2. A plain (unencrypted) token is refused.
  begin
    update public.pinterest_connection set access_token_encrypted = 'pina_plain_token';
    raise exception 'a plain access token was accepted';
  exception when check_violation then null;
  end;

  -- 3. Only one connection row can exist.
  begin
    insert into public.pinterest_connection (id, access_token_encrypted, refresh_token_encrypted, access_token_expires_at)
    values (false, 'v1.a.b.c', 'v1.a.b.c', now());
    raise exception 'a second connection row was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 4. A signed-in user who is not an admin sees nothing and changes nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  if (select count(*) from public.pinterest_connection) <> 0 then
    raise exception 'a non-admin can read the Pinterest connection';
  end if;
  update public.pinterest_connection set status = 'needs_reconnect';
  delete from public.pinterest_connection;
end $$;

-- 5. Visitors (anon) have no access at all.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.pinterest_connection;
  raise exception 'anon can read the Pinterest connection';
exception when insufficient_privilege then null;
end $$;

-- 6. The automation worker (service_role) cannot create or delete the
-- connection. (After 20261030000001_automatic_pins.sql it may read and refresh
-- it; see automatic_pins_test.sql.)
reset role;
set local role service_role;
do $$
begin
  delete from public.pinterest_connection;
  raise exception 'service_role can delete the Pinterest connection';
exception when insufficient_privilege then null;
end $$;

reset role;
do $$
begin
  if (select status from public.pinterest_connection) <> 'connected' then
    raise exception 'a non-admin changed the connection';
  end if;
end $$;

rollback;
