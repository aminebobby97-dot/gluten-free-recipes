-- Checks for the Pinterest Pin preparation migration. Run after all
-- migrations (including 20261028000001_pinterest_pins.sql) and the seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pinterest_pins_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');

create temp table t_recipe on commit drop as select id from public.recipes order by created_at limit 1;
grant select on t_recipe to anon, authenticated, service_role;

-- 1. An admin can save a ready Pin with every new field.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.pinterest_posts (recipe_id, pin_title, pin_description, image_url, image_path, destination_url, idempotency_key, publication_status, keywords, image_text, prepared_at)
select id, 'Banana Bread (Gluten-Free)', 'Soft and easy.', 'https://cdn.example.test/pins/a.jpg', 'pins/a.jpg',
       'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:primary', 'ready', array['gluten free banana bread'], 'Banana Bread', now()
from t_recipe;

do $$
begin
  if (select board_name from public.pinterest_posts where idempotency_key = 'pin:test:primary') <> 'Gluten-Free Recipes' then
    raise exception 'board_name default is wrong';
  end if;

  -- 2. No duplicate Pin for the same recipe and variant.
  begin
    insert into public.pinterest_posts (recipe_id, pin_title, destination_url, idempotency_key)
    select id, 'Second', 'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:other' from t_recipe;
    raise exception 'a second Pin for the same recipe was accepted';
  exception when unique_violation then null;
  end;

  -- 3. A pending Pin may have no image yet, but a ready one must.
  begin
    insert into public.pinterest_posts (recipe_id, variant, pin_title, destination_url, idempotency_key, publication_status)
    select id, 'alt', 'No image', 'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:alt', 'ready' from t_recipe;
    raise exception 'a ready Pin without an image was accepted';
  exception when check_violation then null;
  end;
  insert into public.pinterest_posts (recipe_id, variant, pin_title, destination_url, idempotency_key)
  select id, 'alt', 'Pending', 'https://www.glutenfreerecipehub.com/recipes/banana-bread', 'pin:test:alt' from t_recipe;

  -- 4. Published still requires a Pinterest Pin id.
  begin
    update public.pinterest_posts set publication_status = 'published', published_at = now() where idempotency_key = 'pin:test:primary';
    raise exception 'a published Pin without a Pinterest id was accepted';
  exception when check_violation then null;
  end;

  -- 5. Limits.
  begin
    update public.pinterest_posts set pin_title = repeat('x', 101) where idempotency_key = 'pin:test:primary';
    raise exception 'a 101-character title was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.pinterest_posts set pin_description = repeat('x', 501) where idempotency_key = 'pin:test:primary';
    raise exception 'a 501-character description was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 6. Non-admins and anonymous visitors see nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  if exists (select 1 from public.pinterest_posts) then
    raise exception 'a non-admin can read Pins';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.pinterest_posts;
    raise exception 'anon can read Pins';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 7. The worker (service role) can prepare Pins.
set local role service_role;
update public.pinterest_posts set publication_status = 'ready', image_url = 'https://cdn.example.test/pins/b.jpg' where idempotency_key = 'pin:test:alt';

reset role;
select 'pinterest_pins_test: all checks passed' as result;
rollback;
