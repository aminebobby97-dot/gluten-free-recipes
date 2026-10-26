import "server-only";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/data/tags";

/**
 * Expires cached public pages after content changes so the next visitor sees
 * fresh content. Works in Server Actions and Route Handlers.
 */
export function revalidateRecipe(slug?: string) {
  revalidateTag(CACHE_TAGS.recipes, { expire: 0 });
  if (slug) revalidateTag(CACHE_TAGS.recipe(slug), { expire: 0 });
}

export function revalidateCategories() {
  revalidateTag(CACHE_TAGS.categories, { expire: 0 });
}
