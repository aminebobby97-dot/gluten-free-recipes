# Daily AI recipes: setup guide

This guide sets up the Phase 2 automation: one AI-written gluten-free recipe a day, with a site photo and a Pinterest photo, checked before anything is saved. You only need a web browser. Do the steps in order; each one says what it is for.

## How it works

A GitHub Actions workflow runs a small program (the "worker"). The worker:

1. Picks the best unused keyword from your Keywords list, skipping hard ones and ones too similar to an existing recipe.
2. Asks Claude (Anthropic) to write the recipe as structured data.
3. Checks it in code: gluten ingredients and cross-contact notes, allergens, ingredients used in the steps, times, oven and food-safety temperatures, SEO fields, duplicates.
4. Asks a second, independent Claude review to look for errors. A failing draft gets one repair attempt, then the run stops.
5. Asks OpenAI for two photos (landscape 3:2 for the site, portrait 2:3 for Pinterest), and Claude checks that each photo matches the recipe.
6. Saves the recipe as **In review** for you to approve (or, later, publishes it).

Every step, AI call and cost is logged in the admin dashboard under **Publishing jobs**.

### Safety switches

Nothing is generated unless **all** of these allow it:

| Switch | Where | Now |
| --- | --- | --- |
| Schedule | `.github/workflows/daily-recipe.yml` | None. Runs only when started by hand |
| `AUTOMATION_ENABLED` | GitHub variable | `false` |
| "Generate a recipe each day" | Admin → Automation | Off |
| Automatic publishing | Admin → Automation, and the database | Locked until 5 AI recipes are approved by you |
| Daily AI budget | Admin → Automation | $3.00 per day (UTC), checked before every AI call |

A **dry run** is the exception: it works while automation is off, because it never saves a recipe. It generates and checks everything, stores the photo in a `dry-run/` folder, and logs the result.

## What it costs

You pay Anthropic and OpenAI directly, per use. These are estimates; the real figures appear in the job log after your first dry run.

- Claude writing and review: about $0.20 to $0.50 per recipe.
- Photos: two images plus their checks, about $0.20 to $0.50 per recipe.
- A recipe that needs a repair or a photo retry costs more. The daily budget caps the total.

GitHub Actions is free for this amount of use (a run takes a few minutes).

---

## Step 1: Make the GitHub repository private

Your repository is currently **public**, so anyone can read the code. No keys are stored in it, but private is safer.

1. Open the repository on GitHub and click **Settings** (top right of the repository, not your profile).
2. Scroll to the bottom, **Danger Zone** → **Change repository visibility** → **Change to private**, and confirm.
3. Vercel keeps deploying normally after this.

## Step 2: Get an Anthropic API key (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in or create an account.
2. **Settings → Billing**: add a payment method and buy a small amount of credit (for example $10).
3. Under **Settings → Limits** (if your account shows it), set a monthly spend limit you are comfortable with, for example $40. This is a second safety net on top of the daily budget.
4. **Settings → API Keys → Create Key**. Name it `gluten-free-recipes-automation`. Copy the key now: it is shown only once. Keep it somewhere private until Step 5.

## Step 3: Get an OpenAI API key (photos)

1. Go to [platform.openai.com](https://platform.openai.com) and sign in or create an account.
2. **Settings → Billing**: add a payment method and credit (for example $10).
3. Under **Settings → Limits** (if shown), set a monthly budget, for example $30.
4. OpenAI may ask you to verify your organization before its image models work. If **Settings → General** shows a **Verify Organization** button, complete it (it can take a few minutes).
5. **API keys → Create new secret key**. Name it `gluten-free-recipes-photos`. Copy it; it is shown only once.

## Step 4: Create the refresh secret in Vercel

This lets the worker tell the website to refresh a recipe page after publishing.

1. Create a random value of at least 32 characters. On a Mac, open Terminal and run `openssl rand -hex 32`, then copy the result. Or use a password manager to generate a 40-character password with letters and digits only.
2. In Vercel: your project → **Settings → Environment Variables** → add `REVALIDATE_SECRET` with that value, for **Production** and **Preview**. Save.
3. **Deployments** → the latest production deployment → **⋯ → Redeploy**, so the site picks it up.

## Step 5: Add the secrets to GitHub

GitHub keeps these encrypted and only gives them to the workflow. They never appear in the website code.

1. Repository → **Settings → Environments → New environment**. Name it exactly `automation` and click **Configure environment**.
2. Under **Environment secrets**, click **Add environment secret** for each:

   | Name | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | The key from Step 2 |
   | `OPENAI_API_KEY` | The key from Step 3 |
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **secret** key (or the legacy `service_role` key) |
   | `REVALIDATE_SECRET` | The same value as in Step 4 |

3. Under **Environment variables**, click **Add environment variable** for each:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
   | `SITE_URL` | Your live site, for example `https://www.yourdomain.com` (no trailing slash) |
   | `AUTOMATION_ENABLED` | `false` |

## Step 6: Apply the database migration (done)

Done on 2026-10-26: the migration `supabase/migrations/20261027000001_phase2_automation.sql` was reviewed, approved and applied in the Supabase SQL Editor. It leaves automation switched off.

## Step 7: First test (dry run)

1. Repository → **Actions** → **Daily recipe** (left list) → **Run workflow**.
2. Leave **mode** on `dry_run`. Optionally type a keyword to try. Click **Run workflow**.
3. Wait a few minutes. A green check means the recipe and photos passed every check; the run's summary shows the photo link.
4. In the admin dashboard, **Publishing jobs** → open the dry run to see each step, every AI call, its findings and its cost.

Nothing is saved as a recipe and no keyword is used.

## Step 8: Review mode (first 5 recipes, after activation is approved)

When you approve activation:

1. Set the GitHub variable `AUTOMATION_ENABLED` to `true` (Settings → Environments → automation).
2. Admin → **Automation** → tick **Generate a recipe each day**, keep **Review**, save.
3. Run the workflow with mode `review`. The recipe appears under **Recipes → In review**.
4. Open it, read it as a cook would, fix anything, and click **Publish**. Each published AI recipe counts as one approval.

After 5 approvals you can choose **Automatic** in Admin → Automation, and the daily schedule can be switched on in the workflow.

## Pinterest

The Pinterest image is already generated and saved with each recipe, but nothing is posted to Pinterest. Posting will be added after your Pinterest Business account and API access are ready.

## Troubleshooting

| Message in the run | What to do |
| --- | --- |
| `Missing ANTHROPIC_API_KEY` (or another name) | The secret or variable is missing or misspelled in the `automation` environment (Step 5) |
| `Automation is turned off.` | Expected for review runs until Step 8. Use `dry_run` to test |
| `Daily AI budget reached` | Wait until tomorrow (UTC) or raise the budget in Admin → Automation |
| `No usable keywords left` | Import more keywords, or raise the difficulty limit in Admin → Automation |
| `The recipe failed N check(s)` | Normal: a draft that fails is never saved. The job log lists each finding. The keyword is retried on the next run |
| `Site refresh failed with HTTP 401` | `REVALIDATE_SECRET` differs between Vercel and GitHub, or Vercel was not redeployed |
| OpenAI `organization must be verified` | Complete Step 3.4 |
