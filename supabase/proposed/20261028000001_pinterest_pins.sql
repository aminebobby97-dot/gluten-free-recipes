-- PROPOSED for review. NOT APPLIED. Not in supabase/migrations/, so
-- `supabase db push` ignores it. Move it there once it has been applied.
--
-- Pinterest Pin preparation. Pins are prepared and stored for review only:
-- nothing here (or in the app) sends anything to Pinterest.
--   * pin_status gains 'ready': image and text prepared, waiting for review
--   * pinterest_posts gains board name, keywords, image text and storage path,
--     prepared/edited timestamps
--   * image_url may be empty while a Pin is pending or failed
--   * at most one Pin per recipe and variant (no duplicate Pins)
--
-- Additive only: existing rows, policies and grants are unchanged. RLS on
-- pinterest_posts stays "admins only" (plus the worker's service role).

alter type public.pin_status add value if not exists 'ready' after 'pending';

alter table public.pinterest_posts
  add column if not exists board_name text not null default 'Gluten-Free Recipes'
    check (char_length(board_name) between 1 and 180),
  add column if not exists keywords text[] not null default '{}'
    check (cardinality(keywords) <= 10),
  -- The words drawn on the Pin image (normally the recipe title).
  add column if not exists image_text text
    check (image_text is null or char_length(image_text) between 1 and 120),
  -- Path of the Pin image in the recipe-images bucket, so it can be replaced.
  add column if not exists image_path text
    check (image_path is null or char_length(image_path) <= 300),
  add column if not exists prepared_at timestamptz,
  -- Set when an admin edits the Pin text; automatic re-preparation then keeps their text.
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users (id) on delete set null;

alter table public.pinterest_posts alter column image_url drop not null;

-- A Pin that is ready, publishing or published must have an image.
-- (Written without the new 'ready' value, which cannot be used in the same
-- transaction that adds it.)
alter table public.pinterest_posts
  drop constraint if exists pinterest_posts_image_when_prepared;
alter table public.pinterest_posts
  add constraint pinterest_posts_image_when_prepared check (
    publication_status in ('pending', 'failed', 'cancelled') or image_url is not null
  );

create unique index if not exists pinterest_posts_one_per_recipe
  on public.pinterest_posts (recipe_id, variant);
