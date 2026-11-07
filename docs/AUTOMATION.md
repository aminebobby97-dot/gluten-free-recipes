# Daily AI recipes: setup guide

This guide sets up the Phase 2 automation: one AI-written gluten-free recipe a day, with a site photo, checked before anything is saved. You only need a web browser. Do the steps in order; each one says what it is for.

## How it works

A GitHub Actions workflow runs a small program (the "worker"). The worker:

1. Picks the best unused keyword from your Keywords list, skipping hard ones and ones too similar to an existing recipe. If fewer than 30 keywords are usable, it first adds new keyword ideas (see [Keyword queue and automatic top-up](#keyword-queue-and-automatic-top-up)).
2. Asks Claude (Anthropic) to write the recipe as structured data.
3. Checks it in code: gluten ingredients and cross-contact notes, allergens, ingredients used in the steps, times, oven and food-safety temperatures, SEO fields, duplicates.
4. Asks a second, independent Claude review to look for errors. Minor problems are corrected in code first (see [Cookware wording](#cookware-wording) and [Minor ingredient corrections](#minor-ingredient-corrections)). A draft that still fails gets an AI repair, and at most one more if the first repair made progress; then the run stops.
5. Asks OpenAI for one photo (landscape 3:2 for the site), and Claude checks that it matches the recipe. The Pinterest Pin is made later from this same photo, so no second AI image is paid for.
6. Saves the recipe as **In review** for you to approve, or, in Automatic mode, publishes it.
7. In Automatic mode with automatic Pins on: draws its Pinterest Pin, checks the recipe page is live, and posts the Pin to your board (see [Full automation](#full-automation-recipes-and-pins)).

Every step, AI call and cost is logged in the admin dashboard under **Publishing jobs**.

### Cookware wording

Recipes assume you cook with clean cookware suitable for gluten-free cooking. Steps say simply "Heat a clean skillet over medium heat", cast iron is treated like any other clean pan, and recipes don't carry a cookware warning by default. A cross-contact tip appears only when it really matters: shared fryers or frying oil, shared toasters, equipment dusted with wheat flour, and hard-to-clean items (wooden boards, scratched nonstick, colanders used for regular pasta, cast iron or baking stones also used for wheat foods).

Heat, preheating, searing, seasoning and wiping do **not** remove gluten, so a recipe must never say they do. Two fixes keep this from failing a whole recipe:

1. **A code check** (`src/lib/recipes/cookware.ts`) finds any sentence claiming heat or wiping removes gluten and removes that claim before the other checks run, keeping the useful part ("Preheat the pan to burn off any gluten" becomes "Preheat the pan"). It costs nothing. If it can't remove the claim cleanly, the claim blocks and goes to the usual repair round.
2. **The reviewer** marks small prose problems as *wording* issues and quotes the exact text with a corrected version. The run applies those in code and then runs every code check again, so no extra AI call is made and the repair and retry limits stay the same. Ingredient, quantity, temperature, allergen, gluten, pork and alcohol problems are never fixed this way: they still block and go through the normal repair round.

Each fix is kept as a warning on the job's attempt, so you can see what changed.

### Safety switches

Nothing is generated unless **all** of these allow it:

| Switch | Where | Now |
| --- | --- | --- |
| Schedule | `.github/workflows/daily-recipe.yml` | On: every day at 02:00 UTC (09:00 Bangkok) in automatic mode; can also be started by hand |
| `AUTOMATION_ENABLED` | GitHub variable | `false` |
| "Generate a recipe each day" | Admin → Automation | Off |
| Automatic publishing | Admin → Automation, and the database | Locked until 5 AI recipes are approved by you |
| Daily AI budget | Admin → Automation | $3.00 per day (UTC), checked before every AI call |
| "Post Pins to Pinterest automatically" | Admin → Automation | Off. Only works in Automatic mode |

A **dry run** is the exception: it works while automation is off, because it never saves a recipe. It generates and checks everything, stores the photo in a `dry-run/` folder, and logs the result.

## Pork-free and alcohol-free rule

Every AI recipe must be free from pork, pork-derived ingredients (bacon, ham, lard, pork gelatin...) and intentionally added alcohol (wine, beer, spirits, liqueurs, ordinary vanilla and other extracts...). It is enforced in four places:

1. **The writer's instructions** tell Claude never to use or mention them, in any field.
2. **A code check** (`src/lib/recipes/dietary.ts`) scans every field of each draft: title, ingredients, steps, substitutions, tips, FAQ, SEO text and the photo brief. Minor problems are corrected in code first (see [Minor ingredient corrections](#minor-ingredient-corrections)); anything else goes to the AI repair with the exact reason and a suggested compliant replacement. If the repairs still fail, the job fails like any other rejected draft (same retries and daily budget). The same check runs again right before the photo, so nothing prohibited can reach the photo, save or publish steps, even if a repair went wrong.
3. **The independent reviewer** is told to block pork, alcohol and hidden sources of them.
4. **Keywords** for pork or alcohol dishes ("bacon wrapped dates", "beer bread") are marked *rejected* without any AI call, and the next keyword is used.

Allowed: chicken, turkey or beef versions named as such ("turkey bacon", "beef gelatin"), wine and cider vinegars, and non-alcoholic substitutes named as such ("alcohol-free vanilla extract", "non-alcoholic red wine") with a note to check the label. **Soy sauce and similar condiments** (soy sauce, tamari, coconut aminos, fish sauce, oyster sauce, hoisin, miso, gochujang, teriyaki sauce, ponzu, bottled cooking sauces) are never assumed safe: in the ingredient list and in substitutions, tips and FAQ answers, the same item must say it is labeled both gluten-free and alcohol-free. Steps may refer to one only when the ingredient list has a compliant version. "Regular soy sauce" is always rejected, and XO sauce counts as pork (it contains ham).

Approving an AI draft in the admin dashboard also runs the check. Recipes that are already published are not changed.

### Minor ingredient corrections

A good recipe used to fail the whole day because of one small slip, such as "vanilla extract" left in one substitution (November 7, 2026). Problems are now sorted into three kinds:

| Kind | Examples | What happens |
| --- | --- | --- |
| **Minor, fixed in code** (no AI cost) | "vanilla extract", "pure almond extract", "vanilla bean paste"; an alcohol-free product without "labeled alcohol-free"; soy sauce or tamari without "labeled gluten-free and alcohol-free" | `src/lib/recipes/dietary-repair.ts` swaps the product for "alcohol-free vanilla flavoring" (same amount) or adds a label instruction ("choose one labeled alcohol-free", "choose one labeled gluten-free and alcohol-free"), in **every** section at once: ingredients, steps, substitutions (including the "original" side), tips, FAQ and the other text. If the ingredient list already uses a compliant vanilla (for example vanilla powder), the other sections are pointed at it. A substitution that ends up swapping an ingredient for itself is removed. The label note always tells the reader to choose a labeled product; it never says an ordinary sauce or extract is safe. |
| **Repairable by AI** | bacon, ham, pork sausage, lard, gelatin, cooking wine, beer, spirits, "regular soy sauce", or any mention in a sentence about avoiding it ("instead of vanilla extract...") | Not changed by a word swap, because that could make the recipe wrong (turkey bacon cooks differently; wine needs a different step). The AI repair gets each problem with a suggested replacement (turkey bacon labeled gluten-free, broth labeled gluten-free, tamari labeled gluten-free and alcohol-free...) and must update the whole recipe to match. |
| **Not repairable** | a near-duplicate of an existing recipe; a repair that leaves exactly the same problems | The run stops without spending more. |

After any correction, every code check and the independent review run again on the corrected recipe. Each correction is listed as a warning on the job's attempt and in the job log.

**Repair limits.** At most two AI repair rounds per run. The second round only runs when the first repair fixed something but left a different problem, the problem is not a near-duplicate, and today's budget still covers the repair, its review and a photo. The $3 daily budget, three job retries, one recipe per UTC day and the keyword top-up are unchanged.

## Keyword queue and automatic top-up

Each recipe uses one keyword. A keyword is **usable** when its status is New, it has no recipe yet, it failed fewer than 3 times, and its difficulty is unknown or within the maximum in Admin → Automation. The admin dashboard shows this number (Overview → **Usable keywords**, and the **Keyword queue** panel on the Keywords page), with the reasons the other keywords are left out.

When fewer than **30** keywords are usable, the daily run tops the queue up before it picks one:

1. It asks Claude once for 42 long-tail keyword ideas: 7 each for breakfast, lunch, dinner, desserts, snacks and baking. Claude is told what the site already covers, and that it has no search data.
2. Every idea is checked in code. It is dropped if it names pork or a pork product, alcohol, or a gluten grain (wheat, barley, rye, malt...); if it is generic ("gluten free dinner ideas"); if it does not say "gluten free"; or if it is the same as, or too similar to, any keyword you have (whatever its status) or any recipe title or focus keyword, using the same similarity limit as the keyword picker.
3. The ideas that pass become ordinary New keywords, marked "AI suggestion" in the Source column. They never get a search volume, difficulty or data source; only an import from a real keyword tool can add those.

Limits: one AI call per try, at most 2 tries per UTC day, and none after a successful top-up that day (the database enforces this too). The call is checked against the $3 daily AI budget before it is sent and its cost is logged like every other AI call (about $0.05 to $0.25). It does not change the one-recipe-per-day limit, the gluten, pork-free and alcohol-free checks on the recipe itself, or anything about Pinterest.

If the top-up fails (Claude error, budget, every idea screened out), the reason is shown on the Keywords page and in the job log. The run then goes on with the keywords that are left; if none are left, it stops before any recipe AI call with a message that says why, and the next day's run tries the top-up again. Dry runs never add keywords.

The top-up needs the database migration in [Keyword top-up migration](#keyword-top-up-migration). Until it is applied, the run skips the top-up and says so.

## What it costs

You pay Anthropic and OpenAI directly, per use. These are estimates; the real figures appear in the job log after your first dry run.

- Claude writing and review: about $0.20 to $0.50 per recipe.
- Photo: one image plus its check, about $0.10 to $0.25 per recipe. (The Pinterest Pin image is made from it at no AI cost.)
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
   | `PINTEREST_APP_ID` | Only for automatic Pins: the same value as in Vercel |
   | `PINTEREST_APP_SECRET` | Only for automatic Pins: the same value as in Vercel |
   | `PINTEREST_TOKEN_ENCRYPTION_KEY` | Only for automatic Pins: **exactly** the same value as in Vercel |

3. Under **Environment variables**, click **Add environment variable** for each:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
   | `SITE_URL` | `https://www.glutenfreerecipehub.com` (no trailing slash, not the old `vercel.app` address) |
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

## Recovering a rejected draft

A draft that fails its checks is never saved, but its text stays in the job's AI log. When the only problem is small (one sentence in the FAQ, say), you can fix that copy instead of paying for a whole new recipe:

1. Claude writes you a SQL statement for the failed job. It copies the rejected draft, changes only the wording that failed, and saves it on the job as a **corrected draft**. You run it in the Supabase SQL Editor. It refuses if the job isn't failed, has no tries left, or already has a recipe.
2. Run the workflow with mode `review`. If the job is from an earlier day, also paste its id in **resume_job_id**.
3. The corrected draft goes through **every** check again: the code checks, the duplicate checks, and the independent Claude review (one call, a few cents). Claude never rewrites or repairs it. Only the small code fixes from [Cookware wording](#cookware-wording) can apply, and they are listed as warnings.
   - If it passes, the run makes the photo and saves the recipe as **In review**. A corrected draft is never published automatically, even in auto mode.
   - If it fails, the run stops before any further AI call. Running it again costs nothing until a new correction replaces it.

The daily budget applies as usual, and each try counts toward the job's 3 tries.

## Pinterest

When a recipe is published (by you, or by the worker in automatic mode), its Pinterest Pin is prepared from the recipe's photo and saved as **Ready** in Admin → Pinterest. This uses no AI and costs nothing. A Pin problem never stops a recipe from being published; it appears as a `prepare_pin` step in the job log.

Pins of recipes you publish yourself are posted only when you click **Publish Pin**. Pins of recipes the worker publishes in Automatic mode are posted by the worker when automatic Pins are on (next section). See [PINTEREST.md](PINTEREST.md).

## Full automation: recipes and Pins

Once everything below is switched on, each day at 02:00 UTC (09:00 in Bangkok) the worker:

1. Writes and checks one recipe and its photo, exactly as in review mode (every gluten-free check, the independent AI review, the $3 daily budget, 3 tries per job).
2. Publishes it, but only if it passed every check, automation and Automatic mode are on, and at least 5 AI recipes were approved by you. The database enforces all of this again (`publish_generated_recipe`). A corrected draft is never published automatically.
3. Draws its Pin, checks the recipe page is live, refreshes the Pinterest sign-in if needed, and posts the Pin to your selected board.
4. Catches up on earlier Pins that are still waiting, and gives back the keywords of jobs that failed on an earlier day and were never finished.

### What protects against duplicates

- **Recipes:** one daily job per UTC date; the slug, similar titles and similar keywords are checked before saving; one recipe per job; only an unpublished recipe of that job can be published.
- **Pins:** one Pin per recipe (the database refuses a second); a Pin is claimed (Ready → Publishing) before it is posted, so two runs cannot post it twice; if Pinterest does not answer, the Pin stays in Publishing and is looked up on your board before it can ever be posted again.

### If something fails

| What failed | What happens |
| --- | --- |
| A recipe check | Nothing is published, no Pin is made. The job log lists each finding; the run is red |
| The daily budget | The run stops before the AI call; the run is red |
| The recipe page is not live yet | The Pin is not posted. It is tried again on the next run (3 tries in total) |
| Pinterest refuses the Pin | The Pin goes back to Ready with the reason; tried again on the next run (3 tries in total) |
| Pinterest blocks the Pin's link (for example "may lead to spam") | The Pin goes back to Ready with Pinterest's message and code, and is **not** retried automatically. The run posts no other Pins. Check the link in Pinterest (claim your website in Pinterest's settings), then publish it by hand from Admin → Pinterest |
| Pinterest does not answer | The Pin stays in Publishing; the next run (or **Check Pinterest**) looks for it on your board first |
| Pinterest sign-in expired | The recipe still publishes; its Pin waits. The run summary says to reconnect in Admin → Pinterest |

Any of these turns the run red, and GitHub emails you about failed scheduled runs. To retry the same day, run the workflow by hand with mode `auto`: the day's job resumes from where it stopped, and waiting Pins are handled.

## Keyword top-up migration

This adds the table that records each automatic keyword top-up and lets the AI log record keyword-idea calls. It only adds things and switches nothing on. Apply it **before** merging the pull request.

The files are in `supabase/proposed/keyword_replenishment/` (also in the project files, `keyword-replenishment/` folder):

| Order | File | What it does |
| --- | --- | --- |
| 0 (optional) | `keyword_queue_inspect.sql` | Read-only. Shows how many keywords are usable and why the others are left out |
| 1 | `keyword_replenishment_before.sql` | Read-only check. Changes nothing |
| 2 | `keyword_replenishment_migration_sql_editor.sql` | The update, in one transaction (all or nothing) |
| 3 | `keyword_replenishment_verify.sql` | Read-only check. Every row should say **true** |

1. Supabase → your project → **SQL Editor** → **New query**. Paste all of file 1 and click **Run**. `automation_migration_applied` must be **true**; `has_keyword_replenishments` and `attempts_allow_keywords` should be **false**.
2. **New query**. Paste all of file 2 and click **Run**. You should see "Success. No rows returned". If you see an error, nothing was changed; send it to Claude. It is safe to run again.
3. **New query**. Paste all of file 3 and click **Run**. Every row should say **true**.

### Step A: Apply the database migration

This lets the worker read and refresh the (still encrypted) Pinterest sign-in, and adds two fields to Pins. It only adds things and switches nothing on. Apply it **before** merging the pull request, because the new code saves those fields when a Pin is published.

The three files are in `supabase/proposed/automatic_pins/` (also in the project files, `automatic-pins/` folder):

| Order | File | What it does |
| --- | --- | --- |
| 1 | `automatic_pins_before.sql` | Read-only check. Changes nothing |
| 2 | `automatic_pins_migration_sql_editor.sql` | The update, in one transaction (all or nothing) |
| 3 | `automatic_pins_verify.sql` | Read-only check. Every row should say **true** |

1. Supabase → your project → **SQL Editor** → **New query**. Paste all of file 1 and click **Run**. `pinterest_connection_exists` must be **true**; the two `worker_can_...` columns and the two `has_...` columns should be **false**.
2. **New query**. Paste all of file 2 and click **Run**. You should see "Success. No rows returned". If you see an error, nothing was changed; send it to Claude. It is safe to run again.
3. **New query**. Paste all of file 3 and click **Run**. Every row should say **true**.

### Step B: Merge, and add the Pinterest secrets to GitHub

1. Merge the pull request. Vercel deploys the site in about two minutes. Nothing is switched on by merging.
2. GitHub → repository → **Settings → Environments → automation → Add environment secret**, three times, with the **same values you put in Vercel**: `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, `PINTEREST_TOKEN_ENCRYPTION_KEY`. If you no longer have them, copy them from Vercel (Settings → Environment Variables; a Sensitive value cannot be shown, so in that case create a new encryption key, put it in both places, redeploy Vercel, and click Connect Pinterest again).

### Step C: Activation checklist

Do these one at a time, in order, and check each result before the next.

1. Admin → Pinterest: status **Connected**, board **Gluten-Free Recipes** selected, sign-in not expiring.
2. Run the workflow with mode `dry_run`. Green, and nothing is saved or posted.
3. GitHub variable `AUTOMATION_ENABLED` = `true` (Settings → Environments → automation).
4. Admin → Automation: tick **Generate a recipe each day**, choose **Automatic**, tick **Post Pins to Pinterest automatically**, save. The Mode box should say **Automatic + Pins**.
5. Run the workflow by hand with mode `auto`. Check: the run summary says published, the recipe page opens on the site, the Pin is on your board and links to the recipe, and the job under **Publishing jobs** shows `verify_page` and `publish_pin` succeeded.
6. The schedule (`cron: "0 2 * * *"`) is now on. The first scheduled run happens at the next 02:00 UTC; GitHub often starts scheduled runs 5 to 30 minutes late. You can run recipes only, with **Post Pins to Pinterest automatically** unticked: their Pins wait as Ready in Admin → Pinterest. When you tick it again, each run posts up to 3 waiting Pins, oldest first.

**To stop everything at any time:** set `AUTOMATION_ENABLED` to `false`, or untick **Generate a recipe each day**. To stop only Pins, untick **Post Pins to Pinterest automatically**; recipes keep publishing and their Pins wait for you in Admin → Pinterest.

## Troubleshooting

| Message in the run | What to do |
| --- | --- |
| `Missing ANTHROPIC_API_KEY` (or another name) | The secret or variable is missing or misspelled in the `automation` environment (Step 5) |
| `Automation is turned off.` | Expected for review runs until Step 8. Use `dry_run` to test |
| `Daily AI budget reached` | Wait until tomorrow (UTC) or raise the budget in Admin → Automation |
| `No usable keywords left (...)` | The message lists what the keywords are used for and what the automatic top-up did. Import more keywords, raise the difficulty limit in Admin → Automation, or wait for the next run's top-up. The Keywords page shows the details |
| `Automatic keyword top-up did not run: ... migration is not applied` | Apply the [Keyword top-up migration](#keyword-top-up-migration) |
| `The recipe failed N check(s)` | Normal: a draft that fails is never saved. The job log lists each finding. The keyword is retried on the next run |
| `The corrected draft already failed its checks` | A corrected draft is only reviewed once. Replace it with a new correction (see Recovering a rejected draft) |
| `Site refresh failed with HTTP 401` | `REVALIDATE_SECRET` differs between Vercel and GitHub, or Vercel was not redeployed |
| OpenAI `organization must be verified` | Complete Step 3.4 |
| `Pinterest: blocked ... PINTEREST_APP_ID is not set` | Add the Pinterest secrets to GitHub (Step B) |
| `Pinterest: blocked ... cannot be read with the current PINTEREST_TOKEN_ENCRYPTION_KEY` | The key in GitHub differs from Vercel's. Copy the exact same value |
| `Pinterest: blocked ... Connect Pinterest` | Reconnect in Admin → Pinterest. Waiting Pins are posted on the next run |
| `The recipe page ... is not publicly available` | Open the page yourself. If it works, the next run posts the Pin; if not, check the Vercel deployment |
| `Load Pinterest Pin ... permission denied` | The database migration (Step A) is not applied |
