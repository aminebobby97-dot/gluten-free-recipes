-- Checks for the PROPOSED Phase 2 migration. Run after all migrations, the seed
-- and supabase/proposed/20261027000001_phase2_automation.sql are applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/proposed/tests/phase2_automation_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');

insert into public.keywords (keyword, priority) values
  ('gluten free lemon bars', 5),
  ('gluten free fish tacos', 0),
  ('gluten free banana muffins', 0);

-- 1. Automation is off, in review mode, and guarded by default.
do $$
declare
  s public.automation_settings := (select a from public.automation_settings a);
begin
  if s.enabled or s.publish_mode <> 'review' or s.pinterest_enabled then
    raise exception 'automation settings are not safe by default';
  end if;
  if s.min_reviewed_before_auto <> 5 or s.daily_budget_usd <= 0 then
    raise exception 'review threshold or daily budget default is wrong';
  end if;
end $$;

-- 2. Anonymous and non-admin users cannot see or call anything new.
set local role anon;
do $$
begin
  begin
    perform 1 from public.automation_settings;
    raise exception 'anon can read automation_settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_generated_recipe(gen_random_uuid());
    raise exception 'anon can call publish_generated_recipe';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_spend();
    raise exception 'anon can call ai_spend';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  if (select count(*) from public.automation_settings) <> 0 then
    raise exception 'non-admin can read automation_settings';
  end if;
  if public.ai_spend() <> 0 then
    raise exception 'non-admin can see AI spend';
  end if;
  begin
    perform public.claim_next_keyword(gen_random_uuid());
    raise exception 'authenticated can call claim_next_keyword';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Admins can read and change settings, but not write the job log.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.automation_settings set enabled = true, publish_mode = 'auto';
do $$
begin
  if (select publish_mode from public.automation_settings) <> 'auto' then
    raise exception 'admin cannot update automation_settings';
  end if;
  begin
    insert into public.publishing_job_events (job_id, step, status) values (gen_random_uuid(), 'x', 'info');
    raise exception 'admin can write publishing_job_events';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 4. Auto mode is refused until five AI recipes were approved by a person.
set local role service_role;
do $$
declare
  v_job uuid;
begin
  insert into public.publishing_jobs (job_date, idempotency_key, status, mode)
  values ('2026-10-31', 'daily_recipe:2026-10-31', 'running', 'auto') returning id into v_job;
  begin
    perform public.publish_generated_recipe(v_job);
    raise exception 'auto publish allowed before five reviewed recipes';
  exception when raise_exception then
    if sqlerrm not like 'only 0 of 5 required AI recipes%' then raise; end if;
  end;
end $$;
reset role;

insert into public.recipes (
  title, slug, description, introduction, category_id, ingredients, instructions,
  prep_time, cook_time, servings, featured_image, featured_image_alt, source, status, published_at
)
select 'Reviewed recipe ' || n, 'reviewed-recipe-' || n, 'Desc.', 'Intro.',
       (select id from public.categories where slug = 'gluten-free-dinner'),
       '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
       5, 20, 2, 'https://example.test/r.webp', 'Rice', 'ai', 'published', now()
from generate_series(1, 5) as n;

-- 5. Worker happy path in auto mode: claim -> draft -> atomic publish.
set local role service_role;
do $$
declare
  v_job uuid;
  v_kw public.keywords;
  v_recipe uuid;
  v_published public.recipes;
