// Cached, read-only queries for the public site.
//
// Every function runs inside `"use cache"` with the cookie-less public client,
// so results can be prerendered. Row Level Security limits the public key to
// categories and published recipes; the explicit status filters below are a
// second layer of protection.
//
// Publishing services invalidate these caches with the tags in CACHE_TAGS.

import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { normalizeRecipe } from "@/lib/recipes/schema";
import type { Category, RecipeCardData, RecipeWithCategory } from "@/lib/recipes/types";
import { CACHE_TAGS } from "./tags";

export const RECIPES_PER_PAGE = 12;

const CARD_FIELDS =
  "id,title,slug,description,prep_time,cook_time,featured_image,featured_image_alt,published_at,category:categories(name,short_name,slug)";

const CATEGORY_FIELDS =
  "id,name,short_name,slug,description,introduction,seo_title,seo_description,image_url,image_alt,sort_order,updated_at";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

function fail(context: string, error: { message: string }): never {
  throw new Error(`Supabase query failed (${context}): ${error.message}`);
}

export async function getCategories(): Promise<Category[]> {
  "use cache";
  cacheTag(CACHE_TAGS.categories);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("categories").select(CATEGORY_FIELDS).order("sort_order");
  if (error) fail("categories", error);
  return (data ?? []) as Category[];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  "use cache";
  cacheTag(CACHE_TAGS.categories);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("categories").select(CATEGORY_FIELDS).eq("slug", slug).maybeSingle();
  if (error) fail("category", error);
  return (data as Category | null) ?? null;
}

export async function getLatestRecipes(limit = 12): Promise<RecipeCardData[]> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("recipes")
    .select(CARD_FIELDS)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) fail("latest recipes", error);
  return (data ?? []) as unknown as RecipeCardData[];
}

/**
 * Most-viewed published recipes, based on real counts in recipe_views.
 * Returns an empty list until views have been recorded; nothing is invented.
 */
export async function getPopularRecipes(limit = 4): Promise<RecipeCardData[]> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes, CACHE_TAGS.views);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("recipe_views")
    .select(`view_count, recipe:recipes!inner(${CARD_FIELDS})`)
    .eq("recipe.status", "published")
    .gt("view_count", 0)
    .order("view_count", { ascending: false })
    .limit(limit);
  if (error) fail("popular recipes", error);
  return ((data ?? []) as unknown as Array<{ recipe: RecipeCardData | null }>)
    .map((row) => row.recipe)
    .filter((recipe): recipe is RecipeCardData => recipe !== null);
}

export async function getPublishedRecipes(page = 1, categoryId?: string): Promise<Paginated<RecipeCardData>> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes);
  cacheLife("hours");

  const empty = { items: [], total: 0, page, totalPages: 0 };
  const supabase = createPublicClient();
  if (!supabase) return empty;

  const from = (page - 1) * RECIPES_PER_PAGE;
  let query = supabase
    .from("recipes")
    .select(CARD_FIELDS, { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(from, from + RECIPES_PER_PAGE - 1);
  if (categoryId) query = query.eq("category_id", categoryId);

  const { data, error, count } = await query;
  // PostgREST answers 416 when the range starts past the last row.
  if (error && error.code === "PGRST103") return { ...empty, total: count ?? 0 };
  if (error) fail("recipes page", error);
  const total = count ?? 0;
  return {
    items: (data ?? []) as unknown as RecipeCardData[],
    total,
    page,
    totalPages: Math.ceil(total / RECIPES_PER_PAGE),
  };
}

export async function getRecipeBySlug(slug: string): Promise<RecipeWithCategory | null> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes, CACHE_TAGS.recipe(slug));
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("recipes")
    .select("*, category:categories(id,name,short_name,slug)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) fail("recipe", error);
  return data ? (normalizeRecipe(data) as RecipeWithCategory) : null;
}

/** Other recipes from the same category, topped up with the latest recipes. */
export async function getRelatedRecipes(recipeId: string, categoryId: string | null, limit = 3): Promise<RecipeCardData[]> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return [];

  const related: RecipeCardData[] = [];
  if (categoryId) {
    const { data, error } = await supabase
      .from("recipes")
      .select(CARD_FIELDS)
      .eq("status", "published")
      .eq("category_id", categoryId)
      .neq("id", recipeId)
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) fail("related recipes", error);
    related.push(...((data ?? []) as unknown as RecipeCardData[]));
  }

  if (related.length < limit) {
    const exclude = [recipeId, ...related.map((r) => r.id)];
    const { data, error } = await supabase
      .from("recipes")
      .select(CARD_FIELDS)
      .eq("status", "published")
      .not("id", "in", `(${exclude.join(",")})`)
      .order("published_at", { ascending: false })
      .limit(limit - related.length);
    if (error) fail("related recipes (fallback)", error);
    related.push(...((data ?? []) as unknown as RecipeCardData[]));
  }
  return related;
}

export interface SitemapRecipe {
  slug: string;
  updated_at: string;
  published_at: string;
  featured_image: string | null;
}

/** Published recipes for the sitemap and static generation. Drafts never appear here. */
export async function getPublishedRecipeIndex(): Promise<SitemapRecipe[]> {
  "use cache";
  cacheTag(CACHE_TAGS.recipes);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("recipes")
    .select("slug,updated_at,published_at,featured_image")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5000);
  if (error) fail("recipe index", error);
  return (data ?? []) as SitemapRecipe[];
}
