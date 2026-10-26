// Converts admin FormData into plain values for schema validation.

export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function nullableText(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

export function intOrNull(form: FormData, name: string): number | null {
  const v = text(form, name);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
}

export function numberOrUndefined(form: FormData, name: string): number | undefined {
  const v = text(form, name);
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function jsonArray(form: FormData, name: string): unknown[] {
  try {
    const parsed = JSON.parse(text(form, name) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function checkbox(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

/** Builds the recipe input object from the admin recipe form. */
export function recipeFromForm(form: FormData) {
  const nutritionFields = ["calories", "protein_g", "carbohydrates_g", "fat_g", "saturated_fat_g", "fiber_g", "sugar_g", "sodium_mg"] as const;
  const nutrientValues = Object.fromEntries(nutritionFields.map((f) => [f, numberOrUndefined(form, `nutrition_${f}`)]));
  const hasNutrition = Object.values(nutrientValues).some((v) => v !== undefined);

  return {
    title: text(form, "title"),
    slug: text(form, "slug"),
    description: text(form, "description"),
    introduction: text(form, "introduction"),
    category_id: nullableText(form, "category_id"),
    ingredients: jsonArray(form, "ingredients"),
    instructions: jsonArray(form, "instructions"),
    prep_time: intOrNull(form, "prep_time"),
    cook_time: intOrNull(form, "cook_time"),
    servings: intOrNull(form, "servings"),
    yield_description: nullableText(form, "yield_description"),
    nutrition: hasNutrition
      ? {
          per: text(form, "nutrition_per") || "1 serving",
          ...nutrientValues,
          is_estimate: true,
          method: nullableText(form, "nutrition_method") ?? undefined,
        }
      : null,
    tips: jsonArray(form, "tips")
      .map((t) => (typeof t === "object" && t && "text" in t ? String((t as { text: unknown }).text) : String(t)))
      .filter((t) => t.trim()),
    substitutions: jsonArray(form, "substitutions"),
    storage_instructions: text(form, "storage_instructions"),
    faq: jsonArray(form, "faq"),
    featured_image: nullableText(form, "featured_image"),
    featured_image_alt: nullableText(form, "featured_image_alt"),
    pinterest_image: nullableText(form, "pinterest_image"),
    pinterest_image_alt: nullableText(form, "pinterest_image_alt"),
    seo_title: nullableText(form, "seo_title"),
    seo_description: nullableText(form, "seo_description"),
    focus_keyword: nullableText(form, "focus_keyword"),
    is_tested: checkbox(form, "is_tested"),
  };
}
