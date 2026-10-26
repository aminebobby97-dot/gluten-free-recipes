// Publish-readiness rules. A recipe can only be published (and indexed) when
// it has no errors. Warnings are shown to the editor but do not block.

import { analyzeClaims, analyzeIngredients } from "./gluten";
import { isValidSlug } from "./format";
import type { Recipe } from "./types";

export interface ReadinessIssue {
  field: string;
  message: string;
}

export interface PublishReadiness {
  ready: boolean;
  errors: ReadinessIssue[];
  warnings: ReadinessIssue[];
}

export type ReadinessInput = Pick<
  Recipe,
  | "title"
  | "slug"
  | "description"
  | "introduction"
  | "category_id"
  | "ingredients"
  | "instructions"
  | "prep_time"
  | "cook_time"
  | "servings"
  | "nutrition"
  | "tips"
  | "substitutions"
  | "storage_instructions"
  | "faq"
  | "featured_image"
  | "featured_image_alt"
  | "pinterest_image"
  | "seo_title"
  | "seo_description"
  | "focus_keyword"
  | "is_tested"
>;

const UNMEASURED_OK = /\b(to taste|for (serving|garnish|greasing|dusting|the pan|frying)|as needed|optional)\b/i;

export function getPublishReadiness(recipe: ReadinessInput): PublishReadiness {
  const errors: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });
  const warn = (field: string, message: string) => warnings.push({ field, message });

  if (!recipe.title?.trim()) err("title", "Add a title.");
  if (!recipe.slug || !isValidSlug(recipe.slug)) err("slug", "Use a lowercase slug with letters, numbers and hyphens.");
  if (!recipe.category_id) err("category_id", "Choose a category.");

  if (!recipe.description?.trim()) err("description", "Add a short description.");
  if (!recipe.introduction?.trim()) err("introduction", "Add an introduction.");
  else if (recipe.introduction.trim().length < 150) warn("introduction", "The introduction is very short (under 150 characters).");

  if (recipe.prep_time == null) err("prep_time", "Add the preparation time.");
  if (recipe.cook_time == null) err("cook_time", "Add the cooking time.");
  if (recipe.servings == null || recipe.servings < 1) err("servings", "Add the number of servings.");

  if (!recipe.ingredients?.length) {
    err("ingredients", "Add at least one ingredient.");
  } else {
    recipe.ingredients.forEach((ingredient, i) => {
      if (!ingredient.name?.trim()) err(`ingredients[${i}]`, `Ingredient ${i + 1} has no name.`);
      const text = `${ingredient.name ?? ""} ${ingredient.note ?? ""}`;
      if (!ingredient.amount?.trim() && !UNMEASURED_OK.test(text)) {
        err(`ingredients[${i}]`, `"${ingredient.name}" needs an exact measurement (or "to taste").`);
      }
    });
  }

  if (!recipe.instructions?.length) err("instructions", "Add at least one instruction step.");
  else if (recipe.instructions.some((step) => !step.text?.trim())) err("instructions", "One or more steps are empty.");

  if (!recipe.featured_image) err("featured_image", "Add a featured image.");
  if (!recipe.featured_image_alt?.trim()) err("featured_image_alt", "Add descriptive alt text for the featured image.");

  if (!recipe.storage_instructions?.trim()) warn("storage_instructions", "Add storage instructions.");
  if (!recipe.tips?.length) warn("tips", "Add at least one recipe tip.");
  if (!recipe.substitutions?.length) warn("substitutions", "Add ingredient substitutions.");
  if (!recipe.faq?.length) warn("faq", "Add frequently asked questions.");
  if (!recipe.nutrition) warn("nutrition", "No nutrition estimate. The nutrition section will be hidden.");
  else if (!recipe.nutrition.is_estimate && !recipe.nutrition.method) {
    warn("nutrition", "Nutrition values are not marked as estimates and have no stated method.");
  }
  if (!recipe.pinterest_image) warn("pinterest_image", "No Pinterest image. The featured image will be used for the Save button.");
  if (!recipe.is_tested) warn("is_tested", "The recipe will be labeled as not yet kitchen-tested.");

  const seoTitle = recipe.seo_title || recipe.title || "";
  if (seoTitle.length > 60) warn("seo_title", `SEO title is ${seoTitle.length} characters; aim for 60 or fewer.`);
  const seoDescription = recipe.seo_description || recipe.description || "";
  if (seoDescription.length < 70) warn("seo_description", "SEO description is short; aim for 120 to 160 characters.");
  if (seoDescription.length > 160) warn("seo_description", `SEO description is ${seoDescription.length} characters; aim for 160 or fewer.`);
  if (!recipe.focus_keyword?.trim()) warn("focus_keyword", "Add a focus keyword.");

  for (const finding of analyzeIngredients(recipe.ingredients ?? [])) {
    if (finding.severity === "blocking") err(`ingredients[${finding.index}]`, finding.message);
  }
  for (const claim of analyzeClaims(recipe)) {
    err(claim.field, `${claim.message} (found "${claim.phrase}")`);
  }

  return { ready: errors.length === 0, errors, warnings };
}
