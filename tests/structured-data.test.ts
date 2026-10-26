import { describe, expect, it } from "vitest";
import { buildBreadcrumbJsonLd, buildRecipeJsonLd, serializeJsonLd } from "@/lib/seo/structured-data";
import type { RecipeWithCategory } from "@/lib/recipes/types";

const recipe: RecipeWithCategory = {
  id: "r1",
  title: "Gluten-Free Pancakes",
  slug: "gluten-free-pancakes",
  description: "Fluffy pancakes.",
  introduction: "Intro",
  category_id: "c1",
  category: { id: "c1", name: "Gluten-Free Breakfast", short_name: "Breakfast", slug: "gluten-free-breakfast" },
  ingredients: [{ amount: "1 1/2", unit: "cups", name: "gluten-free flour blend", note: "with xanthan gum" }],
  instructions: [{ text: "Whisk." }, { text: "Cook." }],
  prep_time: 15,
  cook_time: 75,
  servings: 4,
  yield_description: null,
  nutrition: null,
  tips: [],
  substitutions: [],
  storage_instructions: "",
  faq: [],
  featured_image: "https://cdn.example.test/p.jpg",
  featured_image_alt: "Pancakes",
  pinterest_image: null,
  pinterest_image_alt: null,
  seo_title: null,
  seo_description: null,
  focus_keyword: "gluten-free pancakes",
  is_tested: false,
  status: "published",
  published_at: "2026-10-01T12:00:00Z",
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-02T12:00:00Z",
};

describe("buildRecipeJsonLd", () => {
  const ld = buildRecipeJsonLd(recipe) as Record<string, unknown>;

  it("uses real recipe data with ISO durations", () => {
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.prepTime).toBe("PT15M");
    expect(ld.cookTime).toBe("PT1H15M");
    expect(ld.totalTime).toBe("PT1H30M");
    expect(ld.recipeIngredient).toEqual(["1 1/2 cups gluten-free flour blend (with xanthan gum)"]);
    expect((ld.recipeInstructions as unknown[]).length).toBe(2);
    expect(ld.recipeCategory).toBe("Breakfast");
  });

  it("never includes ratings, reviews or invented people", () => {
    const json = JSON.stringify(ld);
    expect(json).not.toMatch(/aggregateRating|review|"Person"/i);
    expect((ld.author as Record<string, unknown>)["@type"]).toBe("Organization");
  });

  it("omits nutrition when there is no estimate", () => {
    expect(ld).not.toHaveProperty("nutrition");
  });

  it("includes nutrition when values exist", () => {
    const withNutrition = buildRecipeJsonLd({ ...recipe, nutrition: { per: "1 serving", calories: 250.4, protein_g: 6, is_estimate: true } }) as Record<string, Record<string, unknown>>;
    expect(withNutrition.nutrition.calories).toBe("250 calories");
    expect(withNutrition.nutrition.proteinContent).toBe("6 g");
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("numbers items and makes URLs absolute", () => {
    const ld = buildBreadcrumbJsonLd([{ name: "Home", href: "/" }, { name: "Breakfast", href: "/categories/gluten-free-breakfast" }]);
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items[1].position).toBe(2);
    expect(String(items[1].item)).toMatch(/^https?:\/\/.+\/categories\/gluten-free-breakfast$/);
  });
});

describe("serializeJsonLd", () => {
  it("cannot break out of the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});
