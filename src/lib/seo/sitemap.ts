import type { MetadataRoute } from "next";
import type { SitemapRecipe } from "@/lib/data/public";

export const STATIC_PATHS = ["/", "/recipes", "/about", "/contact", "/editorial-policy", "/privacy-policy", "/recipe-disclaimer"];

/** Pure sitemap builder (kept separate from data fetching so it can be unit tested). */
export function buildSitemap({
  recipes,
  categorySlugs,
  toUrl,
}: {
  recipes: SitemapRecipe[];
  categorySlugs: string[];
  toUrl: (path: string) => string;
}): MetadataRoute.Sitemap {
  const latest = recipes[0]?.updated_at;
  return [
    ...STATIC_PATHS.map((path) => ({
      url: toUrl(path),
      lastModified: path === "/" || path === "/recipes" ? latest : undefined,
    })),
    ...categorySlugs.map((slug) => ({ url: toUrl(`/categories/${slug}`) })),
    ...recipes.map((r) => ({
      url: toUrl(`/recipes/${r.slug}`),
      lastModified: r.updated_at,
      images: r.featured_image ? [toUrl(r.featured_image)] : undefined,
    })),
  ];
}
