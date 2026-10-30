# Pinterest Pins: preparation and review

Every published recipe gets a Pinterest Pin prepared automatically and saved in **Admin → Pinterest**. After you connect your Pinterest account (see [Connecting your Pinterest account](#connecting-your-pinterest-account)), a Ready Pin is posted in one of two ways:

- **By you:** open it and click **Publish Pin**. This is how Pins of recipes you publish yourself are posted.
- **By the daily run:** for recipes the daily run publishes in Automatic mode, when **Post Pins to Pinterest automatically** is on in Admin → Automation. The run posts the Pin only after the recipe page is confirmed live. See [Automatic Pins](#automatic-pins).

## How it works

When a recipe is published, either by you clicking **Publish** in the admin or by the daily worker in automatic mode:

1. **Image.** The recipe's own photo (the featured image, or the Pinterest image if there is no featured image) is cropped to the top of a 1000 × 1500 image. The recipe title is set below it in the site's fonts, with a small "Gluten-free · Category" label, the time and servings, and a small "Gluten Free Recipe Hub" line at the bottom. The photo is only cropped, never changed, so the Pin always shows the real dish. No AI image is generated, so this costs nothing.
2. **Text.** The Pin title (100 characters max), description (500 max), keywords and alt text are written from the recipe's own title, description, focus keyword, time and servings. This uses no AI, costs nothing, and only repeats what the recipe page says, so it never claims a recipe was tested.
3. **Saved.** Everything is stored in the `pinterest_posts` table with the destination URL (`https://www.glutenfreerecipehub.com/recipes/<slug>`) and the board **Gluten-Free Recipes**. The image is stored in Supabase Storage under `recipe-images/pins/`.
4. **Ready for review.** The Pin's status becomes **Ready**.

It is safe to repeat: each recipe has at most one Pin (the database refuses a second one), an unchanged Pin is left alone, text you edited is kept, and a published Pin is never touched. If something goes wrong (for example, the recipe has no photo), the Pin is marked **Failed** with the reason. The recipe stays published either way, and you can click **Retry**.

### Statuses

| Status | Meaning |
| --- | --- |
| Pending | Being prepared |
| Ready | Image and text prepared, waiting for your review |
| Failed | Could not be prepared; the reason is shown on the Pin |
| Publishing | Being sent to Pinterest right now, or the last attempt got no answer (see [When Pinterest does not answer](#when-pinterest-does-not-answer)) |
| Published | Posted to Pinterest; the Pin page links to it |

## Setup (one time)

Do these in order. The website keeps working normally between steps.

### Step 1: Update the database

This adds the "Ready" status, the new Pin fields and the duplicate protection. It only adds things: no existing data, security rules or recipes change.

1. Open [supabase.com](https://supabase.com), open your project, and click **SQL Editor** in the left menu.
2. Click **New query**. Open `supabase/proposed/pinterest_checks/pinterest_before.sql` (also in the project files, `pinterest/` folder), copy all of it, paste it, and click **Run**. Write down the numbers. `duplicate_pins` must be **0**.
3. Click **New query** again. Paste all of `supabase/proposed/20261028000001_pinterest_pins.sql` (or `pinterest_migration_sql_editor.sql` from the project files, the same SQL wrapped in one transaction) and click **Run**. You should see "Success. No rows returned". If you see an error, copy it and send it to Claude. The file is safe to run again: it skips anything already added.
4. Click **New query** again. Paste all of `supabase/proposed/pinterest_checks/pinterest_verify.sql` and click **Run**. Every row should say **true**, and the counts should match step 2.
5. Tell Claude it is applied, so the migration file can be moved into `supabase/migrations/`.

### Step 2: Merge the pull request

After the database is updated, merge the pull request on GitHub. Vercel deploys it automatically, in about two minutes.

(If the code goes live before the database update, publishing still works. The Pinterest page shows a message asking you to run the migration.)

### Step 3: Prepare Pins for recipes that are already published

1. Open **Admin → Pinterest**.
2. If some published recipes have no Pin yet, click **Prepare missing Pins**. It prepares up to 10 at a time; click again until the button disappears.

## Reviewing and editing a Pin

1. Open **Admin → Pinterest**. Use the **Ready for review** tab to see the Pins waiting for you.
2. Click a Pin to open it. You can change:
   - **Pin title** and **Description** (Pinterest's limits are enforced).
   - **Keywords**, separated by commas. These are for your reference; they are not added as hashtags.
   - **Text on the image**. Saving a change redraws the image.
   - **Image alt text** and **Board**.
3. Click **Save Pin**. Wording the site does not allow (for example "we tested this" or "100% safe for celiacs") is refused, with an explanation.
4. **Redraw image** makes the image again from the recipe's current photo. If you change the recipe's photo, click this afterwards.
5. **Rebuild text from the recipe** discards your edits and writes the text again from the recipe.

The destination URL is always the recipe's page on the live site. It updates automatically if the recipe's address changes.

## Connecting your Pinterest account

This connects your own Pinterest Business account with the official Pinterest API v5, so the dashboard can read your boards and publish a Pin when you click **Publish Pin**, and the daily run can post the Pins of recipes it publishes automatically (only when you switch that on). Nothing is ever posted in bulk.

### What the site asks Pinterest for

| Permission | Why |
| --- | --- |
| `boards:read` | List your boards so you can choose "Gluten-Free Recipes" |
| `pins:read`, `pins:write` | Create a Pin (Pinterest requires both) |
| `boards:write` | Pinterest requires it for creating a Pin on a board. The site never creates, edits or deletes boards. |
| `user_accounts:read` | Show which Pinterest account is connected |

### How your sign-in is protected

- The Pinterest **App secret** is kept in Vercel and, for automatic Pins, as an encrypted secret in the GitHub `automation` environment. It is only used by server code to talk to Pinterest; it never goes to the browser, the database or the logs.
- The **access and refresh tokens** Pinterest returns are encrypted (AES-256-GCM) with `PINTEREST_TOKEN_ENCRYPTION_KEY` before they are saved in Supabase. The database only ever holds the encrypted form (it refuses anything else). Admins can read that table; after the automatic Pins migration, the daily worker can read and refresh it too, but cannot create or delete it. Visitors have no access.
- When you click **Connect Pinterest**, the site creates a random one-time code (the OAuth "state") and keeps a signed copy in a secure cookie that expires after 10 minutes. When Pinterest sends you back, the site checks the code matches, for the same admin. Anything else is rejected (this blocks cross-site request forgery).
- Access tokens last 30 days. The site renews them automatically, server-side, when one is used within 3 days of expiring. The renewal token lasts 60 days and is extended every time it is used. With automatic Pins on, the daily run checks the sign-in every day and renews it when needed, so it stays alive. If it is ever unused for 60 days, or Pinterest rejects it, click **Connect Pinterest** again; the dashboard warns you 14 days before, and the daily run's summary says "Reconnect Pinterest".

### Trial and Standard access

With **Trial** access, Pins are visible only to you and Pinterest allows few API calls a day. With **Standard** access (approved for this app in October 2026), Pins are public.

- If Pinterest refuses a request (for example error 403), the Pin goes back to **Ready** and the reason is shown on it.

### When Pinterest does not answer

If Pinterest times out or has a server error while a Pin is being posted, the Pin may or may not have been created. To make sure it is never posted twice, the Pin **stays in Publishing** with a warning, and nothing posts it again until it has been looked up:

- Click **Check Pinterest** on the Pin's page, or let the next daily run do it. Either one looks through the newest Pins on your board for one linking to the recipe.
- Found: the Pin is saved as **Published** with its Pinterest id.
- Not found 10 minutes or more after the attempt: the Pin goes back to **Ready**, and it is safe to publish again.
- Not found sooner: nothing changes; check again a little later.

## Automatic Pins

When the daily run publishes a recipe in Automatic mode and **Post Pins to Pinterest automatically** is on (Admin → Automation), the same run:

1. Draws the Pin from the recipe photo (as above).
2. Opens the recipe page on the live site and checks that it answers normally (HTTP 200, at its own address, with the recipe's data). It tries 4 times, 15 seconds apart. If the page is not live, the Pin is **not** posted.
3. Refreshes the Pinterest sign-in if it expires within 3 days.
4. Posts the Pin to the board you chose, with Pinterest's AI label when the photo was made with AI, linking to the recipe page.

Each run also catches up: Pins of earlier automatic recipes that are still Ready, Failed or waiting in Publishing are handled first, up to 3 Pins per run. Each Pin gets at most **3 tries**; after that it waits in Admin → Pinterest for you, with the reason. Pins of recipes you published yourself are never posted automatically. Every step is logged on the recipe's job under **Publishing jobs**, and a Pin that was not posted turns the run red so GitHub emails you.

Setup and activation are in [AUTOMATION.md](AUTOMATION.md#full-automation-recipes-and-pins).

### Setup (one time)

Do these in order. **Never paste your App secret or the encryption key into a chat, an email, or the code.** They only go into Vercel.

#### Step 1: Update the database

This adds the table that holds the (encrypted) Pinterest connection. It only adds things: no recipes, Pins or security rules change.

The three files are in the repository folder `supabase/proposed/pinterest_oauth/`:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/proposed/pinterest_oauth/pinterest_oauth_before.sql` | Read-only check (SELECT only). Changes nothing. |
| 2 | `supabase/proposed/pinterest_oauth/pinterest_oauth_migration_sql_editor.sql` | The database update, in one transaction (all or nothing). |
| 3 | `supabase/proposed/pinterest_oauth/pinterest_oauth_verify.sql` | Read-only check (SELECT only). Changes nothing. |

To open one on GitHub: go to the repository, open the `supabase` folder, then `proposed`, then `pinterest_oauth`, click the file, and use the **Copy raw file** button (two overlapping squares, top right of the file).

1. Open [supabase.com](https://supabase.com), open your project, and click **SQL Editor** in the left menu.
2. Click **New query**. Paste all of **file 1** and click **Run**. Write down the numbers (published recipes, Pins, Ready Pins).
3. Click **New query**. Paste all of **file 2** and click **Run**. You should see "Success. No rows returned". If you see an error, nothing was changed; copy the error and send it to Claude. It is safe to run again.
4. Click **New query**. Paste all of **file 3** and click **Run**. Every check should say **true**, and the counts should match step 2.

(`supabase/proposed/20261028000002_pinterest_oauth.sql` is the same SQL without the transaction wrapper. It is the copy that moves into `supabase/migrations/` after you have applied it; you do not need to run it separately.)

#### Step 2: Find your App ID and App secret

1. Go to [developers.pinterest.com](https://developers.pinterest.com), sign in, and click **My apps**.
2. Open your app. The **App ID** is a number. The **App secret key** is hidden; click **Show** to see it. Keep this tab open for the next step.
3. Check the **Redirect URIs** list contains exactly `https://www.glutenfreerecipehub.com/api/pinterest/callback` (with `www`, no slash at the end).

#### Step 3: Create an encryption key

You need 32 random bytes, written as text. Run one of these on your own computer and copy the result (a line of about 44 characters):

- **Mac or Linux** (Terminal): `openssl rand -base64 32`
- **Windows** (PowerShell): `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`

Keep a copy in your password manager. If you lose or change it, the site cannot read the saved Pinterest sign-in, and you simply click **Connect Pinterest** again.

#### Step 4: Add the environment variables in Vercel

1. Open [vercel.com](https://vercel.com), open the project, then **Settings → Environment Variables**.
2. Add each of these, for the **Production** environment only. Mark the secret ones as **Sensitive** if Vercel offers it.

| Name | Value | Secret? |
| --- | --- | --- |
| `PINTEREST_APP_ID` | The App ID from step 2 | No, but keep it private |
| `PINTEREST_APP_SECRET` | The App secret key from step 2 | **Yes** |
| `PINTEREST_TOKEN_ENCRYPTION_KEY` | The value from step 3 | **Yes** |
| `PINTEREST_REDIRECT_URI` | Optional. Leave it out; the default is `https://www.glutenfreerecipehub.com/api/pinterest/callback` | No |

3. Do **not** add the `NEXT_PUBLIC_` prefix to any of them (that would send them to the browser).
4. Redeploy: **Deployments**, the latest production deployment, **⋯ → Redeploy**. Environment variables only take effect after a new deployment.

#### Step 5: Merge the pull request

After the database is updated and the variables are set, merge the pull request on GitHub. Vercel deploys it in about two minutes.

#### Step 6: Connect

1. Open **https://www.glutenfreerecipehub.com/admin/pinterest** (exactly this address, with `www`, so Pinterest returns you to the same site) and sign in.
2. In **Pinterest account**, click **Connect Pinterest**.
3. Pinterest asks you to sign in (use your Pinterest **Business** account) and shows what the site will be allowed to do. Click **Give access**.
4. You come back to the dashboard and see **Connected**, your account name, the sign-in status and your boards.
5. Under **Board**, choose **Gluten-Free Recipes** and click **Use this board**.

#### Step 7: Publish one Pin as a test

1. Open a Pin with status **Ready**.
2. In **Publish to Pinterest**, read the Pin once more. Tick the AI label box if the photo was made with AI (it is ticked automatically for AI photos). Tick **I checked this Pin…** and click **Publish Pin**.
3. The status changes to **Published**, with a **View on Pinterest** link.

### Disconnecting

**Admin → Pinterest → Disconnect Pinterest** deletes the saved (encrypted) sign-in from the database. Pins already on Pinterest stay there. To remove the app's access on Pinterest's side too, open Pinterest **Settings → Security and logins → Connected apps** (Pinterest's wording may vary) and remove it.

### What stays off until you switch it on

- Daily recipe automation (`AUTOMATION_ENABLED=false`, `automation_settings.enabled = false`).
- Automatic Pinterest publishing (`automation_settings.pinterest_enabled = false`, the **Post Pins to Pinterest automatically** box). There is no bulk publishing.
