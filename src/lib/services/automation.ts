// Architecture for the future daily publishing automation. NOT ACTIVE.
//
// Nothing in the app calls runDailyPublishing: there is no route, cron job or
// scheduled function. It also refuses to run unless AUTOMATION_ENABLED=true and
// every step implementation is supplied. The AI generation, image generation
// and Pinterest steps are interfaces only; no implementations exist yet.
//
// Intended flow (one run per day, idempotent by date):
//   1. select an unused keyword         -> claim_next_keyword() RPC
//   2. generate a recipe                -> RecipeGenerator
//   3. validate it                      -> getPublishReadiness() + gluten/claims checks
//   4. generate food photography        -> ImageGenerator
//   5. publish the recipe               -> publishRecipe()
//   6. generate a Pinterest image       -> ImageGenerator
//   7. publish a pin linking to it      -> PinterestPublisher
//   8. record results                   -> publishing_jobs / pinterest_posts

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipeInput } from "@/lib/recipes/types";
import { getPublishReadiness } from "@/lib/recipes/validation";
import { ServiceError } from "./errors";
import { claimJob, completeJob, failJob, getOrCreateDailyJob, recordJobStep, toJobDate } from "./jobs";
import { buildPinDraft, queuePin, type PinterestPublisher } from "./pinterest";
import { createRecipeDraft, publishRecipe, updateRecipe } from "./recipes";

export interface KeywordRecord {
  id: string;
  keyword: string;
  category_id: string | null;
}

export interface RecipeGenerator {
  generate(keyword: KeywordRecord): Promise<RecipeInput>;
}

export interface ImageGenerator {
  /** Returns a public URL of an uploaded image (Supabase Storage). */
  generateFoodPhoto(recipe: RecipeInput): Promise<{ url: string; alt: string }>;
  generatePinImage(recipe: RecipeInput): Promise<{ url: string; alt: string }>;
}

export interface AutomationDeps {
  db: SupabaseClient; // service-role client
  siteUrl: string;
  generator: RecipeGenerator;
  images: ImageGenerator;
  pinterest: PinterestPublisher;
  pinterestBoardId: string;
}

export function isAutomationEnabled(): boolean {
  return process.env.AUTOMATION_ENABLED === "true";
}

export async function runDailyPublishing(deps: AutomationDeps, date = new Date()) {
  if (!isAutomationEnabled()) {
    throw new ServiceError("disabled", "Daily publishing automation is disabled (Phase 1).");
  }
  const { db } = deps;
  const job = await getOrCreateDailyJob(db, toJobDate(date));
  const claimed = await claimJob(db, job);
  if (!claimed) return { status: "skipped" as const, job };

  try {
    // A retried job that already created a recipe must not publish a second one.
    if (claimed.recipe_id) {
      throw new Error(`Job already produced recipe ${claimed.recipe_id}; finish the remaining steps manually.`);
    }
    await recordJobStep(db, claimed.id, "select_keyword");
    const { data: keyword, error } = await db.rpc("claim_next_keyword", { p_job_id: claimed.id });
    if (error) throw new Error(`claim_next_keyword failed: ${error.message}`);
    if (!keyword?.id) throw new Error("No unused keywords are available.");

    await recordJobStep(db, claimed.id, "generate_recipe");
    const generated = await deps.generator.generate(keyword as KeywordRecord);

    await recordJobStep(db, claimed.id, "validate_recipe");
    const precheck = getPublishReadiness({ ...generated, featured_image: "pending", featured_image_alt: "pending" });
    if (!precheck.ready) throw new Error(`Validation failed: ${precheck.errors.map((e) => e.message).join("; ")}`);

    await recordJobStep(db, claimed.id, "generate_photo");
    const photo = await deps.images.generateFoodPhoto(generated);
    const draft = await createRecipeDraft(db, { ...generated, featured_image: photo.url, featured_image_alt: photo.alt });
    await recordJobStep(db, claimed.id, "publish_recipe", { recipe_id: draft.id });
    await db.from("keywords").update({ status: "assigned", assigned_recipe_id: draft.id }).eq("id", keyword.id);

    const { recipe } = await publishRecipe(db, draft.id);
    await db.from("keywords").update({ status: "used" }).eq("id", keyword.id);

    await recordJobStep(db, claimed.id, "generate_pin_image");
    const pinImage = await deps.images.generatePinImage(generated);
    const withPin = await updateRecipe(db, recipe.id, { ...generated, featured_image: photo.url, featured_image_alt: photo.alt, pinterest_image: pinImage.url, pinterest_image_alt: pinImage.alt });

    await recordJobStep(db, claimed.id, "publish_pin");
    const pin = await queuePin(db, buildPinDraft(withPin, deps.siteUrl, { jobId: claimed.id }));
    if (pin.publication_status !== "published") {
      await db.from("pinterest_posts").update({ publication_status: "publishing" }).eq("id", pin.id);
      try {
        const created = await deps.pinterest.createPin({
          title: pin.pin_title,
          description: pin.pin_description,
          imageUrl: pin.image_url,
          link: pin.destination_url,
          boardId: deps.pinterestBoardId,
        });
        await db
          .from("pinterest_posts")
          .update({ publication_status: "published", pinterest_pin_id: created.id, published_at: new Date().toISOString(), error_message: null })
          .eq("id", pin.id);
      } catch (pinError) {
        const message = pinError instanceof Error ? pinError.message : String(pinError);
        await db.from("pinterest_posts").update({ publication_status: "failed", error_message: message, retry_count: (pin.retry_count ?? 0) + 1 }).eq("id", pin.id);
        throw pinError;
      }
    }

    await completeJob(db, claimed.id, recipe.id);
    return { status: "succeeded" as const, recipeId: recipe.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(db, claimed, message);
    return { status: "failed" as const, error: message };
  }
}
