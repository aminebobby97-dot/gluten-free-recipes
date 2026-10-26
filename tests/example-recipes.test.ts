import { describe, expect, it } from "vitest";
import { exampleRecipes } from "@/content/example-recipes";
import { analyzeClaims, analyzeIngredients } from "@/lib/recipes/gluten";
import { recipeInputSchema } from "@/lib/recipes/schema";
import { getPublishReadiness } from "@/lib/recipes/validation";

describe("example recipe drafts", () => {
  it("contains the five requested recipes", () => {
    expect(exampleRecipes.map((r) => r.title)).toEqual([
      "Fluffy Gluten-Free Pancakes",
      "Easy Gluten-Free Banana Bread",
      "Gluten-Free Chocolate Brownies",
      "Gluten-Free Chicken Alfredo",
      "Gluten-Free Blueberry Muffins",
    ]);
  });

  it.each(exampleRecipes.map((r) => [r.title, r] as const))("%s has no gluten ingredients or forbidden claims", (_title, recipe) => {
    expect(analyzeIngredients(recipe.ingredients).filter((f) => f.severity === "blocking")).toEqual([]);
    expect(analyzeClaims(recipe)).toEqual([]);
  });

  it.each(exampleRecipes.map((r) => [r.title, r] as const))("%s is a valid recipe input", (_title, recipe) => {
    const { category_slug: _slug, ...input } = recipe;
    expect(recipeInputSchema.safeParse({ ...input, category_id: null }).success).toBe(true);
  });

  it("are marked untested and carry no nutrition estimates", () => {
    for (const r of exampleRecipes) {
      expect(r.is_tested).toBe(false);
      expect(r.nutrition).toBeNull();
    }
  });

  it("cannot be published until a photo and category are added", () => {
    const { category_slug: _slug, ...input } = exampleRecipes[0];
    const readiness = getPublishReadiness({ ...input, category_id: null });
    expect(readiness.ready).toBe(false);
    expect(readiness.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["category_id", "featured_image"]));

    const complete = getPublishReadiness({ ...input, category_id: "00000000-0000-4000-8000-000000000001", featured_image: "https://example.test/p.jpg" });
    expect(complete.errors).toEqual([]);
    expect(complete.ready).toBe(true);
  });
});
