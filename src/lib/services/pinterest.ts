// Pinterest pin preparation. In Phase 1 pins can be drafted and stored, but
// nothing is sent to Pinterest: there is no API client and publishing throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { truncate } from "@/lib/recipes/format";
import type { Recipe } from "@/lib/recipes/types";
import { dbError, ServiceError } from "./errors";

export interface PinDraft {
  recipe_id: string;
  pin_title: string;
  pin_description: string;
  image_url: string;
  destination_url: string;
  idempotency_key: string;
  publishing_job_id: string | null;
}

/** Builds the stored pin for a published recipe. Pure; no network calls. */
export function buildPinDraft(
  recipe: Pick<Recipe, "id" | "slug" | "title" | "description" | "pinterest_image" | "featured_image" | "focus_keyword">,
  siteUrl: string,
  options: { variant?: string; jobId?: string | null } = {},
): PinDraft {
  const image = recipe.pinterest_image || recipe.featured_image;
  if (!image) throw new ServiceError("not_ready", "The recipe needs a Pinterest or featured image before a pin can be created.");
  const base = siteUrl.replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new ServiceError("invalid_input", "Pins must link to an https:// site URL.");
  const imageUrl = /^https?:\/\//.test(image) ? image : `${base}${image.startsWith("/") ? "" : "/"}${image}`;

  return {
    recipe_id: recipe.id,
    pin_title: truncate(recipe.title, 100),
    pin_description: truncate(recipe.description, 500),
    image_url: imageUrl,
    destination_url: `${base}/recipes/${recipe.slug}`,
    idempotency_key: `pin:${recipe.id}:${options.variant ?? "primary"}`,
    publishing_job_id: options.jobId ?? null,
  };
}

/** Stores a pending pin. Re-queuing the same recipe/variant returns the existing row. */
export async function queuePin(db: SupabaseClient, draft: PinDraft) {
  const { error } = await db.from("pinterest_posts").upsert(draft, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw dbError("Queue Pinterest pin", error);
  const { data, error: loadError } = await db.from("pinterest_posts").select("*").eq("idempotency_key", draft.idempotency_key).single();
  if (loadError) throw dbError("Load Pinterest pin", loadError);
  return data;
}

/** What a real Pinterest integration must implement in a later phase. */
export interface PinterestPublisher {
  createPin(input: { title: string; description: string; imageUrl: string; link: string; boardId: string }): Promise<{ id: string }>;
}

/**
 * Returns the Pinterest publisher. Phase 1 deliberately has none: calling this
 * throws so no code path can post to Pinterest until the integration is built
 * and explicitly enabled.
 */
export function getPinterestPublisher(): PinterestPublisher {
  throw new ServiceError("disabled", "Pinterest publishing is not enabled. It will be added in a later phase.");
}
