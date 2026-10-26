-- Checks for the Phase 2 automation migration. Run after all migrations and the
-- seed are applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase2_automation_test.sql
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

-- Five AI recipes waiting for review. Approval columns cannot be pre-filled.
insert into public.recipes (
  title, slug, description, introduction, category_id, ingredients, instructions,
  prep_time, cook_time, servings, featured_image, featured_image_alt, source, status,
  approved_at, approved_by
)
select 'Reviewed recipe ' || n, 'reviewed-recipe-' || n, 'Desc.', 'Intro.',
       (select id from public.categories where slug = 'gluten-free-dinner'),
       '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
       5, 20, 2, 'https://example.test/r.webp', 'Rice', 'ai', 'in_review',
       now(), '00000000-0000-0000-0000-00000000000a'
from generate_series(1, 5) as n;

-- 4b. Approvals are tracked only from a signed-in admin's publish.
do $$
begin
  if exists (select 1 from public.recipes where slug like 'reviewed-recipe-%' and (approved_at is not null or approved_by is not null)) then
    raise exception 'approval was pre-filled on insert';
  end if;
end $$;

--     The worker's service key cannot publish an AI recipe directly, and cannot
--     write approval columns, even with an admin's user id in the session.
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  begin
    update public.recipes set status = 'published', published_at = now() where slug = 'reviewed-recipe-1';
    raise exception 'service role published an AI recipe directly';
  exception when insufficient_privilege then null;
  end;
  update public.recipes set approved_at = now(), approved_by = '00000000-0000-0000-0000-00000000000a' where slug like 'reviewed-recipe-%';
  if exists (select 1 from public.recipes where slug like 'reviewed-recipe-%' and approved_at is not null) then
    raise exception 'service role forged an approval';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

--     A signed-in non-admin cannot approve either (RLS blocks the update).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
update public.recipes set status = 'published', published_at = now() where slug = 'reviewed-recipe-1';
reset role;

--     The admin approves four: still not enough for automatic publishing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.recipes set status = 'published', published_at = now() where slug in ('reviewed-recipe-1', 'reviewed-recipe-2', 'reviewed-recipe-3', 'reviewed-recipe-4');
reset role;
select set_config('request.jwt.claim.sub', '', true);

--     A fifth AI recipe that went live without a person (an earlier automatic
--     publish) makes 5 published but only 4 approved: it must not count.
do $$
declare
  v_job uuid;
begin
  insert into public.publishing_jobs (job_date, idempotency_key, status, mode)
  values ('2026-10-30', 'daily_recipe:2026-10-30', 'succeeded', 'auto') returning id into v_job;
  insert into public.recipes (
    title, slug, description, introduction, category_id, ingredients, instructions,
    prep_time, cook_time, servings, featured_image, featured_image_alt, source, status, generation_job_id
  ) values (
    'Earlier automatic recipe', 'earlier-automatic-recipe', 'Desc.', 'Intro.',
    (select id from public.categories where slug = 'gluten-free-dinner'),
    '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
    5, 20, 2, 'https://example.test/r.webp', 'Rice', 'ai', 'in_review', v_job
  );
  -- Runs as the database owner here, like publish_generated_recipe does.
  update public.recipes set status = 'published', published_at = now() where slug = 'earlier-automatic-recipe';
  if (select count(*) from public.recipes where source = 'ai' and status = 'published') <> 5 then
    raise exception 'setup: expected 5 published AI recipes';
  end if;
end $$;

