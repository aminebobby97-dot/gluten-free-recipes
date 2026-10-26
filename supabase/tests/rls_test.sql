-- Row Level Security and constraint checks.
--
-- Run against a database that has the migrations and seed applied, e.g. a local
-- Supabase stack:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

-- Fixtures: one admin, one ordinary signed-in user, one published recipe.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');

insert into public.recipes (
  title, slug, description, introduction, category_id, ingredients, instructions,
  prep_time, cook_time, servings, featured_image, featured_image_alt, status, published_at
) values (
  'RLS Test Recipe', 'rls-test-recipe', 'Test description', 'Test introduction',
  (select id from public.categories where slug = 'gluten-free-dinner'),
  '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook the rice."}]',
  5, 20, 2, 'https://example.test/rice.jpg', 'A bowl of rice', 'published', now()
);

-- 1. Anonymous visitors see published recipes only.
set local role anon;
do $$
begin
  if (select count(*) from public.recipes where status <> 'published') <> 0 then
    raise exception 'anon can read unpublished recipes';
  end if;
  if (select count(*) from public.recipes where slug = 'rls-test-recipe') <> 1 then
    raise exception 'anon cannot read a published recipe';
  end if;
  if (select count(*) from public.categories) < 8 then
    raise exception 'anon cannot read categories';
  end if;
end $$;

-- 2. Anonymous visitors cannot read private tables.
do $$
begin
  begin
    perform 1 from public.keywords;
    raise exception 'anon can read keywords';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.publishing_jobs;
    raise exception 'anon can read publishing_jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.pinterest_posts;
    raise exception 'anon can read pinterest_posts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Anonymous visitors cannot write recipes, and cannot call automation RPCs.
do $$
begin
  begin
    insert into public.recipes (title, slug) values ('Hack', 'hack');
    raise exception 'anon can insert recipes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_next_keyword(gen_random_uuid());
    raise exception 'anon can call claim_next_keyword';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 4. View counting only works for published recipes.
select public.increment_recipe_view('rls-test-recipe');
select public.increment_recipe_view('fluffy-gluten-free-pancakes'); -- draft: ignored
reset role;
do $$
begin
  if (select view_count from public.recipe_views v join public.recipes r on r.id = v.recipe_id where r.slug = 'rls-test-recipe') <> 1 then
    raise exception 'view was not counted for the published recipe';
  end if;
  if exists (select 1 from public.recipe_views v join public.recipes r on r.id = v.recipe_id where r.slug = 'fluffy-gluten-free-pancakes') then
    raise exception 'view was counted for a draft recipe';
  end if;
end $$;

-- 5. A signed-in non-admin behaves like the public.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if (select count(*) from public.recipes where status = 'draft') <> 0 then
    raise exception 'non-admin can read drafts';
  end if;
  if (select count(*) from public.keywords) <> 0 or (select count(*) from public.publishing_jobs) <> 0 then
    raise exception 'non-admin can read private tables';
  end if;
  update public.recipes set title = 'Changed' where slug = 'rls-test-recipe';
  if (select title from public.recipes where slug = 'rls-test-recipe') <> 'RLS Test Recipe' then
    raise exception 'non-admin can update recipes';
  end if;
  begin
    insert into public.keywords (keyword) values ('should fail');
    raise exception 'non-admin can insert keywords';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. An admin can read drafts and manage private tables.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  if (select count(*) from public.recipes where status = 'draft') < 5 then
    raise exception 'admin cannot read drafts';
  end if;
  insert into public.keywords (keyword, search_volume, keyword_difficulty)
    values ('gluten free waffles', null, null);
  if (select count(*) from public.keywords) <> 1 then
    raise exception 'admin cannot insert keywords';
  end if;
end $$;
reset role;

-- 7. Constraints: incomplete recipes cannot be published.
do $$
begin
  begin
    update public.recipes set status = 'published', published_at = now()
    where slug = 'fluffy-gluten-free-pancakes'; -- has no featured image yet
    raise exception 'an incomplete recipe was published';
  exception when check_violation then null;
  end;
end $$;

-- 8. Idempotency: one daily job per date, keywords are de-duplicated.
insert into public.publishing_jobs (job_date, idempotency_key) values ('2030-01-01', 'daily_recipe:2030-01-01');
do $$
begin
  begin
    insert into public.publishing_jobs (job_date, idempotency_key) values ('2030-01-01', 'daily_recipe:2030-01-01b');
    raise exception 'two daily jobs were created for the same date';
  exception when unique_violation then null;
  end;
  begin
    insert into public.keywords (keyword) values ('  Gluten   Free WAFFLES ');
    raise exception 'duplicate keyword was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- 9. Pinterest posts: one row per idempotency key, published requires a pin id.
insert into public.pinterest_posts (recipe_id, pin_title, image_url, destination_url, idempotency_key)
values ((select id from public.recipes where slug = 'rls-test-recipe'), 'Pin', 'https://example.test/p.jpg',
        'https://example.test/recipes/rls-test-recipe', 'pin:rls-test-recipe:primary');
do $$
begin
  begin
    insert into public.pinterest_posts (recipe_id, pin_title, image_url, destination_url, idempotency_key)
    values ((select id from public.recipes where slug = 'rls-test-recipe'), 'Pin', 'https://example.test/p.jpg',
            'https://example.test/recipes/rls-test-recipe', 'pin:rls-test-recipe:primary');
    raise exception 'duplicate pin was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.pinterest_posts set publication_status = 'published' where idempotency_key = 'pin:rls-test-recipe:primary';
    raise exception 'pin marked published without a Pinterest id';
  exception when check_violation then null;
  end;
end $$;

-- 10. Search returns published recipes only.
set local role anon;
do $$
begin
  if (select count(*) from public.search_recipes('rls test')) <> 1 then
    raise exception 'search did not find the published recipe';
  end if;
  if (select count(*) from public.search_recipes('pancakes')) <> 0 then
    raise exception 'search returned a draft';
  end if;
end $$;
reset role;

select 'All RLS and constraint checks passed' as result;
rollback;
