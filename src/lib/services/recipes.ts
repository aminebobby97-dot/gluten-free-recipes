// Recipe publishing service. Shared by the admin dashboard (with the signed-in
// admin's session client) and, later, the automation worker (with the
// service-role client). Callers are responsible for authenticating first.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRecipe, recipeInputSchema, type ParsedRecipeInput } from "@/lib/recipes/schema";
import type { Recipe } from "@/lib/recipes/types";
import { getPublishReadiness, type PublishReadiness } from "@/lib/recipes/validation";
import { dbError, ServiceError } from "./errors";
import { revalidateRecipe } from "./revalidate";

export async function getRecipeById(db: SupabaseClient, id: string): Promise<Recipe> {
  const { data, error } = await db.from("recipes").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError("Load recipe", error);
  if (!data) throw new ServiceError("not_found", "Recipe not found.");
  return normalizeRecipe(data);
}

function parseInput(input: unknown): ParsedRecipeInput {
  const parsed = recipeInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(
      "invalid_input",
      "The recipe has invalid fields.",
      parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

/** Creates a new recipe. New recipes are always drafts. */
export async function createRecipeDraft(db: SupabaseClient, input: unknown): Promise<Recipe> {
  const data = parseInput(input);
  const { data: row, error } = await db.from("recipes").insert({ ...data, status: "draft" }).select("*").single();
  if (error) throw dbError("Create recipe", error);
  return normalizeRecipe(row);
}

/**
 * Updates a recipe's content without changing its status. If the recipe is
 * live, the update is rejected when it would leave the recipe incomplete.
 */
export async function updateRecipe(db: SupabaseClient, id: string, input: unknown): Promise<Recipe> {
  const data = parseInput(input);
  const existing = await getRecipeById(db, id);

  if (existing.status === "published") {
    const readiness = getPublishReadiness(data);
    if (!readiness.ready) {
      throw new ServiceError("not_ready", "This change would make a published recipe incomplete. Unpublish it first or fix the issues.", readiness.errors);
    }
  }

  const { data: row, error } = await db.from("recipes").update(data).eq("id", id).select("*").single();
  if (error) throw dbError("Update recipe", error);

  if (existing.status === "published") {
    revalidateRecipe(existing.slug);
    if (row.slug !== existing.slug) revalidateRecipe(row.slug);
  }
  return normalizeRecipe(row);
}

export interface PublishResult {
  recipe: Recipe;
  readiness: PublishReadiness;
}

/**
 * Publishes a recipe after validating that it is complete and passes the
 * gluten-safety and claims checks. Idempotent: publishing an already
 * published recipe is a no-op that keeps the original publish date.
 */
export async function publishRecipe(db: SupabaseClient, id: string, options: { publishAt?: Date } = {}): Promise<PublishResult> {
  const recipe = await getRecipeById(db, id);
  const readiness = getPublishReadiness(recipe);
  if (!readiness.ready) {
    throw new ServiceError("not_ready", "The recipe is not ready to publish.", readiness.errors);
  }
  if (recipe.status === "published") return { recipe, readiness };

  const publishedAt = (options.publishAt ?? (recipe.published_at ? new Date(recipe.published_at) : new Date())).toISOString();
  const { data: row, error } = await db
    .from("recipes")
    .update({ status: "published", published_at: publishedAt })
    .eq("id", id)
    .neq("status", "published")
    .select("*")
    .maybeSingle();
  if (error) throw dbError("Publish recipe", error);

  revalidateRecipe(recipe.slug);
  return { recipe: row ? normalizeRecipe(row) : recipe, readiness };
}

/** Takes a recipe offline (back to draft). Its URL starts returning 404. */
export async function unpublishRecipe(db: SupabaseClient, id: string): Promise<Recipe> {
  const recipe = await getRecipeById(db, id);
  if (recipe.status !== "published") return recipe;
  const { data: row, error } = await db.from("recipes").update({ status: "draft" }).eq("id", id).select("*").single();
  if (error) throw dbError("Unpublish recipe", error);
  revalidateRecipe(recipe.slug);
  return normalizeRecipe(row);
}

/** Deletes a recipe that is not live. Published recipes must be unpublished first. */
export async function deleteRecipe(db: SupabaseClient, id: string): Promise<void> {
  const recipe = await getRecipeById(db, id);
  if (recipe.status === "published") {
    throw new ServiceError("conflict", "Unpublish the recipe before deleting it.");
  }
  const { error } = await db.from("recipes").delete().eq("id", id);
  if (error) throw dbError("Delete recipe", error);
}
