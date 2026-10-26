import type { MetadataRoute } from "next";
import { featuredCategories } from "@/content/site";
import { getCategories, getPublishedRecipeIndex } from "@/lib/data/public";
import { absoluteUrl } from "@/lib/env";
import { buildSitemap } from "@/lib/seo/sitemap";

// Only published recipes are listed; drafts are never queried here.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [recipes, categories] = await Promise.all([getPublishedRecipeIndex(), getCategories()]);
  const categorySlugs = categories.length > 0 ? categories.map((c) => c.slug) : featuredCategories.map((c) => c.slug);
  return buildSitemap({ recipes, categorySlugs, toUrl: absoluteUrl });
}
