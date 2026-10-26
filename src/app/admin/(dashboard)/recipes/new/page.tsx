import { RecipeForm } from "@/components/admin/recipe-form";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listCategories } from "@/lib/data/admin";

export const metadata = { title: "New recipe" };

export default async function NewRecipePage() {
  const { supabase } = await requireAdmin();
  const categories = await listCategories(supabase);
  return (
    <div className="space-y-6">
      <PageHeader title="New recipe" description="New recipes are saved as private drafts." />
      <RecipeForm recipe={null} categories={categories} />
    </div>
  );
}
