-- PROPOSED for review. NOT APPLIED. Not in supabase/migrations/, so
-- `supabase db push` ignores it. Move it there once approved.
--
-- Phase 2: daily recipe automation.
--   * automation_settings      single-row kill switch and publish mode (off by default)
--   * publishing_job_events    append-only step log for every job
--   * generation_attempts      every AI call (recipe, review, image, image check) with tokens and cost
--   * recipes / keywords / publishing_jobs / pinterest_posts: new columns
--   * RPCs: claim_next_keyword (replaced), release_keyword, find_similar_keywords,
--     find_similar_recipes, ai_spend, publish_generated_recipe
--
-- Everything is additive: existing rows, policies and app behaviour are unchanged.

create extension if not exists pg_trgm with schema extensions;

-- keyword_core(text): what a keyword or title is actually about, for duplicate
-- checks. Drops words every keyword on this site shares ("gluten free",
-- "recipe", "easy"...), which otherwise make unrelated keywords look alike:
-- "gluten free zucchini bread" -> "zucchini bread".
create or replace function public.keyword_core(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      lower(regexp_replace(coalesce(p_text, ''), '[^[:alnum:]]+', ' ', 'g')),
      '\m(gluten|free|gf|celiac|recipes?|easy|best|simple|quick|homemade|ultimate|perfect|the|a|an|and|with|how|to|make|for)\M', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

grant execute on function public.keyword_core(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings: one row. Automation stays off until an admin turns it on.
-- ---------------------------------------------------------------------------
create table public.automation_settings (
  id boolean primary key default true check (id), -- forces a single row
  enabled boolean not null default false,
  -- review: the job stops at an in_review recipe that an admin publishes.
  -- auto:   the job publishes the recipe itself.
  publish_mode text not null default 'review' check (publish_mode in ('review', 'auto')),
  max_recipes_per_day integer not null default 1 check (max_recipes_per_day between 0 and 5),
  -- Auto mode is refused until this many AI recipes were approved by a person.
  min_reviewed_before_auto integer not null default 5 check (min_reviewed_before_auto between 0 and 100),
  -- Hard cap on AI spend per UTC day, across all jobs. Checked before every AI call.
  daily_budget_usd numeric(8, 2) not null default 3.00 check (daily_budget_usd between 0 and 100),
  -- Keywords harder than this (0 to 100, from the import's data source) are skipped.
  max_keyword_difficulty numeric(5, 2) not null default 40 check (max_keyword_difficulty between 0 and 100),
  -- Trigram similarity (0 to 1) above which a keyword or title counts as a duplicate.
  similarity_threshold real not null default 0.5 check (similarity_threshold between 0.2 and 0.95),
  pinterest_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.automation_settings (id) values (true) on conflict (id) do nothing;

create trigger automation_settings_updated_at
before update on public.automation_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Recipes: where a recipe came from.
-- ---------------------------------------------------------------------------
alter table public.recipes
  add column source text not null default 'manual' check (source in ('manual', 'ai')),
  add column image_source text check (image_source is null or image_source in ('upload', 'ai')),
  add column generation_job_id uuid references public.publishing_jobs (id) on delete set null,
  -- Major US food allergens the recipe contains (FDA's nine minus wheat, which a
  -- gluten-free recipe never contains). Empty array = none of them.
  add column allergens text[] not null default '{}'
    check (allergens <@ array['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'soy', 'sesame']::text[]);

-- Near-duplicate title and focus keyword detection.
create index recipes_title_core_trgm_idx on public.recipes using gin (public.keyword_core(title) extensions.gin_trgm_ops);
create index recipes_focus_keyword_core_trgm_idx on public.recipes using gin (public.keyword_core(focus_keyword) extensions.gin_trgm_ops);

-- Note: the worker always writes is_tested = false. An admin who actually cooks
-- an AI recipe can still tick it, so this is enforced in code, not here.

-- When an AI recipe goes live by any route (admin "Publish" button in review
-- mode, or publish_generated_recipe in auto mode), its keyword becomes 'used'.
create or replace function public.mark_recipe_keyword_used()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.keywords
  set status = 'used'
  where assigned_recipe_id = new.id and status <> 'used';
  return new;
end;
$$;

create trigger recipes_mark_keyword_used
after update of status on public.recipes
for each row
when (new.status = 'published' and old.status is distinct from 'published' and new.source = 'ai')
execute function public.mark_recipe_keyword_used();

-- ---------------------------------------------------------------------------
-- Keywords: priority and failure tracking.
-- ---------------------------------------------------------------------------
alter table public.keywords
  add column priority integer not null default 0 check (priority between -100 and 100),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column last_error text,
  -- Demand per unit of difficulty. Null when the import had no search volume.
  -- Unknown difficulty counts as 50 (medium) so it never outranks a known easy keyword.
  add column opportunity_score numeric generated always as (
    case when search_volume is null then null
         else round(search_volume::numeric / (10 + coalesce(keyword_difficulty, 50)), 3) end
  ) stored;

drop index if exists public.keywords_status_idx;
create index keywords_claim_idx on public.keywords (status, priority desc, opportunity_score desc nulls last, created_at);
create index keywords_core_trgm_idx on public.keywords using gin (public.keyword_core(keyword) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Publishing jobs: checkpoints so a retry resumes instead of starting over.
-- ---------------------------------------------------------------------------
alter table public.publishing_jobs
  add column mode text not null default 'review' check (mode in ('dry_run', 'review', 'auto')),
  add column trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  -- { generation_attempt_id, image_path, image_attempts, ... } written after each step
  add column checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint) = 'object'),
  add column next_retry_at timestamptz,
  add column run_url text check (run_url is null or run_url ~ '^https://'),
  add column cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  add column lease_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- Job event log (append-only).
-- ---------------------------------------------------------------------------
create table public.publishing_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.publishing_jobs (id) on delete cascade,
  step text not null check (step ~ '^[a-z_]+$'),
  status text not null check (status in ('started', 'succeeded', 'failed', 'retrying', 'skipped', 'info')),
  attempt integer not null default 1 check (attempt >= 1),
  message text check (message is null or char_length(message) <= 2000),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index publishing_job_events_job_idx on public.publishing_job_events (job_id, created_at);

-- ---------------------------------------------------------------------------
-- Generation attempts: one row per AI request, for audit and cost tracking.
-- ---------------------------------------------------------------------------
create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publishing_jobs (id) on delete cascade,
  keyword_id uuid references public.keywords (id) on delete set null,
  kind text not null check (kind in ('recipe', 'review', 'repair', 'image', 'image_check')),
  attempt integer not null default 1 check (attempt >= 1),
  provider text not null check (char_length(provider) between 2 and 40),
  model text not null check (char_length(model) between 2 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  status text not null check (status in ('succeeded', 'rejected', 'error')),
  output jsonb,             -- parsed structured output, or image metadata (never base64)
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index generation_attempts_job_idx on public.generation_attempts (job_id, created_at);

-- ---------------------------------------------------------------------------
-- Pinterest posts: room for scheduling and variants (no API calls yet).
-- ---------------------------------------------------------------------------
alter table public.pinterest_posts
  add column variant text not null default 'primary' check (variant ~ '^[a-z0-9_-]{1,40}$'),
  add column image_alt text check (image_alt is null or char_length(image_alt) <= 500),
  add column scheduled_for timestamptz;

-- ---------------------------------------------------------------------------
-- RLS and grants for the new tables. Admins read everything and may change
-- settings; only service_role (the worker) writes logs and attempts.
-- ---------------------------------------------------------------------------
alter table public.automation_settings enable row level security;
alter table public.publishing_job_events enable row level security;
alter table public.generation_attempts enable row level security;

grant select, update on public.automation_settings to authenticated;
grant select on public.publishing_job_events, public.generation_attempts to authenticated;
grant all on public.automation_settings, public.publishing_job_events, public.generation_attempts to service_role;

create policy "automation_settings: admin read"
  on public.automation_settings for select to authenticated
  using ((select public.is_admin()));

create policy "automation_settings: admin update"
  on public.automation_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "publishing_job_events: admin read"
  on public.publishing_job_events for select to authenticated
  using ((select public.is_admin()));

create policy "generation_attempts: admin read"
  on public.generation_attempts for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- find_similar_keywords(keyword): keywords already used, assigned or in
-- progress, and recipes whose focus keyword or title, are close enough to
-- compete with it in search (keyword cannibalization).
-- ---------------------------------------------------------------------------
create or replace function public.find_similar_keywords(p_keyword text, p_threshold real default 0.5, p_exclude_id uuid default null)
returns table (kind text, id uuid, text text, similarity real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select public.keyword_core(p_keyword) as k)
  select * from (
    select 'keyword'::text, kw.id, kw.keyword, extensions.similarity(public.keyword_core(kw.keyword), q.k)
    from public.keywords kw, q
    where kw.status in ('queued', 'assigned', 'used')
      and kw.id is distinct from p_exclude_id
      and extensions.similarity(public.keyword_core(kw.keyword), q.k) >= p_threshold
    union all
    select 'recipe_keyword', r.id, r.focus_keyword, extensions.similarity(public.keyword_core(r.focus_keyword), q.k)
    from public.recipes r, q
    where r.focus_keyword is not null
      and extensions.similarity(public.keyword_core(r.focus_keyword), q.k) >= p_threshold
    union all
    select 'recipe_title', r.id, r.title, extensions.similarity(public.keyword_core(r.title), q.k)
    from public.recipes r, q
    where extensions.similarity(public.keyword_core(r.title), q.k) >= p_threshold
  ) s (kind, id, text, similarity)
  order by similarity desc
  limit 10;
$$;

revoke all on function public.find_similar_keywords(text, real, uuid) from public, anon;
grant execute on function public.find_similar_keywords(text, real, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_next_keyword(job_id): replaces the Phase 1 version.
--   * order: manual priority, then opportunity (volume per difficulty), then oldest
--   * skips keywords harder than automation_settings.max_keyword_difficulty
--   * skips keywords that failed three times
--   * rejects (and skips) keywords too similar to one already covered, so two
--     articles never compete for the same search
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_keyword(p_job_id uuid)
returns public.keywords
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_settings public.automation_settings;
  v_keyword public.keywords;
  v_clash record;
  v_checked integer := 0;
begin
  select * into v_settings from public.automation_settings where id;

  loop
    select * into v_keyword
    from public.keywords
    where status = 'new'
      and assigned_recipe_id is null
      and attempt_count < 3
      and (keyword_difficulty is null or keyword_difficulty <= v_settings.max_keyword_difficulty)
    order by priority desc, opportunity_score desc nulls last, created_at
    for update skip locked
    limit 1;

    if v_keyword.id is null then
      return null;
    end if;

    select * into v_clash
    from public.find_similar_keywords(v_keyword.keyword, v_settings.similarity_threshold, v_keyword.id)
    limit 1;

    exit when v_clash.id is null;

    update public.keywords
    set status = 'rejected',
        last_error = left(format('Too similar to %s "%s" (similarity %s)', replace(v_clash.kind, '_', ' '), v_clash.text, round(v_clash.similarity::numeric, 2)), 2000)
    where id = v_keyword.id;

    v_checked := v_checked + 1;
    if v_checked >= 50 then
      return null;
    end if;
  end loop;

  update public.keywords
  set status = 'queued', attempt_count = attempt_count + 1, last_error = null
  where id = v_keyword.id
  returning * into v_keyword;

  update public.publishing_jobs set keyword_id = v_keyword.id where id = p_job_id;

  return v_keyword;
end;
$$;

revoke all on function public.claim_next_keyword(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_keyword(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- release_keyword(keyword_id, reason): puts a keyword back in the pool after a
-- failed job, or rejects it after its third failure.
-- ---------------------------------------------------------------------------
create or replace function public.release_keyword(p_keyword_id uuid, p_reason text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.keywords
  set status = case when attempt_count >= 3 then 'rejected'::public.keyword_status else 'new'::public.keyword_status end,
      last_error = left(p_reason, 2000)
  where id = p_keyword_id and status = 'queued';
$$;

revoke all on function public.release_keyword(uuid, text) from public, anon, authenticated;
grant execute on function public.release_keyword(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- find_similar_recipes(title, focus_keyword): duplicate check across ALL
-- recipes (drafts included) by trigram similarity of the core of the title or
-- focus keyword (see keyword_core).
-- ---------------------------------------------------------------------------
create or replace function public.find_similar_recipes(p_title text, p_focus_keyword text default null, p_threshold real default 0.5)
returns table (id uuid, title text, slug text, status public.recipe_status, similarity real)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.title, r.slug, r.status,
         greatest(
           extensions.similarity(public.keyword_core(r.title), public.keyword_core(p_title)),
           coalesce(extensions.similarity(public.keyword_core(r.focus_keyword), public.keyword_core(p_focus_keyword)), 0)
         ) as similarity
  from public.recipes r
  where extensions.similarity(public.keyword_core(r.title), public.keyword_core(p_title)) >= p_threshold
     or (p_focus_keyword is not null and r.focus_keyword is not null
         and extensions.similarity(public.keyword_core(r.focus_keyword), public.keyword_core(p_focus_keyword)) >= p_threshold)
  order by similarity desc
  limit 10;
$$;

revoke all on function public.find_similar_recipes(text, text, real) from public, anon, authenticated;
grant execute on function public.find_similar_recipes(text, text, real) to service_role;

-- ---------------------------------------------------------------------------
-- ai_spend(since): AI cost recorded since a moment (default: start of the UTC
-- day). The worker compares it with automation_settings.daily_budget_usd before
-- every AI call; admins see it on the dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.ai_spend(p_since timestamptz default date_trunc('day', now() at time zone 'utc') at time zone 'utc')
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0) from public.generation_attempts where created_at >= p_since;
$$;

revoke all on function public.ai_spend(timestamptz) from public, anon;
grant execute on function public.ai_spend(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- publish_generated_recipe(job_id): the only way the worker makes a recipe
-- public. In one transaction it publishes the job's recipe, marks the keyword
-- used and completes the job. If any part fails, nothing changes. Refused
-- while automation is off, in review mode, or before enough AI recipes were
-- approved by a person. The recipes_published_complete check still applies.
-- ---------------------------------------------------------------------------
create or replace function public.publish_generated_recipe(p_job_id uuid)
returns public.recipes
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_settings public.automation_settings;
  v_job public.publishing_jobs;
  v_recipe public.recipes;
  v_reviewed integer;
begin
  select * into v_settings from public.automation_settings where id;
  if not v_settings.enabled or v_settings.publish_mode <> 'auto' then
    raise exception 'automatic publishing is turned off';
  end if;

  select count(*) into v_reviewed
  from public.recipes
  where source = 'ai' and status = 'published';
  if v_reviewed < v_settings.min_reviewed_before_auto then
    raise exception 'only % of % required AI recipes have been approved by a person', v_reviewed, v_settings.min_reviewed_before_auto;
  end if;

  select * into v_job from public.publishing_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'publishing job % not found', p_job_id;
  end if;
  if v_job.status <> 'running' then
    raise exception 'publishing job % is %, not running', p_job_id, v_job.status;
  end if;
  if v_job.mode <> 'auto' then
    raise exception 'publishing job % is in % mode and cannot publish', p_job_id, v_job.mode;
  end if;
  if v_job.recipe_id is null or v_job.keyword_id is null then
    raise exception 'publishing job % has no recipe or keyword', p_job_id;
  end if;

  update public.recipes
  set status = 'published', published_at = coalesce(published_at, now())
  where id = v_job.recipe_id
    and source = 'ai'
    and generation_job_id = p_job_id
    and is_tested = false
    and status in ('draft', 'in_review')
  returning * into v_recipe;

  if v_recipe.id is null then
    raise exception 'recipe % is not an unpublished, untested AI recipe of job %', v_job.recipe_id, p_job_id;
  end if;

  update public.keywords
  set status = 'used', assigned_recipe_id = v_recipe.id, last_error = null
  where id = v_job.keyword_id;

  update public.publishing_jobs
  set status = 'succeeded', current_step = 'published', completed_at = now(), error_message = null
  where id = p_job_id;

  return v_recipe;
end;
$$;

revoke all on function public.publish_generated_recipe(uuid) from public, anon, authenticated;
grant execute on function public.publish_generated_recipe(uuid) to service_role;
