# Moving to www.glutenfreerecipehub.com

The site now lives at **https://www.glutenfreerecipehub.com**. The old address,
**https://gluten-free-recipes.vercel.app**, keeps working until you finish Step 5.

Every absolute URL the site prints (canonical tags, sitemap, robots.txt, recipe
JSON-LD, Open Graph and Twitter tags, Pinterest "Save" links) is built from one
setting, `NEXT_PUBLIC_SITE_URL`. The automation worker uses `SITE_URL` to refresh
pages after it publishes. No code holds the old `vercel.app` address, and a test
fails if one is added. Recipe slugs and page paths do not change.

Nothing below touches API keys, secrets, the database or the automation switches.

## Step 1: Point the site at the new domain (Vercel)

`NEXT_PUBLIC_SITE_URL` is baked into the site when it is built, so you change it
and then redeploy.

1. Open [vercel.com](https://vercel.com), sign in and click the **gluten-free-recipes** project.
2. Click **Settings** (top bar), then **Environment Variables** (left menu).
3. Find `NEXT_PUBLIC_SITE_URL`.
   - If it exists: click the **⋯** menu on its row, then **Edit**.
   - If it does not: fill in the form at the top of the page instead.
4. Set the value to exactly this (with `www`, no slash at the end):
   ```
   https://www.glutenfreerecipehub.com
   ```
5. Under **Environments**, tick **Production** only, then click **Save**.
   (Previews are kept out of search engines anyway, so they do not need it.)
6. Leave every other variable as it is.
7. Redeploy so the new value is used: click **Deployments** (top bar), find the
   newest deployment marked **Production**, click its **⋯** menu, choose
   **Redeploy**, and confirm. Wait for it to show **Ready** (a few minutes).

If the variable is ever missing, production builds now fall back to
`https://www.glutenfreerecipehub.com` instead of `localhost`.

## Step 2: Point the automation worker at the new domain (GitHub)

Only needed once you have created the `automation` environment
(see [AUTOMATION.md](AUTOMATION.md), Step 5). Automation stays switched off.

1. On GitHub, open the repository, then **Settings → Environments → automation**.
2. Under **Environment variables**, find `SITE_URL` (or click **Add environment variable**).
3. Set it to `https://www.glutenfreerecipehub.com` and save.
4. Do not change `AUTOMATION_ENABLED` (it stays `false`) or any secret.

Do this before Step 5. Once the old domain redirects, a worker still pointed at it
stops with "Site refresh was redirected … Set SITE_URL to the site's primary domain"
instead of refreshing pages.

## Step 3 (optional): Supabase sign-in settings

The admin login uses email and password, so this only matters for emails Supabase
sends (for example a password reset).

1. Supabase dashboard → your project → **Authentication → URL Configuration**.
2. Set **Site URL** to `https://www.glutenfreerecipehub.com` and click **Save**.
3. Under **Redirect URLs**, add `https://www.glutenfreerecipehub.com/**`. Keep the old
   `vercel.app` entry until Step 5 is done.

## Step 4: Check the new domain

Open each link in your browser after the redeploy:

1. https://www.glutenfreerecipehub.com/robots.txt: the last line should be
   `Sitemap: https://www.glutenfreerecipehub.com/sitemap.xml`.
2. https://www.glutenfreerecipehub.com/sitemap.xml: every `<loc>` address should
   start with `https://www.glutenfreerecipehub.com/`.
3. Open any published recipe, right-click the page and choose **View Page Source**.
   Press Ctrl+F (Cmd+F on a Mac) and search for:
   - `canonical`: it should point to `https://www.glutenfreerecipehub.com/recipes/…`
   - `og:url`: the same address
   - `vercel.app`: there should be **no** results
4. Paste the recipe's address into Google's
   [Rich Results Test](https://search.google.com/test/rich-results). It should find
   a valid **Recipe** with the new domain in its URL.
5. Click the recipe's Pinterest **Save** button. The pin builder should show the
   new domain as the link. Close it without saving if you don't want the pin.
6. Open https://glutenfreerecipehub.com (without `www`). It should land on the
   `www` address. If not: Vercel → **Settings → Domains**, click **Edit** on
   `glutenfreerecipehub.com`, choose **Redirect to** `www.glutenfreerecipehub.com`
   with **308 Permanent Redirect**, and save.

Optional read-only check that no saved recipe text links to the old domain. In the
Supabase **SQL Editor**, run (it only reads, it changes nothing):

```sql
select 'recipe' as kind, slug from public.recipes r where r::text ilike '%vercel.app%'
union all
select 'category', slug from public.categories c where c::text ilike '%vercel.app%'
union all
select 'pin', id::text from public.pinterest_posts p where p::text ilike '%vercel.app%';
```

No rows means nothing to fix. If rows come back, send them to Claude rather than
editing them by hand.

## Step 5: Redirect the old address (after Step 4 passes)

Pages on the old address already tell search engines the new address is the real
one (their canonical tags point there). When everything in Step 4 looks right:

1. Vercel → the project → **Settings → Domains**.
2. Find `gluten-free-recipes.vercel.app` and click **Edit**.
3. Choose **Redirect to**, pick `www.glutenfreerecipehub.com`, choose
   **308 Permanent Redirect**, and click **Save**.
4. Check: open https://gluten-free-recipes.vercel.app/sitemap.xml. It should land
   on https://www.glutenfreerecipehub.com/sitemap.xml.

If Vercel does not offer **Redirect to** for the `vercel.app` address, ask Claude
to add the redirect in code instead. Undo at any time by editing the domain again
and choosing **No redirect**.

## Step 6: Tell Google

1. In [Google Search Console](https://search.google.com/search-console), add the
   property `https://www.glutenfreerecipehub.com` (or a Domain property for
   `glutenfreerecipehub.com`) and verify it.
2. **Sitemaps** → submit `https://www.glutenfreerecipehub.com/sitemap.xml`.
3. If you had added the old `vercel.app` address as a property, you can leave it;
   Google follows the redirect and canonicals on its own.