begin
  insert into public.publishing_jobs (job_date, idempotency_key, status, mode)
  values ('2026-11-01', 'daily_recipe:2026-11-01', 'running', 'auto') returning id into v_job;

  v_kw := public.claim_next_keyword(v_job);
  if v_kw.keyword <> 'gluten free lemon bars' then
    raise exception 'claim_next_keyword ignored priority, got %', v_kw.keyword;
  end if;

  insert into public.recipes (
    title, slug, description, introduction, category_id, ingredients, instructions,
    prep_time, cook_time, servings, featured_image, featured_image_alt, focus_keyword,
    source, image_source, generation_job_id, allergens, status
  ) values (
    'Gluten-Free Lemon Bars', 'gluten-free-lemon-bars', 'Tangy lemon bars.', 'An introduction.',
    (select id from public.categories where slug = 'gluten-free-desserts'),
    '[{"amount":"1","unit":"cup","name":"gluten-free flour blend"}]', '[{"text":"Bake."}]',
    15, 40, 16, 'https://example.test/lemon.webp', 'Lemon bars on parchment', 'gluten free lemon bars',
    'ai', 'ai', v_job, '{eggs,milk}', 'in_review'
  ) returning id into v_recipe;
  update public.keywords set status = 'assigned', assigned_recipe_id = v_recipe where id = v_kw.id;
  update public.publishing_jobs set recipe_id = v_recipe where id = v_job;

  v_published := public.publish_generated_recipe(v_job);
  if v_published.status <> 'published' or v_published.published_at is null then
    raise exception 'recipe was not published';
  end if;
  if (select status from public.keywords where id = v_kw.id) <> 'used' then
    raise exception 'keyword was not marked used';
  end if;
  if (select status from public.publishing_jobs where id = v_job) <> 'succeeded' then
    raise exception 'job was not completed';
  end if;

  -- Publishing twice is refused (job no longer running).
  begin
    perform public.publish_generated_recipe(v_job);
    raise exception 'job published twice';
  exception when raise_exception then
    if sqlerrm like 'job published twice' then raise; end if;
  end;
end $$;

-- 6. An incomplete recipe cannot be published, and nothing else changes.
do $$
declare
  v_job uuid;
  v_kw public.keywords;
  v_recipe uuid;
begin
  insert into public.publishing_jobs (job_date, idempotency_key, status, mode)
  values ('2026-11-02', 'daily_recipe:2026-11-02', 'running', 'auto') returning id into v_job;
  v_kw := public.claim_next_keyword(v_job);

  insert into public.recipes (title, slug, category_id, source, generation_job_id)
  values ('Gluten-Free Fish Tacos', 'gluten-free-fish-tacos',
          (select id from public.categories where slug = 'gluten-free-dinner'), 'ai', v_job)
  returning id into v_recipe;
  update public.publishing_jobs set recipe_id = v_recipe where id = v_job;

  begin
    perform public.publish_generated_recipe(v_job);
    raise exception 'incomplete recipe was published';
  exception when check_violation then null;
  end;

  if (select status from public.recipes where id = v_recipe) <> 'draft'
     or (select status from public.keywords where id = v_kw.id) <> 'queued'
     or (select status from public.publishing_jobs where id = v_job) <> 'running' then
    raise exception 'failed publish left partial changes';
  end if;
end $$;

-- 7. Review mode jobs, and recipes marked tested, cannot be auto-published.
do $$
declare
  v_job uuid;
begin
  insert into public.publishing_jobs (job_date, idempotency_key, status, mode, recipe_id, keyword_id)
  values ('2026-11-03', 'daily_recipe:2026-11-03', 'running', 'review',
          (select id from public.recipes where slug = 'gluten-free-fish-tacos'),
          (select id from public.keywords where keyword = 'gluten free banana muffins'))
  returning id into v_job;
  begin
    perform public.publish_generated_recipe(v_job);
    raise exception 'review-mode job published';
  exception when raise_exception then
    if sqlerrm like 'review-mode job published' then raise; end if;
  end;
end $$;

-- 8. A keyword that fails three times is rejected instead of retried forever.
do $$
declare
  v_id uuid := (select id from public.keywords where keyword = 'gluten free banana muffins');
begin
  update public.keywords set status = 'queued', attempt_count = 2 where id = v_id;
  perform public.release_keyword(v_id, 'first failure');
  if (select status from public.keywords where id = v_id) <> 'new' then
    raise exception 'keyword was not returned to the pool';
  end if;
  update public.keywords set status = 'queued', attempt_count = 3 where id = v_id;
  perform public.release_keyword(v_id, 'third failure');
  if (select status from public.keywords where id = v_id) <> 'rejected' then
    raise exception 'keyword was not rejected after three failures';
  end if;
end $$;

-- 9. Near-duplicate titles and focus keywords are found.
do $$
begin
  if not exists (select 1 from public.find_similar_recipes('Easy Gluten-Free Lemon Bars')) then
    raise exception 'near-duplicate title not found';
  end if;
  if not exists (select 1 from public.find_similar_recipes('Zesty Citrus Squares', 'lemon bars gluten free')) then
    raise exception 'near-duplicate focus keyword not found';
  end if;
  if exists (select 1 from public.find_similar_recipes('Crispy Roasted Chickpeas')) then
    raise exception 'unrelated title reported as duplicate';
  end if;
