// schema.org JSON-LD builders. Only fields backed by real recipe data are
// emitted: no ratings, reviews, video or invented authors.

import { absoluteUrl, siteConfig } from "@/lib/env";
import { describeIngredient } from "@/lib/recipes/gluten";
import { toIsoDuration, totalMinutes } from "@/lib/recipes/format";
import type { Nutrition, RecipeWithCategory } from "@/lib/recipes/types";

type JsonLdObject = Record<string, unknown>;

/** JSON.stringify that is safe to embed inside a <script> tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Removes undefined, null, empty strings and empty arrays so no empty fields are published. */
function compact<T extends JsonLdObject>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as T;
}

function organization(): JsonLdObject {
  return { "@type": "Organization", name: siteConfig.name, url: siteConfig.url };
}

function nutritionJsonLd(nutrition: Nutrition | null): JsonLdObject | undefined {
  if (!nutrition) return undefined;
  const fields = compact({
    "@type": "NutritionInformation",
    servingSize: nutrition.per,
    calories: nutrition.calories != null ? `${Math.round(nutrition.calories)} calories` : undefined,
    proteinContent: nutrition.protein_g != null ? `${nutrition.protein_g} g` : undefined,
    carbohydrateContent: nutrition.carbohydrates_g != null ? `${nutrition.carbohydrates_g} g` : undefined,
    fatContent: nutrition.fat_g != null ? `${nutrition.fat_g} g` : undefined,
    saturatedFatContent: nutrition.saturated_fat_g != null ? `${nutrition.saturated_fat_g} g` : undefined,
    fiberContent: nutrition.fiber_g != null ? `${nutrition.fiber_g} g` : undefined,
    sugarContent: nutrition.sugar_g != null ? `${nutrition.sugar_g} g` : undefined,
    sodiumContent: nutrition.sodium_mg != null ? `${nutrition.sodium_mg} mg` : undefined,
  });
  // Only publish nutrition when at least one value exists besides the type and serving size.
  return Object.keys(fields).length > 2 ? fields : undefined;
}

export function buildRecipeJsonLd(recipe: RecipeWithCategory): JsonLdObject {
  const url = absoluteUrl(`/recipes/${recipe.slug}`);
  const images = [recipe.featured_image, recipe.pinterest_image].filter((v): v is string => Boolean(v)).map((src) => absoluteUrl(src));

  return compact({
    "@context": "https://schema.org",
    "@type": "Recipe",
    "@id": `${url}#recipe`,
    name: recipe.title,
    description: recipe.description,
    url,
    image: images,
    author: organization(),
    publisher: organization(),
    datePublished: recipe.published_at ?? undefined,
    dateModified: recipe.updated_at,
    prepTime: toIsoDuration(recipe.prep_time),
    cookTime: toIsoDuration(recipe.cook_time),
    totalTime: toIsoDuration(totalMinutes(recipe.prep_time, recipe.cook_time)),
    recipeYield: recipe.servings != null ? [String(recipe.servings), recipe.yield_description ?? `${recipe.servings} servings`] : undefined,
    recipeCategory: recipe.category?.short_name,
    keywords: recipe.focus_keyword ?? undefined,
    suitableForDiet: "https://schema.org/GlutenFreeDiet",
    recipeIngredient: recipe.ingredients.map((i) => [describeIngredient(i), i.note ? `(${i.note})` : ""].join(" ").trim()),
    recipeInstructions: recipe.instructions.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text: step.text,
      url: `${url}#step-${index + 1}`,
    })),
    nutrition: nutritionJsonLd(recipe.nutrition),
  });
}

export function buildBreadcrumbJsonLd(items: Array<{ name: string; href: string }>): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.href),
    })),
  };
}

export function buildItemListJsonLd(paths: string[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: paths.map((path, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(path),
    })),
  };
}

export function buildWebsiteJsonLd(): JsonLdObject[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.name,
      url: siteConfig.url,
      inLanguage: "en-US",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${siteConfig.url}/search?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
    { "@context": "https://schema.org", ...organization() },
  ];
}
