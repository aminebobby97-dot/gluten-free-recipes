import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RecipeListing } from "@/components/recipe/listing";
import { getPublishedRecipes } from "@/lib/data/public";
import { parsePageParam } from "@/lib/pagination";
import { pageMetadata } from "@/lib/seo/metadata";

export const ensureStatic = "navigation";

export async function generateStaticParams() {
  // At least one value is required; other pages are generated on first request.
  return [{ page: "2" }];
}

export async function generateMetadata({ params }: PageProps<"/recipes/page/[page]">): Promise<Metadata> {
  const page = parsePageParam((await params).page);
  if (!page) return {};
  return pageMetadata({
    title: `All Gluten-Free Recipes (Page ${page})`,
    description: `Page ${page} of all gluten-free recipes: breakfasts, dinners, desserts, baking and more.`,
    path: `/recipes/page/${page}`,
  });
}

export default async function RecipesPaginatedPage({ params }: PageProps<"/recipes/page/[page]">) {
  const page = parsePageParam((await params).page);
  if (!page) notFound();
  const result = await getPublishedRecipes(page);
  if (page > result.totalPages) notFound();
  return (
    <RecipeListing
      title="All gluten-free recipes"
      breadcrumbs={[
        { name: "Home", href: "/" },
        { name: "Recipes", href: "/recipes" },
      ]}
      basePath="/recipes"
      result={result}
    />
  );
}
