-- Core schema for the gluten-free recipe site.
-- Tables: categories, recipes, recipe_views, keywords, publishing_jobs,
-- pinterest_posts, admin_users.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.recipe_status as enum ('draft', 'in_review', 'published', 'archived');
create type public.keyword_status as enum ('new', 'queued', 'assigned', 'used', 'rejected');
create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');
create type public.pin_status as enum ('pending', 'publishing', 'published', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin users (who may use /admin). Rows are added manually by the owner.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  short_name text not null check (char_length(short_name) between 2 and 40),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  introduction text not null default '',
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  image_url text,
  image_alt text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 140),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> 'page'),
  description text not null default '',
  introduction text not null default '',
  category_id uuid references public.categories (id) on delete restrict,

  -- [{ group?, amount, unit?, name, note?, metric? }]
  ingredients jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array'),
  -- [{ group?, text }]
  instructions jsonb not null default '[]'::jsonb check (jsonb_typeof(instructions) = 'array'),

  prep_time integer check (prep_time is null or prep_time between 0 and 2880),   -- minutes
  cook_time integer check (cook_time is null or cook_time between 0 and 2880),   -- minutes
  servings integer check (servings is null or servings between 1 and 200),
  yield_description text,

  -- { per, calories?, protein_g?, ..., is_estimate, method? } or null when unknown
  nutrition jsonb check (nutrition is null or jsonb_typeof(nutrition) = 'object'),
  tips jsonb not null default '[]'::jsonb check (jsonb_typeof(tips) = 'array'),
  -- [{ original, substitute, note? }]
  substitutions jsonb not null default '[]'::jsonb check (jsonb_typeof(substitutions) = 'array'),
  storage_instructions text not null default '',
  -- [{ question, answer }]
  faq jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array'),

  featured_image text,
  featured_image_alt text,
  pinterest_image text,
  pinterest_image_alt text,

  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  focus_keyword text,

  -- True only after a person has actually cooked the recipe and confirmed it works.
  is_tested boolean not null default false,

  status public.recipe_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A published recipe must be complete. The application performs richer
  -- validation (gluten checks, etc.); this is the last line of defence.
  constraint recipes_published_complete check (
    status <> 'published' or (
      published_at is not null
      and category_id is not null
      and featured_image is not null
      and featured_image_alt is not null
      and char_length(description) > 0
      and char_length(introduction) > 0
      and jsonb_array_length(ingredients) > 0
      and jsonb_array_length(instructions) > 0
      and prep_time is not null
      and cook_time is not null
      and servings is not null
    )
  )
);

create index recipes_status_published_idx on public.recipes (status, published_at desc);
create index recipes_category_published_idx on public.recipes (category_id, status, published_at desc);
create index recipes_search_idx on public.recipes using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(focus_keyword, ''))
);

create trigger recipes_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Recipe views (real page-view counts that power "Popular recipes")
-- ---------------------------------------------------------------------------
create table public.recipe_views (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  view_count bigint not null default 0 check (view_count >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Keywords (imported research; metrics are nullable and never invented)
-- ---------------------------------------------------------------------------
create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null check (char_length(keyword) between 2 and 200),
  normalized_keyword text generated always as (lower(btrim(regexp_replace(keyword, '\s+', ' ', 'g')))) stored,
  category_id uuid references public.categories (id) on delete set null,
  -- Null means "unknown". Only store values that came from a real data source.
  search_volume integer check (search_volume is null or search_volume >= 0),
  keyword_difficulty numeric(5, 2) check (keyword_difficulty is null or keyword_difficulty between 0 and 100),
  data_source text,
  status public.keyword_status not null default 'new',
  assigned_recipe_id uuid unique references public.recipes (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keywords_normalized_unique unique (normalized_keyword)
);

create index keywords_status_idx on public.keywords (status, created_at);

create trigger keywords_updated_at
before update on public.keywords
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Publishing jobs (one row per automation run; idempotent per day)
-- ---------------------------------------------------------------------------
create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.recipes (id) on delete set null,
  keyword_id uuid references public.keywords (id) on delete set null,
  job_type text not null default 'daily_recipe' check (job_type ~ '^[a-z_]+$'),
  job_date date not null,
  idempotency_key text not null unique,
  status public.job_status not null default 'pending',
  current_step text,
  error_message text,
  retry_count integer not null default 0 check (retry_count >= 0),
  started_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint publishing_jobs_one_per_day unique (job_type, job_date)
);

-- A keyword can only be consumed by one live or successful job.
create unique index publishing_jobs_keyword_active_idx
  on public.publishing_jobs (keyword_id)
  where keyword_id is not null and status in ('pending', 'running', 'succeeded');

create index publishing_jobs_status_idx on public.publishing_jobs (status, job_date desc);

create trigger publishing_jobs_updated_at
before update on public.publishing_jobs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pinterest posts
-- ---------------------------------------------------------------------------
create table public.pinterest_posts (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  publishing_job_id uuid references public.publishing_jobs (id) on delete set null,
  pin_title text not null check (char_length(pin_title) between 1 and 100),
  pin_description text not null default '' check (char_length(pin_description) <= 500),
  image_url text not null,
  destination_url text not null check (destination_url ~ '^https://'),
  board_id text,
  pinterest_pin_id text unique,
  idempotency_key text not null unique,
  publication_status public.pin_status not null default 'pending',
  error_message text,
  retry_count integer not null default 0 check (retry_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pinterest_posts_published_has_id check (
    publication_status <> 'published' or (pinterest_pin_id is not null and published_at is not null)
  )
);

create index pinterest_posts_status_idx on public.pinterest_posts (publication_status, created_at desc);
create index pinterest_posts_recipe_idx on public.pinterest_posts (recipe_id);

create trigger pinterest_posts_updated_at
before update on public.pinterest_posts
for each row execute function public.set_updated_at();
