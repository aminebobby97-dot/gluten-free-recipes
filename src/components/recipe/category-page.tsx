import { notFound } from "next/navigation";
import { getCategoryBySlug, getPublishedRecipes } from "@/lib/data/public";
import { RecipeListing } from "./listing";

/** Category landing page body, shared by page 1 and the paginated routes. */
export async function CategoryPageBody({ slug, page }: { slug: string; page: number }) {
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  const result = await getPublishedRecipes(page, category.id);
  if (page > 1 && page > result.totalPages) notFound();
  return (
    <RecipeListing
      title={category.name}
      introduction={category.introduction || category.description}
      breadcrumbs={[
        { name: "Home", href: "/" },
        { name: "Recipes", href: "/recipes" },
        { name: category.name, href: `/categories/${category.slug}` },
      ]}
      basePath={`/categories/${category.slug}`}
      result={result}
      activeCategorySlug={category.slug}
    />
  );
}
