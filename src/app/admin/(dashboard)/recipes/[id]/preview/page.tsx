import Link from "next/link";
import { notFound } from "next/navigation";
import { RecipeArticle } from "@/components/recipe/recipe-article";
import { requireAdmin } from "@/lib/auth/admin";
import type { RecipeWithCategory } from "@/lib/recipes/types";
import { ServiceError } from "@/lib/services/errors";
import { getRecipeById } from "@/lib/services/recipes";

export const metadata = { title: "Preview", robots: { index: false, follow: false } };

export default async function RecipePreviewPage({ params }: PageProps<"/admin/recipes/[id]/preview">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  let recipe;
  try {
    recipe = await getRecipeById(supabase, id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const { data: category } = recipe.category_id
    ? await supabase.from("categories").select("id,name,short_name,slug").eq("id", recipe.category_id).maybeSingle()
    : { data: null };

  return (
    <div className="-mx-4 -my-8 md:-mx-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-honey/30 bg-honey-wash px-4 py-3 text-sm md:px-8">
        <p>
          <strong>Preview.</strong> {recipe.status === "published" ? "This recipe is live." : "This draft is not public and is not indexed."}
        </p>
        <Link href={`/admin/recipes/${recipe.id}`} className="font-semibold text-sage-dark hover:underline">
          ← Back to editor
        </Link>
      </div>
      <div className="bg-cream pb-16">
        <RecipeArticle recipe={{ ...recipe, category } as RecipeWithCategory} related={[]} />
      </div>
    </div>
  );
}
