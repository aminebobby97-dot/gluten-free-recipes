import { describe, expect, it } from "vitest";
import { getPublishReadiness, type ReadinessInput } from "@/lib/recipes/validation";

const complete: ReadinessInput = {
  title: "Test Rice Bowl",
  slug: "test-rice-bowl",
  description: "A simple, filling rice bowl with vegetables and a gluten-free sauce for busy weeknights at home.",
  introduction: "x".repeat(200),
  category_id: "00000000-0000-4000-8000-000000000001",
  ingredients: [{ amount: "1", unit: "cup", name: "jasmine rice" }, { amount: "", name: "salt", note: "to taste" }],
  instructions: [{ text: "Cook the rice." }],
  prep_time: 5,
  cook_time: 20,
  servings: 2,
  nutrition: null,
  tips: ["Rinse the rice."],
  substitutions: [{ original: "jasmine rice", substitute: "brown rice" }],
  storage_instructions: "Refrigerate for 3 days.",
  faq: [{ question: "Can I freeze it?", answer: "Yes." }],
  featured_image: "https://example.test/bowl.jpg",
  featured_image_alt: "A rice bowl",
  pinterest_image: null,
  seo_title: null,
  seo_description: null,
  focus_keyword: "gluten-free rice bowl",
  is_tested: false,
};

describe("getPublishReadiness", () => {
  it("accepts a complete recipe and warns about untested status", () => {
    const r = getPublishReadiness(complete);
    expect(r.ready).toBe(true);
    expect(r.warnings.map((w) => w.field)).toContain("is_tested");
  });

  it("requires exact measurements unless 'to taste'", () => {
    const r = getPublishReadiness({ ...complete, ingredients: [{ amount: "", name: "rice" }] });
    expect(r.ready).toBe(false);
    expect(r.errors[0].message).toMatch(/exact measurement/);
  });

  it("blocks gluten ingredients", () => {
    const r = getPublishReadiness({ ...complete, ingredients: [{ amount: "2", unit: "tbsp", name: "soy sauce" }] });
    expect(r.ready).toBe(false);
  });

  it("blocks invented claims", () => {
    const r = getPublishReadiness({ ...complete, introduction: `${"x".repeat(160)} Our test kitchen loved it.` });
    expect(r.ready).toBe(false);
  });

  it("requires the core fields", () => {
    const r = getPublishReadiness({ ...complete, prep_time: null, servings: null, featured_image_alt: null, slug: "Bad Slug" });
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["prep_time", "servings", "featured_image_alt", "slug"]));
  });
});
