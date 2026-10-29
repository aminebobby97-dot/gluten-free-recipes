import { describe, expect, it } from "vitest";
import { analyzeClaims, analyzeIngredient } from "@/lib/recipes/gluten";

const ing = (name: string, note?: string) => ({ amount: "1", unit: "cup", name, note });

describe("analyzeIngredient", () => {
  it.each(["whole wheat flour", "barley", "rye flour", "semolina", "malted milk powder", "couscous", "seitan", "spelt flour"])(
    "blocks %s",
    (name) => {
      expect(analyzeIngredient(ing(name))?.severity).toBe("blocking");
    },
  );

  it("blocks unqualified wheat products", () => {
    expect(analyzeIngredient(ing("all-purpose flour"))?.severity).toBe("blocking");
    expect(analyzeIngredient(ing("flour"))?.severity).toBe("blocking");
    expect(analyzeIngredient(ing("spaghetti"))?.severity).toBe("blocking");
    expect(analyzeIngredient(ing("panko breadcrumbs"))?.severity).toBe("blocking");
    expect(analyzeIngredient(ing("soy sauce"))?.severity).toBe("blocking");
    expect(analyzeIngredient(ing("flour tortillas"))?.severity).toBe("blocking");
  });

  it("accepts gluten-free versions but asks for a label check", () => {
    expect(analyzeIngredient(ing("gluten-free all-purpose flour blend"))?.severity).toBe("check_label");
    expect(analyzeIngredient(ing("gluten-free fettuccine"))?.severity).toBe("check_label");
    expect(analyzeIngredient(ing("gluten-free soy sauce"))?.severity).toBe("check_label");
    expect(analyzeIngredient(ing("corn tortillas"))?.severity).toBe("check_label");
    expect(analyzeIngredient(ing("rice noodles"))?.severity).toBe("check_label");
  });

  it("does not confuse buckwheat with wheat", () => {
    expect(analyzeIngredient(ing("buckwheat flour"))).toBeNull();
  });

  it("flags oats, broth, baking powder and sauces for label checks", () => {
    for (const name of ["rolled oats", "chicken broth", "baking powder", "tamari", "taco seasoning", "chocolate chips"]) {
      expect(analyzeIngredient(ing(name))?.severity, name).toBe("check_label");
    }
  });

  it("flags packaged nuts, seeds and dried fruit for label checks", () => {
    for (const name of ["chopped walnuts", "pecans", "sliced almonds", "chia seeds", "raisins", "dried cranberries"]) {
      expect(analyzeIngredient(ing(name)), name).toMatchObject({ severity: "check_label", message: expect.stringContaining("shared lines") });
    }
  });

  it("ignores naturally gluten-free whole foods", () => {
    for (const name of ["large eggs", "fresh blueberries", "unsalted butter", "almond flour", "rice", "olive oil", "Parmesan cheese"]) {
      expect(analyzeIngredient(ing(name)), name).toBeNull();
    }
  });
});

describe("analyzeClaims", () => {
  const base = { title: "Pancakes", description: "", introduction: "", tips: [], faq: [], storage_instructions: "", substitutions: [], instructions: [] };

  it("rejects medical safety claims", () => {
    expect(analyzeClaims({ ...base, introduction: "This recipe is celiac-safe." })).toHaveLength(1);
    expect(analyzeClaims({ ...base, description: "Safe for everyone with celiac disease" })).toHaveLength(1);
  });

  it("rejects invented testing, credentials and ratings", () => {
    expect(analyzeClaims({ ...base, introduction: "We tested this recipe five times." })).not.toHaveLength(0);
    expect(analyzeClaims({ ...base, tips: ["Our test kitchen prefers butter."] })).not.toHaveLength(0);
    expect(analyzeClaims({ ...base, introduction: "Dietitian-approved and loved." })).not.toHaveLength(0);
    expect(analyzeClaims({ ...base, introduction: "Registered dietitian approved" })).not.toHaveLength(0);
    expect(analyzeClaims({ ...base, introduction: "Rated 4.9 stars by readers" })).not.toHaveLength(0);
    expect(analyzeClaims({ ...base, introduction: "My family loves these." })).not.toHaveLength(0);
  });

  it("accepts neutral copy", () => {
    expect(analyzeClaims({ ...base, introduction: "Resting the batter helps the flour hydrate." })).toHaveLength(0);
  });
});
