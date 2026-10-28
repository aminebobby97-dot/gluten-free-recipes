# Pinterest Pins: preparation and review

Every published recipe gets a Pinterest Pin prepared automatically and saved for you to review in **Admin → Pinterest**. **Nothing is posted to Pinterest automatically.** After you connect your Pinterest account (see [Connecting your Pinterest account](#connecting-your-pinterest-account)), you can publish a Ready Pin yourself, one at a time, with its **Publish Pin** button.

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
| Publishing | Being sent to Pinterest right now (after you clicked Publish Pin) |
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

This connects your own Pinterest Business account with the official Pinterest API v5, so the dashboard can read your boards and publish a Pin when you click **Publish Pin**. Nothing is ever posted automatically, on a schedule, or in bulk.

### What the site asks Pinterest for

| Permission | Why |
| --- | --- |
| `boards:read` | List your boards so you can choose "Gluten-Free Recipes" |
| `pins:read`, `pins:write` | Create a Pin (Pinterest requires both) |
| `boards:write` | Pinterest requires it for creating a Pin on a board. The site never creates, edits or deletes boards. |
| `user_accounts:read` | Show which Pinterest account is connected |

### How your sign-in is protected

- The Pinterest **App secret** stays in Vercel. It is only used by the server to talk to Pinterest; it never goes to the browser, the database, the logs or GitHub.
- The **access and refresh tokens** Pinterest returns are encrypted (AES-256-GCM) with `PINTEREST_TOKEN_ENCRYPTION_KEY` before they are saved in Supabase. The database only ever holds the encrypted form (it refuses anything else), and only admins can read that table. The daily automation worker has no access to it at all.
- When you click **Connect Pinterest**, the site creates a random one-time code (the OAuth "state") and keeps a signed copy in a secure cookie that expires after 10 minutes. When Pinterest sends you back, the site checks the code matches, for the same admin. Anything else is rejected (this blocks cross-site request forgery).
- Access tokens last 30 days. The site renews them automatically, server-side, when one is used within 3 days of expiring. The renewal token lasts 60 days and is extended every time it is used. If you do not use Pinterest from the dashboard for 60 days, click **Connect Pinterest** again; the dashboard warns you 14 days before.

### Trial access: what to expect

Your Pinterest app has **Trial** access. Pinterest says Pins and boards created with Trial access are **visible only to you** (like a sandbox), and Trial apps get a small number of API calls per day. So:

- Publishing a Pin works as a test, but the public will not see it until Pinterest gives your app **Standard** access (request it in Pinterest Developers, under your app).
- If Pinterest refuses a request (error 403), the Pin goes back to **Ready** and the reason is shown on it. Nothing is retried automatically.
- If Pinterest does not answer in time, the Pin goes back to **Ready** with a warning: check your Pinterest profile before publishing it again, because the Pin may have been created.

### Setup (one time)

Do these in order. **Never paste your App secret or the encryption key into a chat, an email, or the code.** They only go into Vercel.

#### Step 1: Update the database

This adds the table that holds the (encrypted) Pinterest connection. It only adds things: no recipes, Pins or security rules change.

1. Open [supabase.com](https://supabase.com), open your project, and click **SQL Editor** in the left menu.
2. Click **New query**. Paste all of `supabase/proposed/pinterest_oauth_checks/pinterest_oauth_before.sql` (also in the project files, `pinterest-oauth/` folder) and click **Run**. Write down the numbers.
3. Click **New query**. Paste all of `supabase/proposed/20261028000002_pinterest_oauth.sql` (or `pinterest_oauth_migration_sql_editor.sql` from the project files, the same SQL wrapped in one transaction) and click **Run**. You should see "Success. No rows returned". It is safe to run again.
4. Click **New query**. Paste all of `supabase/proposed/pinterest_oauth_checks/pinterest_oauth_verify.sql` and click **Run**. Every check should say **true**, and the counts should match step 2.

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
3. The status changes to **Published**, with a **View on Pinterest** link. With Trial access, only you can see the Pin.

### Disconnecting

**Admin → Pinterest → Disconnect Pinterest** deletes the saved (encrypted) sign-in from the database. Pins already on Pinterest stay there. To remove the app's access on Pinterest's side too, open Pinterest **Settings → Security and logins → Connected apps** (Pinterest's wording may vary) and remove it.

### What stays off

- Daily recipe automation (`AUTOMATION_ENABLED=false`, `automation_settings.enabled = false`).
- Automatic Pinterest publishing (`automation_settings.pinterest_enabled = false`). There is no scheduled or bulk publishing code; the worker cannot even read the Pinterest connection.
