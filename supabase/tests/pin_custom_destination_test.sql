-- Checks for the custom destination URL migration. Run after all migrations,
-- the proposed Pinterest migrations (20261028000001, 20261028000002,
-- 20261030000001, 20261103000001) and the seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pin_custom_destination_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');

create temp table t_recipe on commit drop as select id from public.recipes order by created_at limit 1;
grant select on t_recipe to anon, authenticated, service_role;

-- The daily worker prepares a Pin: it cannot give it a custom link.
set local role service_role;
insert into public.pinterest_posts (recipe_id, pin_title, image_url, image_path, destination_url, idempotency_key, publication_status, image_text, prepared_at)
select id, 'Banana Bread', 'https://cdn.example.test/pins/a.jpg', 'pins/a.jpg', 'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:primary', 'ready', 'Banana Bread', now()
from t_recipe;
do $$
begin
  begin
    insert into public.pinterest_posts (recipe_id, variant, pin_title, destination_url, idempotency_key, custom_destination_url)
    select id, 'second', 'Second', 'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:second', 'https://bit.ly/abc' from t_recipe;
    raise exception 'service_role inserted a Pin with a custom link';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 1. An admin saves a Bitly link.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.pinterest_posts
   set custom_destination_url = 'https://bit.ly/3AbCdEf', custom_destination_set_at = now(), custom_destination_set_by = '00000000-0000-0000-0000-00000000000a'
 where idempotency_key = 'pin:test:primary';
do $$
begin
  if (select custom_destination_url from public.pinterest_posts where idempotency_key = 'pin:test:primary') <> 'https://bit.ly/3AbCdEf' then
    raise exception 'the admin could not save a custom link';
  end if;

  -- 2. Only https:// links without spaces are stored.
  begin
    update public.pinterest_posts set custom_destination_url = 'http://bit.ly/abc' where idempotency_key = 'pin:test:primary';
    raise exception 'an http:// link was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.pinterest_posts set custom_destination_url = 'https://bit.ly/a b' where idempotency_key = 'pin:test:primary';
    raise exception 'a link with a space was accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- 3. The worker can still refresh the Pin (new recipe address), but not the custom link.
set local role service_role;
update public.pinterest_posts set destination_url = 'https://www.glutenfreerecipehub.com/recipes/best-banana-bread', prepared_at = now() where idempotency_key = 'pin:test:primary';
do $$
begin
  if (select custom_destination_url from public.pinterest_posts where idempotency_key = 'pin:test:primary') <> 'https://bit.ly/3AbCdEf' then
    raise exception 'refreshing the Pin changed the custom link';
  end if;
  begin
    update public.pinterest_posts set custom_destination_url = null where idempotency_key = 'pin:test:primary';
    raise exception 'service_role removed the custom link';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Publishing (status changes) still works for the worker.
update public.pinterest_posts set publication_status = 'publishing', publish_started_at = now() where idempotency_key = 'pin:test:primary';
reset role;

-- 4. Nobody, not even an admin, changes the link of a Pin that is publishing or published.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  begin
    update public.pinterest_posts set custom_destination_url = 'https://bit.ly/other' where idempotency_key = 'pin:test:primary';
    raise exception 'the link of a publishing Pin was changed';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- 5. Visitors still see no Pins.
set local role anon;
do $$
begin
  if (select count(*) from public.pinterest_posts) <> 0 then
    raise exception 'visitors can read Pins';
  end if;
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