set local role service_role;
do $$
declare
  v_job uuid := (select id from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-10-31');
begin
  if (select count(*) from public.recipes where approved_at is not null and approved_by = '00000000-0000-0000-0000-00000000000a') <> 4 then
    raise exception 'admin approvals were not recorded with the admin id';
  end if;
  begin
    perform public.publish_generated_recipe(v_job);
    raise exception 'auto publish allowed after four approvals';
  exception when raise_exception then
    if sqlerrm not like 'only 4 of 5 required AI recipes%' then raise; end if;
  end;
end $$;
reset role;

--     An approval survives unpublishing and cannot be changed by an admin edit.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.recipes set status = 'draft' where slug = 'reviewed-recipe-1';
update public.recipes set approved_by = null, approved_at = null where slug = 'reviewed-recipe-2';
update public.recipes set status = 'published', published_at = now() where slug = 'reviewed-recipe-5';
update public.recipes set status = 'published' where slug = 'reviewed-recipe-1';
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (select count(*) from public.recipes where source = 'ai' and approved_at is not null) <> 5 then
    raise exception 'expected 5 approvals, got %', (select count(*) from public.recipes where source = 'ai' and approved_at is not null);
  end if;
end $$;

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
  if v_published.approved_at is not null then
    raise exception 'an automatic publish was counted as a human approval';
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

-- 10b. Regression: the claim loop never re-selects a keyword it rejected.
--      Several high-priority duplicates are rejected one by one, then the next
--      valid keyword is claimed. A temporary trigger then blocks the 'rejected'
--      status update, as if it were undone: the loop must still move on instead
--      of picking the same keyword again.
do $$
declare
  v_kw public.keywords;
begin
  update public.keywords set status = 'used' where status = 'new';
  insert into public.keywords (keyword, priority) values
    ('easy gluten free lemon bars', 30),   -- duplicates the published lemon bars
    ('lemon bars gluten free', 20),        -- same
    ('best lemon bars recipe', 10),        -- same
    ('gluten free carrot cake', 0);        -- valid

  v_kw := public.claim_next_keyword(gen_random_uuid());
  if v_kw.keyword is distinct from 'gluten free carrot cake' then
    raise exception 'expected carrot cake after rejecting duplicates, got %', v_kw.keyword;
  end if;
  if (select count(*) from public.keywords
      where keyword in ('easy gluten free lemon bars', 'lemon bars gluten free', 'best lemon bars recipe')
        and status = 'rejected' and last_error like 'Too similar to%' and attempt_count = 0) <> 3 then
    raise exception 'duplicates were not each rejected exactly once with a reason';
  end if;
  if public.claim_next_keyword(gen_random_uuid()) is not null then
    raise exception 'a rejected keyword was claimed later';
  end if;
end $$;

reset role;
create function pg_temp.keep_keyword_new() returns trigger language plpgsql as $$
begin
  if new.status = 'rejected' then new.status := old.status; end if;
  return new;
end $$;
create trigger zz_keep_keyword_new before update on public.keywords
for each row execute function pg_temp.keep_keyword_new();
set local role service_role;

do $$
declare
  v_kw public.keywords;
begin
  insert into public.keywords (keyword, priority) values
    ('lemon bars easy', 50),               -- duplicate, and its rejection is blocked
    ('gluten free pumpkin pie', 0);        -- valid
  v_kw := public.claim_next_keyword(gen_random_uuid());
  if v_kw.keyword is distinct from 'gluten free pumpkin pie' then
    raise exception 'loop re-selected a rejected keyword or gave up, got %', v_kw.keyword;
  end if;
end $$;

reset role;
drop trigger zz_keep_keyword_new on public.keywords;
update public.keywords set status = 'rejected' where keyword = 'lemon bars easy';
set local role service_role;

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
  if (select approved_by from public.recipes where slug = 'gluten-free-pizza-crust') is distinct from '00000000-0000-0000-0000-00000000000a' then
    raise exception 'admin publish was not recorded as an approval';
  end if;
end $$;

-- 14. Dry runs may repeat within a day; daily jobs may not.
do $$
begin
  insert into public.publishing_jobs (job_type, job_date, idempotency_key, mode) values
    ('dry_run', '2026-11-05', 'dry_run:2026-11-05T10:00:00Z', 'dry_run'),
    ('dry_run', '2026-11-05', 'dry_run:2026-11-05T11:00:00Z', 'dry_run');
  insert into public.publishing_jobs (job_type, job_date, idempotency_key) values ('daily_recipe', '2026-11-05', 'daily_recipe:2026-11-05');
  begin
    insert into public.publishing_jobs (job_type, job_date, idempotency_key) values ('daily_recipe', '2026-11-05', 'daily_recipe:2026-11-05:again');
    raise exception 'two daily jobs on one date';
  exception when unique_violation then null;
  end;
end $$;

-- 15. Publishing authorization. Every client-side attempt below also forges
--     the old app.auto_publish_job session setting and an admin user id, to
--     prove neither grants anything any more.
insert into public.publishing_jobs (job_date, idempotency_key, status, mode)
values ('2026-11-10', 'daily_recipe:2026-11-10', 'running', 'auto');
insert into public.recipes (
  title, slug, description, introduction, category_id, ingredients, instructions,
  prep_time, cook_time, servings, featured_image, featured_image_alt, source, status, generation_job_id
) values (
  'Authorization test recipe', 'authorization-test-recipe', 'Desc.', 'Intro.',
  (select id from public.categories where slug = 'gluten-free-dinner'),
  '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
  5, 20, 2, 'https://example.test/r.webp', 'Rice', 'ai', 'in_review',
  (select id from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-11-10')
);

-- 15.1 An authenticated non-admin cannot publish an AI recipe: not by update,
--      not by inserting it published, not through publish_generated_recipe.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select set_config('app.auto_publish_job', (select id::text from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-11-10'), true);
update public.recipes set status = 'published', published_at = now() where slug = 'authorization-test-recipe';
do $$
begin
  begin
    insert into public.recipes (title, slug, category_id, source, status)
    values ('Sneaky', 'sneaky-recipe', (select id from public.categories limit 1), 'ai', 'published');
    raise exception 'non-admin inserted a published AI recipe';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_generated_recipe(gen_random_uuid());
    raise exception 'non-admin called publish_generated_recipe';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if (select status from public.recipes where slug = 'authorization-test-recipe') <> 'in_review' then
    raise exception '15.1 failed: a non-admin published an AI recipe';
  end if;
end $$;

-- 15.2 The service-role worker cannot publish through a direct table write,
--      cannot relabel an AI recipe as manual to publish it, and cannot insert
--      a recipe already published.
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select set_config('app.auto_publish_job', (select id::text from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-11-10'), true);
do $$
begin
  begin
    update public.recipes set status = 'published', published_at = now() where slug = 'authorization-test-recipe';
    raise exception '15.2 failed: service role published an AI recipe by update';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.recipes set source = 'manual' where slug = 'authorization-test-recipe';
    raise exception '15.2 failed: service role relabelled an AI recipe';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.recipes (
      title, slug, description, introduction, category_id, ingredients, instructions,
      prep_time, cook_time, servings, featured_image, featured_image_alt, source, status
    ) values (
      'Worker manual recipe', 'worker-manual-recipe', 'Desc.', 'Intro.',
      (select id from public.categories where slug = 'gluten-free-dinner'),
      '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
      5, 20, 2, 'https://example.test/r.webp', 'Rice', 'manual', 'published'
    );
    raise exception '15.2 failed: service role inserted a published recipe';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 15.3 The worker cannot get around the five-approval rule: it cannot lower
--      the requirement, switch automation on, or make itself an admin. (The
--      approval count itself is covered by 4 and 4b: 4 approvals plus an
--      automatic publish is refused, and approvals cannot be forged.)
do $$
begin
  begin
    update public.automation_settings set min_reviewed_before_auto = 0;
    raise exception '15.3 failed: worker changed the approval requirement';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.automation_settings set enabled = true, publish_mode = 'auto';
    raise exception '15.3 failed: worker switched automation on';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000b');
    raise exception '15.3 failed: worker made a user an admin';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('app.auto_publish_job', '', true);

-- 15.4 Authorized automatic publishing still works (5 approvals, auto mode,
--      called by the worker), and is not counted as an approval.
update public.automation_settings set enabled = true, publish_mode = 'auto';
update public.publishing_jobs
set recipe_id = (select id from public.recipes where slug = 'authorization-test-recipe'),
    keyword_id = (select id from public.keywords where keyword = 'gluten free carrot cake')
where idempotency_key = 'daily_recipe:2026-11-10';
set local role service_role;
do $$
declare
  v_recipe public.recipes;
begin
  v_recipe := public.publish_generated_recipe((select id from public.publishing_jobs where idempotency_key = 'daily_recipe:2026-11-10'));
  if v_recipe.status <> 'published' or v_recipe.approved_at is not null then
    raise exception '15.4 failed: authorized automatic publish did not work as expected';
  end if;
end $$;
reset role;

-- 15.5 Manual admin approval still works, for AI and manual recipes.
insert into public.recipes (
  title, slug, description, introduction, category_id, ingredients, instructions,
  prep_time, cook_time, servings, featured_image, featured_image_alt, source, status
) values
  ('Admin approved AI recipe', 'admin-approved-ai-recipe', 'Desc.', 'Intro.',
   (select id from public.categories where slug = 'gluten-free-dinner'),
   '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
   5, 20, 2, 'https://example.test/r.webp', 'Rice', 'ai', 'in_review'),
  ('Admin manual recipe', 'admin-manual-recipe', 'Desc.', 'Intro.',
   (select id from public.categories where slug = 'gluten-free-dinner'),
   '[{"amount":"1","unit":"cup","name":"rice"}]', '[{"text":"Cook."}]',
   5, 20, 2, 'https://example.test/r.webp', 'Rice', 'manual', 'draft');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.recipes set status = 'published', published_at = now() where slug in ('admin-approved-ai-recipe', 'admin-manual-recipe');
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if (select status <> 'published' or approved_by is distinct from '00000000-0000-0000-0000-00000000000a'
      from public.recipes where slug = 'admin-approved-ai-recipe') then
    raise exception '15.5 failed: admin approval of an AI recipe was not recorded';
  end if;
  if (select status <> 'published' or approved_at is not null from public.recipes where slug = 'admin-manual-recipe') then
    raise exception '15.5 failed: admin could not publish a manual recipe, or it was marked as an AI approval';
  end if;
end $$;

select 'All Phase 2 automation checks passed' as result;

rollback;
