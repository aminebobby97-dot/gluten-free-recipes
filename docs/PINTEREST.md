# Pinterest Pins: preparation and review

Every published recipe gets a Pinterest Pin prepared automatically and saved for you to review in **Admin → Pinterest**. **Nothing is posted to Pinterest.** There is no Pinterest API connection yet, and none of this code can post.

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
| Published | Posted to Pinterest (only possible after the API is connected in a later phase) |

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

## Later: connecting the Pinterest API (not active)

Nothing below is enabled. It describes what a later phase will add, only after you approve it:

- Once Pinterest approves the API application, the official Pinterest API v5 is connected with OAuth. The tokens are stored only on the server (Vercel or GitHub secrets), never in the code or the browser.
- The code already converts a Ready Pin into the official "Create Pin" request (`toCreatePinRequest` in `src/lib/services/pinterest.ts`). `getPinterestPublisher()` deliberately throws until a real publisher is written.
- The Pinterest board ID for **Gluten-Free Recipes** is looked up once and saved.
- Publishing stays off (`automation_settings.pinterest_enabled = false`) until you turn it on. No scheduled Pinterest publishing exists.
