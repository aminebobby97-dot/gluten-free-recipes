# Architecture

## Rendering and caching

- Next.js 16 App Router with **Cache Components** and **Partial Prefetching** enabled (`next.config.ts`).
- Public pages read data through `src/lib/data/public.ts`. Every query runs in a `"use cache"` function with the cookie-less publishable-key client, so pages are prerendered as static HTML.
- Recipe and category pages set `ensureStatic = "navigation"`: they are fully static, generated at build time or on first request for recipes published later. Missing or unpublished recipes return a real `404`.
- Publishing services expire the `recipes` / `recipe:<slug>` / `categories` cache tags, so changes appear on the next request.
- The admin dashboard reads the session cookie, so it renders per request behind a `<Suspense>` boundary.

## Security

- **Row Level Security** on every table. The public key can read categories and published recipes only. Admin access is decided by `public.is_admin()` (membership in `admin_users`), both in the app and in the database.
- `src/proxy.ts` refreshes the Supabase session on `/admin/*` and redirects signed-out visitors. Every admin page and Server Action calls `requireAdmin()` again, close to the data.
- Admin pages are `noindex` and sent with `Cache-Control: private, no-store`.
- The only unauthenticated write endpoint is `POST /api/views`, which calls `increment_recipe_view(slug)`. That function only counts views of published recipes and cannot change content.
- There are no public publishing endpoints. The service-role client exists only for future server-side automation.

## Data model

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `categories` | Names, slugs, descriptions, landing-page intro, SEO fields | unique `slug` |
| `recipes` | Full recipe content as typed JSON columns | unique `slug`; a `published` row must have every required field (check constraint) |
| `recipe_views` | Real view counts for "Most viewed recipes" | one row per recipe |
| `keywords` | Imported keyword research | unique normalized keyword; volume and difficulty nullable (unknown, never estimated); `assigned_recipe_id` unique |
| `publishing_jobs` | One row per automation run | unique `idempotency_key`; unique (`job_type`, `job_date`); a keyword can only belong to one live or successful job |
| `pinterest_posts` | Pins and their status | unique `idempotency_key` and `pinterest_pin_id`; `published` requires a Pinterest id |
| `admin_users` | Who can use `/admin` | references `auth.users` |

## Publishing services (`src/lib/services`)

These take a Supabase client as an argument, so the admin uses the signed-in user's client (RLS applies) and future automation can pass the service-role client.

- `recipes.ts`: `createRecipeDraft`, `updateRecipe`, `publishRecipe` (validates completeness, gluten checks and claims; idempotent), `unpublishRecipe`, `deleteRecipe`.
- `keywords.ts`: CSV parsing (metrics require a named data source) and de-duplicated import.
- `jobs.ts`: `getOrCreateDailyJob` (idempotent per date), `claimJob` (optimistic lock), `recordJobStep`, `completeJob`, `failJob` (retry counting).
- `pinterest.ts`: `buildPinDraft`, `queuePin` (idempotent). `getPinterestPublisher()` deliberately throws: there is no Pinterest API client.
- `automation.ts`: the future eight-step daily flow (keyword → recipe → validation → photo → publish → pin image → pin → record) written against interfaces (`RecipeGenerator`, `ImageGenerator`, `PinterestPublisher`). It refuses to run unless `AUTOMATION_ENABLED=true`, and nothing in the app calls it: no route, cron or scheduled function exists.

## Before enabling automation (later phase)

1. Implement `RecipeGenerator` and `ImageGenerator`, and a real `PinterestPublisher` with OAuth tokens stored server-side.
2. Add an authenticated trigger (for example a Vercel Cron route that checks `CRON_SECRET`) that calls `runDailyPublishing` with the service-role client.
3. Decide on human review: the current editorial policy says a person reviews every recipe before publication.
4. Make retries resume from the recorded step instead of stopping when a job already created a recipe.
