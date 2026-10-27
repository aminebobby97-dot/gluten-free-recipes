# Setup and deployment

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Pick a US region if most readers are in the US.
2. Apply the migrations in `supabase/migrations/` **in filename order**. Either:
   - **Supabase CLI** (recommended):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   - **SQL editor**: open each migration file and run it, in order.

   The migrations create the tables, Row Level Security policies, database functions, the public `recipe-images` storage bucket and the eight categories.
3. Load the five example drafts by running `supabase/seed.sql` in the SQL editor (or `psql "$DATABASE_URL" -f supabase/seed.sql`). They are inserted as **drafts** and are not public.

## 2. Create your admin account

1. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up". Only accounts you create can sign in.
2. **Authentication → Users → Add user → Create new user**: enter your email and a strong password, and tick "Auto confirm user".
3. In the SQL editor, grant that user admin access:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   Signing in at `/admin/login` only works for users in `admin_users`. Remove a row to revoke access.

## 3. Environment variables

Copy `.env.example` to `.env.local` for local development. In Vercel, add the same variables under **Project Settings → Environment Variables**.

| Variable | Required | Where to find it |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Yes | Your production URL: `https://www.glutenfreerecipehub.com` (no trailing slash). Set it for Production only |
| `NEXT_PUBLIC_SITE_NAME` | Recommended | Brand name. Defaults to "Crumb & Clover" |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase → Project Settings → API Keys → publishable key (or set `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the legacy anon key) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional | Shown on Contact and Privacy pages |
| `REVALIDATE_SECRET` | For automation | 32+ random characters (`openssl rand -hex 32`). Lets the automation worker refresh recipe pages. Use the same value in GitHub |
| `SUPABASE_SECRET_KEY` | No | Not used by the website. The automation worker reads it from GitHub, see [AUTOMATION.md](AUTOMATION.md) |

The publishable key is safe in the browser because Row Level Security only lets it read categories and published recipes. The secret/service-role key bypasses RLS and is only read by `src/lib/supabase/service.ts`, which is marked `server-only`.

## 4. Deploy to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js; Node.js 20.9 or newer).
2. Add the environment variables above for **Production** (and Preview if you want previews to show data).
3. Deploy. The build reads published recipes from Supabase to prerender pages, so Supabase must be reachable during the build.
4. Add your custom domain, then make sure `NEXT_PUBLIC_SITE_URL` matches it exactly and redeploy. See [CUSTOM-DOMAIN.md](CUSTOM-DOMAIN.md).
5. In Supabase → **Authentication → URL Configuration**, set the Site URL to your production URL.
6. Submit `https://www.glutenfreerecipehub.com/sitemap.xml` in Google Search Console.

Preview deployments automatically serve a `robots.txt` that disallows crawling.

## 5. Publish your first recipe

1. Sign in at `/admin/login`.
2. Open a draft under **Recipes**, review every ingredient and step, upload a real photo (landscape, at least 1600px wide) and write its alt text.
3. Tick "This recipe has been cooked and confirmed" only if that is true; otherwise leave it unchecked (it is stored for your records and not shown on the site).
4. Check the **Publishing** panel. Publishing is blocked until required fields are complete and the gluten checks pass.
5. Click **Publish**. The page, category pages, homepage and sitemap update immediately.

To show a photo in the homepage hero, upload it (for example to the `recipe-images` bucket) and set `heroImage.src` in `src/content/site.ts`.

## 6. Run the checks

```bash
npm run check        # lint + type check + unit tests
npm run build        # production build
```

Database security tests run against any database with the migrations and seed applied (for example a local Supabase stack from `npx supabase start`, which needs Docker):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

The script runs in a transaction and rolls back, so it leaves no data behind.
