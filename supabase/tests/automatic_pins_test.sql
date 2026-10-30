-- Checks for the automatic Pins migration. Run after all migrations, the
-- proposed Pinterest migrations (20261028000001, 20261028000002,
-- 20261030000001) and the seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/automatic_pins_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.pinterest_connection (access_token_encrypted, refresh_token_encrypted, access_token_expires_at, connected_by)
values ('v1.aaa.bbb.ccc', 'v1.ddd.eee.fff', now() + interval '30 days', '00000000-0000-0000-0000-00000000000a');

-- 1. The worker can read and refresh the sign-in (still only ciphertext).
set local role service_role;
do $$
begin
  if (select count(*) from public.pinterest_connection) <> 1 then
    raise exception 'service_role cannot read the Pinterest connection';
  end if;
  update public.pinterest_connection set access_token_encrypted = 'v1.new.new.new', token_version = token_version + 1;
  begin
    update public.pinterest_connection set access_token_encrypted = 'pina_plain_token';
    raise exception 'a plain token was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 2. It cannot create or delete a connection.
do $$
begin
  insert into public.pinterest_connection (id, access_token_encrypted, refresh_token_encrypted, access_token_expires_at)
  values (true, 'v1.x', 'v1.y', now());
  raise exception 'service_role can insert a Pinterest connection';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  delete from public.pinterest_connection;
  raise exception 'service_role can delete the Pinterest connection';
exception when insufficient_privilege then null;
end $$;

-- 3. Visitors still have no access.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.pinterest_connection;
  raise exception 'anon can read the Pinterest connection';
exception when insufficient_privilege then null;
end $$;

-- 4. published_via only accepts the two known values.
reset role;
do $$
declare
  v_recipe uuid;
begin
  select id into v_recipe from public.recipes limit 1;
  if v_recipe is null then return; end if;
  insert into public.pinterest_posts (recipe_id, pin_title, destination_url, idempotency_key, published_via, publish_started_at)
  values (v_recipe, 'Test', 'https://example.test/recipes/x', 'pin:test:automatic', 'automation', now());
  begin
    update public.pinterest_posts set published_via = 'robot' where idempotency_key = 'pin:test:automatic';
    raise exception 'published_via accepted an unknown value';
  exception when check_violation then null;
  end;
end $$;

-- 5. Nothing was switched on.
do $$
begin
  if (select pinterest_enabled from public.automation_settings where id) then
    raise exception 'pinterest_enabled was switched on';
  end if;
end $$;

rollback;
