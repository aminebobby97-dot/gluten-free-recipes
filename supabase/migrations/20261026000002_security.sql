-- Row Level Security, grants and RPC functions.
--
-- Access model
--   anon / authenticated : read categories and *published* recipes only.
--   admins               : users listed in public.admin_users; full access via RLS.
--   service_role         : bypasses RLS. Server-side only (future automation).

-- ---------------------------------------------------------------------------
-- is_admin()
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_views enable row level security;
alter table public.keywords enable row level security;
alter table public.publishing_jobs enable row level security;
alter table public.pinterest_posts enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (RLS still applies to anon and authenticated)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.categories, public.recipes, public.recipe_views to anon, authenticated;
grant insert, update, delete on public.categories, public.recipes to authenticated;
grant select, insert, update, delete on public.keywords, public.publishing_jobs, public.pinterest_posts to authenticated;
grant select on public.admin_users to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- admin_users: a signed-in user may see their own row (lets the app check membership).
create policy "admin_users: read own row"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

-- categories: public read, admin write.
create policy "categories: public read"
  on public.categories for select to anon, authenticated
  using (true);

create policy "categories: admin insert"
  on public.categories for insert to authenticated
  with check ((select public.is_admin()));

create policy "categories: admin update"
  on public.categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "categories: admin delete"
  on public.categories for delete to authenticated
  using ((select public.is_admin()));

-- recipes: the public sees only published recipes whose publish date has passed.
create policy "recipes: public read published"
  on public.recipes for select to anon, authenticated
  using (status = 'published' and published_at <= now());

create policy "recipes: admin read all"
  on public.recipes for select to authenticated
  using ((select public.is_admin()));

create policy "recipes: admin insert"
  on public.recipes for insert to authenticated
  with check ((select public.is_admin()));

create policy "recipes: admin update"
  on public.recipes for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "recipes: admin delete"
  on public.recipes for delete to authenticated
  using ((select public.is_admin()));

-- recipe_views: readable for published recipes; written only through increment_recipe_view().
create policy "recipe_views: public read for published recipes"
  on public.recipe_views for select to anon, authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.status = 'published' and r.published_at <= now()
  ));

create policy "recipe_views: admin read"
  on public.recipe_views for select to authenticated
  using ((select public.is_admin()));

-- keywords, publishing_jobs, pinterest_posts: admins only.
create policy "keywords: admin all"
  on public.keywords for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "publishing_jobs: admin all"
  on public.publishing_jobs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "pinterest_posts: admin all"
  on public.pinterest_posts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- increment_recipe_view(slug): counts a real page view of a published recipe.
-- ---------------------------------------------------------------------------
create or replace function public.increment_recipe_view(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_recipe_id uuid;
begin
  if p_slug is null or char_length(p_slug) > 200 then
    return;
  end if;

  select id into v_recipe_id
  from public.recipes
  where slug = p_slug and status = 'published' and published_at <= now();

  if v_recipe_id is null then
    return;
  end if;

  insert into public.recipe_views as rv (recipe_id, view_count, updated_at)
  values (v_recipe_id, 1, now())
  on conflict (recipe_id)
  do update set view_count = rv.view_count + 1, updated_at = now();
end;
$$;

revoke all on function public.increment_recipe_view(text) from public;
grant execute on function public.increment_recipe_view(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- search_recipes(q): full-text search over published recipes (runs with the
-- caller's privileges, so RLS still applies).
-- ---------------------------------------------------------------------------
create or replace function public.search_recipes(q text, max_results integer default 24)
returns setof public.recipes
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from public.recipes r
  where r.status = 'published'
    and r.published_at <= now()
    and char_length(btrim(coalesce(q, ''))) between 2 and 100
    and (
      to_tsvector('english', coalesce(r.title, '') || ' ' || coalesce(r.description, '') || ' ' || coalesce(r.focus_keyword, ''))
        @@ websearch_to_tsquery('english', q)
      or r.title ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  order by r.published_at desc
  limit least(greatest(coalesce(max_results, 24), 1), 50);
$$;

revoke all on function public.search_recipes(text, integer) from public;
grant execute on function public.search_recipes(text, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_next_keyword(job_id): for the future automation only. Atomically picks
-- the oldest unused keyword, marks it queued and links it to the job.
-- Not callable by anon or authenticated users.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_keyword(p_job_id uuid)
returns public.keywords
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_keyword public.keywords;
begin
  select * into v_keyword
  from public.keywords
  where status = 'new' and assigned_recipe_id is null
  order by created_at
  for update skip locked
  limit 1;

  if v_keyword.id is null then
    return null;
  end if;

  update public.keywords set status = 'queued' where id = v_keyword.id
  returning * into v_keyword;

  update public.publishing_jobs set keyword_id = v_keyword.id where id = p_job_id;

  return v_keyword;
end;
$$;

revoke all on function public.claim_next_keyword(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_keyword(uuid) to service_role;
