// Runtime validation for recipe and category input (admin forms, future
// automation) and defensive normalization of rows read from the database.

import { z } from "zod";
import { isValidSlug } from "./format";
import type { Recipe } from "./types";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const nullableText = (max?: number) =>
  z
    .string()
    .trim()
    .max(max ?? 100_000)
    .nullish()
    .transform((v) => (v ? v : null));

const minutes = z.number().int().min(0).max(2880).nullish().transform((v) => v ?? null);

export const ingredientSchema = z.object({
  group: optionalText,
  amount: z.string().trim().max(40).default(""),
  unit: optionalText,
  name: z.string().trim().min(1, "Ingredient name is required").max(200),
  note: optionalText,
  metric: optionalText,
});

export const instructionSchema = z.object({
  group: optionalText,
  text: z.string().trim().min(1, "Step text is required").max(2000),
});

export const substitutionSchema = z.object({
  original: z.string().trim().min(1).max(200),
  substitute: z.string().trim().min(1).max(300),
  note: optionalText,
});

export const faqSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});

const nutrient = z.number().min(0).max(100_000).optional();

export const nutritionSchema = z.object({
  per: z.string().trim().min(1).max(80).default("1 serving"),
  calories: nutrient,
  protein_g: nutrient,
  carbohydrates_g: nutrient,
  fat_g: nutrient,
  saturated_fat_g: nutrient,
  fiber_g: nutrient,
  sugar_g: nutrient,
  sodium_mg: nutrient,
  is_estimate: z.boolean().default(true),
  method: optionalText,
});

export const recipeInputSchema = z.object({
  title: z.string().trim().min(3).max(140),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidSlug, "Slug must use lowercase letters, numbers and single hyphens"),
  description: z.string().trim().max(500).default(""),
  introduction: z.string().trim().max(10_000).default(""),
  category_id: z.uuid().nullish().transform((v) => v ?? null),
  ingredients: z.array(ingredientSchema).max(100).default([]),
  instructions: z.array(instructionSchema).max(60).default([]),
  prep_time: minutes,
  cook_time: minutes,
  servings: z.number().int().min(1).max(200).nullish().transform((v) => v ?? null),
  yield_description: nullableText(120),
  nutrition: nutritionSchema.nullish().transform((v) => v ?? null),
  tips: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  substitutions: z.array(substitutionSchema).max(30).default([]),
  storage_instructions: z.string().trim().max(3000).default(""),
  faq: z.array(faqSchema).max(20).default([]),
  featured_image: nullableText(1000),
  featured_image_alt: nullableText(250),
  pinterest_image: nullableText(1000),
  pinterest_image_alt: nullableText(250),
  seo_title: nullableText(70),
  seo_description: nullableText(170),
  focus_keyword: nullableText(120),
  is_tested: z.boolean().default(false),
});

export type ParsedRecipeInput = z.output<typeof recipeInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  short_name: z.string().trim().min(2).max(40),
  slug: z.string().trim().toLowerCase().refine(isValidSlug, "Invalid slug"),
  description: z.string().trim().max(500).default(""),
  introduction: z.string().trim().max(5000).default(""),
  seo_title: nullableText(70),
  seo_description: nullableText(170),
  image_url: nullableText(1000),
  image_alt: nullableText(250),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

function arrayOf<T>(value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Coerces a raw database row into a well-formed Recipe, dropping malformed JSON items. */
export function normalizeRecipe<T extends Record<string, unknown>>(row: T): Recipe & Omit<T, keyof Recipe> {
  const nutrition = nutritionSchema.safeParse(row.nutrition);
  return {
    ...(row as unknown as Recipe & Omit<T, keyof Recipe>),
    ingredients: arrayOf(row.ingredients, ingredientSchema),
    instructions: arrayOf(row.instructions, instructionSchema),
    tips: arrayOf(row.tips, z.string().min(1)),
    substitutions: arrayOf(row.substitutions, substitutionSchema),
    faq: arrayOf(row.faq, faqSchema),
    nutrition: row.nutrition && nutrition.success ? nutrition.data : null,
    storage_instructions: typeof row.storage_instructions === "string" ? row.storage_instructions : "",
  };
}
