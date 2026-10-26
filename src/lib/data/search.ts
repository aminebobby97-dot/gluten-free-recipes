import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import type { RecipeCardData } from "@/lib/recipes/types";

/** Full-text search over published recipes (not cached: depends on the query). */
export async function searchRecipes(query: string): Promise<RecipeCardData[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .rpc("search_recipes", { q, max_results: 24 })
    .select(
      "id,title,slug,description,prep_time,cook_time,featured_image,featured_image_alt,published_at,category:categories(name,short_name,slug)",
    );
  if (error) throw new Error(`Search failed: ${error.message}`);
  return (data ?? []) as unknown as RecipeCardData[];
}
