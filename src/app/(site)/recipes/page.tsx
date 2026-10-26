import { RecipeListing } from "@/components/recipe/listing";
import { getPublishedRecipes } from "@/lib/data/public";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "All Gluten-Free Recipes",
  description:
    "Browse every gluten-free recipe on the site: breakfasts, lunches, dinners, desserts, baking, snacks, dairy-free and high-protein ideas.",
  path: "/recipes",
});

export default async function RecipesPage() {
  const result = await getPublishedRecipes(1);
  return (
    <RecipeListing
      title="All gluten-free recipes"
      introduction="Every recipe here is written without wheat, barley or rye, and flags the ingredients you should buy with a gluten-free label. Browse by category or start with the newest recipes below."
      breadcrumbs={[
        { name: "Home", href: "/" },
        { name: "Recipes", href: "/recipes" },
      ]}
      basePath="/recipes"
      result={result}
    />
  );
}
