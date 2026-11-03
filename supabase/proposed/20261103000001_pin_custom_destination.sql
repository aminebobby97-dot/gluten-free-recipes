-- PROPOSED for review. NOT APPLIED. Not in supabase/migrations/, so
-- `supabase db push` ignores it. Move it there once it has been applied.
--
-- Custom destination URL for Pinterest Pins (for example a Bitly link an admin
-- made by hand).
--   * pinterest_posts gains
--       custom_destination_url     the admin's own https:// link; when set, the
--                                  Pin links there instead of destination_url
--       custom_destination_set_at  when it was saved
--       custom_destination_set_by  which admin saved it
--     destination_url stays the recipe's own page and is still kept up to date
--     by Pin preparation; the custom link is never touched by it.
--   * A trigger makes sure only a signed-in admin can change the custom link:
--     the daily worker (service_role) and visitors cannot, and nobody can
--     change it once the Pin is publishing, published or cancelled.
--
-- Additive only and safe to run twice: no DROP, no existing column, row,
-- policy or setting changes. Existing Pins keep linking to their recipe page.

alter table public.pinterest_posts
  add column if not exists custom_destination_url text,
  add column if not exists custom_destination_set_at timestamptz,
  add column if not exists custom_destination_set_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pinterest_posts_custom_destination_https') then
    alter table public.pinterest_posts
      add constraint pinterest_posts_custom_destination_https check (
        custom_destination_url is null
        or (custom_destination_url ~ '^https://[^[:space:]]+$' and char_length(custom_destination_url) <= 2048)
      );
  end if;
end $$;

create or replace function public.pinterest_posts_guard_custom_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.custom_destination_url is not null and current_user in ('service_role', 'anon') then
      raise exception 'Only an admin can set a Pin''s custom destination URL.' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.custom_destination_url, new.custom_destination_set_at, new.custom_destination_set_by)
     is distinct from (old.custom_destination_url, old.custom_destination_set_at, old.custom_destination_set_by) then
    if current_user in ('service_role', 'anon') then
      raise exception 'Only an admin can change a Pin''s custom destination URL.' using errcode = 'insufficient_privilege';
    end if;
    if old.publication_status in ('publishing', 'published', 'cancelled') then
      raise exception 'The destination URL of a % Pin cannot be changed.', old.publication_status using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'pinterest_posts_guard_custom_destination' and tgrelid = 'public.pinterest_posts'::regclass) then
    create trigger pinterest_posts_guard_custom_destination
    before insert or update on public.pinterest_posts
    for each row execute function public.pinterest_posts_guard_custom_destination();
  end if;
end $$;