end $$;

-- 10. Keyword choice: priority, then opportunity; hard keywords skipped;
--     keywords that would cannibalize an existing article are rejected.
do $$
declare
  v_kw public.keywords;
begin
  insert into public.keywords (keyword, priority, search_volume, keyword_difficulty, data_source) values
    ('gluten free lemon bars recipe', 10, 5000, 10, 'test'),   -- cannibalizes the published lemon bars
    ('gluten free chicken curry', 0, 9000, 85, 'test'),        -- too hard (max 40)
    ('gluten free apple crisp', 0, 900, 30, 'test'),           -- score 22.5
    ('gluten free zucchini bread', 0, 1000, 10, 'test');       -- score 50

  v_kw := public.claim_next_keyword(gen_random_uuid());
  if v_kw.keyword <> 'gluten free zucchini bread' then
    raise exception 'expected the best-opportunity keyword, got %', v_kw.keyword;
  end if;
  if (select status from public.keywords where keyword = 'gluten free lemon bars recipe') <> 'rejected'
     or (select last_error from public.keywords where keyword = 'gluten free lemon bars recipe') not like 'Too similar to%' then
    raise exception 'cannibalizing keyword was not rejected with a reason';
  end if;
  if (select status from public.keywords where keyword = 'gluten free chicken curry') <> 'new' then
    raise exception 'too-hard keyword was touched';
  end if;
  v_kw := public.claim_next_keyword(gen_random_uuid());
  if v_kw.keyword <> 'gluten free apple crisp' then
    raise exception 'expected apple crisp second, got %', v_kw.keyword;
  end if;
  if public.claim_next_keyword(gen_random_uuid()) is not null then
    raise exception 'a too-hard keyword was claimed';
  end if;
end $$;

-- 11. AI spend is summed per UTC day.
do $$
declare
  v_job uuid := (select id from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-11-01');
begin
  insert into public.generation_attempts (job_id, kind, provider, model, prompt_version, status, cost_usd, created_at) values
    (v_job, 'recipe', 'anthropic', 'claude-opus-5-5', 'v1', 'succeeded', 1.25, now()),
    (v_job, 'image', 'openai', 'image-model', 'v1', 'succeeded', 0.50, now()),
    (v_job, 'recipe', 'anthropic', 'claude-opus-5-5', 'v1', 'succeeded', 9.00, now() - interval '2 days');
  if public.ai_spend() <> 1.75 then
    raise exception 'ai_spend() returned %, expected 1.75', public.ai_spend();
  end if;
end $$;
reset role;

-- 12. Allergens are limited to the eight that can appear in a gluten-free recipe.
do $$
begin
  begin
    update public.recipes set allergens = '{wheat}' where slug = 'gluten-free-lemon-bars';
    raise exception 'wheat accepted as an allergen';
  exception when check_violation then null;
  end;
end $$;

-- 13. In review mode, the admin "Publish" button marks the keyword used.
do $$
declare
  v_kw uuid;
  v_recipe uuid;
begin
  insert into public.keywords (keyword, status) values ('gluten free pizza crust', 'assigned') returning id into v_kw;
  insert into public.recipes (
    title, slug, description, introduction, category_id, ingredients, instructions,
    prep_time, cook_time, servings, featured_image, featured_image_alt, source, status
  ) values (
    'Gluten-Free Pizza Crust', 'gluten-free-pizza-crust', 'Crisp crust.', 'Intro.',
    (select id from public.categories where slug = 'gluten-free-baking'),
    '[{"amount":"2","unit":"cups","name":"gluten-free flour blend"}]', '[{"text":"Bake."}]',
    20, 15, 8, 'https://example.test/pizza.webp', 'Pizza crust', 'ai', 'in_review'
  ) returning id into v_recipe;
  update public.keywords set assigned_recipe_id = v_recipe where id = v_kw;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.recipes set status = 'published', published_at = now() where slug = 'gluten-free-pizza-crust';
reset role;

do $$
begin
  if (select status from public.keywords where keyword = 'gluten free pizza crust') <> 'used' then
    raise exception 'admin publish did not mark keyword used';
  end if;
end $$;

select 'All Phase 2 automation checks passed' as result;

rollback;
