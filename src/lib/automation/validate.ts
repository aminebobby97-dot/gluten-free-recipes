// Checks a generated recipe before anything is saved. Combines the existing
// publish-readiness rules (completeness, gluten, forbidden claims) with the
// Phase 2 checks (consistency, allergens, SEO, keyword targeting). Duplicate
// checks need the database and run in the pipeline.

import { getPublishReadiness } from "@/lib/recipes/validation";
import { compareAllergens } from "./allergens";
import { checkConsistency } from "./consistency";
import { keywordSimilarity } from "./keywords";
import { generatedRecipeSchema, type CategoryOption, type GeneratedRecipe, type Issue, type KeywordRow } from "./types";

export interface ParsedGeneration {
  recipe: GeneratedRecipe | null;
  issues: Issue[];
}

/** Parses the writer's raw output. Schema errors block. */
export function parseGeneratedRecipe(raw: unknown): ParsedGeneration {
  const parsed = generatedRecipeSchema.safeParse(raw);
  if (parsed.success) return { recipe: parsed.data, issues: [] };
  return {
    recipe: null,
    issues: parsed.error.issues.map((i) => ({ severity: "blocking", source: "schema", field: i.path.join(".") || "recipe", message: i.message })),
  };
}

export function validateGeneratedRecipe(recipe: GeneratedRecipe, keyword: KeywordRow, categories: CategoryOption[]): Issue[] {
  const issues: Issue[] = [];
  const add = (source: Issue["source"], severity: Issue["severity"], field: string, message: string) => issues.push({ source, severity, field, message });

  const category = categories.find((c) => c.slug === recipe.category_slug);
  if (!category) add("schema", "blocking", "category_slug", `Unknown category "${recipe.category_slug}".`);

  // Existing rules, with placeholders for the photo, which is made later.
  const readiness = getPublishReadiness({
    ...recipe,
    category_id: category?.id ?? null,
    featured_image: "pending",
    featured_image_alt: recipe.image_alt,
    pinterest_image: "pending",
    is_tested: false,
  });
  for (const e of readiness.errors) add("readiness", "blocking", e.field, e.message);
  for (const w of readiness.warnings) {
    if (w.field === "is_tested" || w.field === "nutrition") continue; // expected for generated recipes
    add("readiness", "warning", w.field, w.message);
  }

  for (const c of checkConsistency(recipe)) add("consistency", c.severity, c.field, c.message);
  for (const a of compareAllergens(recipe.allergens, recipe.ingredients)) add("allergens", a.severity, "allergens", a.message);

  // SEO: stricter than for hand-written recipes.
  const seoTitle = recipe.seo_title ?? recipe.title;
  if (seoTitle.length > 60) add("seo", "blocking", "seo_title", `SEO title is ${seoTitle.length} characters; the limit is 60.`);
  const seoDescription = recipe.seo_description ?? "";
  if (seoDescription.length < 120 || seoDescription.length > 160) {
    add("seo", "blocking", "seo_description", `SEO description is ${seoDescription.length} characters; it must be 120 to 160.`);
  }
  if (!recipe.focus_keyword || keywordSimilarity(recipe.focus_keyword, keyword.keyword) < 0.6) {
    add("seo", "blocking", "focus_keyword", `The focus keyword must target "${keyword.keyword}".`);
  }
  if (keywordSimilarity(recipe.title, keyword.keyword) < 0.3) {
    add("seo", "warning", "title", `The title does not clearly contain the keyword "${keyword.keyword}".`);
  }
  if (recipe.faq.length < 4 || recipe.faq.length > 8) add("seo", "blocking", "faq", `Include 4 to 8 FAQs (found ${recipe.faq.length}).`);
  if (recipe.introduction.length < 400) add("seo", "blocking", "introduction", "The introduction must be at least 400 characters.");
  if (recipe.substitutions.length === 0) add("seo", "blocking", "substitutions", "Add at least one substitution.");
  if (!recipe.storage_instructions.trim()) add("seo", "blocking", "storage_instructions", "Add storage instructions.");

  // Generated recipes never carry nutrition guesses.
  if (recipe.nutrition) add("readiness", "blocking", "nutrition", "Leave nutrition empty; generated estimates are not reliable.");

  return issues;
}

export function blocking(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === "blocking");
}
