import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { RecipeArticle } from "@/components/recipe/recipe-article";
import { ViewTracker } from "@/components/recipe/view-tracker";
import { getPublishedRecipeIndex, getRecipeBySlug, getRelatedRecipes } from "@/lib/data/public";
import { recipeMetadata } from "@/lib/seo/metadata";
import { buildBreadcrumbJsonLd, buildRecipeJsonLd } from "@/lib/seo/structured-data";

// Recipe pages are fully static: rendered at build time (or on first request
// for recipes published later) and refreshed when a recipe is (un)published.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const recipes = await getPublishedRecipeIndex();
  // Cache Components needs at least one entry. The placeholder renders a 404.
  return recipes.length > 0 ? recipes.map((r) => ({ slug: r.slug })) : [{ slug: "__placeholder__" }];
}

export async function generateMetadata({ params }: PageProps<"/recipes/[slug]">): Promise<Metadata> {
  const recipe = await getRecipeBySlug((await params).slug);
  return recipe ? recipeMetadata(recipe) : {};
}

export default async function RecipePage({ params }: PageProps<"/recipes/[slug]">) {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();

  const related = await getRelatedRecipes(recipe.id, recipe.category_id, 4);
  const crumbs = [
    { name: "Home", href: "/" },
    ...(recipe.category ? [{ name: recipe.category.name, href: `/categories/${recipe.category.slug}` }] : []),
    { name: recipe.title, href: `/recipes/${recipe.slug}` },
  ];

  return (
    <>
      <JsonLd data={[buildRecipeJsonLd(recipe), buildBreadcrumbJsonLd(crumbs)]} />
      <RecipeArticle recipe={recipe} related={related} />
      <ViewTracker slug={recipe.slug} />
    </>
  );
}
