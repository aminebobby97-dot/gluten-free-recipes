import { describe, expect, it } from "vitest";
import { compareAllergens, detectAllergens, undeclaredOptionalAllergens } from "@/lib/automation/allergens";
import { checkConsistency, heatMinutes, maxMinutesIn, ovenTemperaturesF } from "@/lib/automation/consistency";
import { assertWithinBudget, BudgetExceededError, estimateTextCostUsd, textCostUsd, UnknownPriceError } from "@/lib/automation/cost";
import { keywordCore, keywordSimilarity, opportunityScore } from "@/lib/automation/keywords";
import type { Ingredient } from "@/lib/recipes/types";

const ing = (name: string, amount = "1", unit = "cup", note?: string): Ingredient => ({ name, amount, unit, note });
const step = (text: string) => ({ text });

const muffins = {
  prep_time: 15,
  cook_time: 22,
  servings: 12,
  ingredients: [
    ing("gluten-free all-purpose flour blend", "2", "cups"),
    ing("granulated sugar", "3/4", "cup"),
    ing("baking powder", "2", "tsp", "labeled gluten-free"),
    ing("kosher salt", "1/2", "tsp"),
    ing("large eggs", "2", ""),
    ing("whole milk", "1", "cup"),
    ing("unsalted butter", "1/2", "cup", "melted"),
    ing("fresh blueberries", "1 1/2", "cups"),
  ],
  instructions: [
    step("Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners."),
    step("Whisk the flour, sugar, baking powder and salt in a large bowl."),
    step("In a second bowl whisk the eggs, milk and melted butter, then stir into the dry mixture."),
    step("Fold in the blueberries and divide the batter between the cups."),
    step("Bake for 20 to 22 minutes, until a toothpick comes out clean. Cool for 10 minutes before serving."),
  ],
};

describe("detectAllergens", () => {
  it("finds the allergens in a muffin recipe", () => {
    expect(detectAllergens(muffins.ingredients)).toEqual(["milk", "eggs"]);
  });

  it("ignores plant-based and look-alike ingredients", () => {
    const list = [
      ing("coconut milk"),
      ing("dairy-free butter"),
      ing("cream of tartar"),
      ing("almond milk"),
      ing("vegan mayo"),
      ing("eggplant"),
      ing("butternut squash"),
      ing("ground nutmeg"),
      ing("coconut flakes"),
    ];
    // Almond milk is not dairy, but almonds are a tree nut. Coconut is not counted.
    expect(detectAllergens(list)).toEqual(["tree_nuts"]);
  });

  it("detects hidden sources", () => {
    expect(detectAllergens([ing("Worcestershire sauce", "1", "tbsp", "gluten-free")])).toEqual(["fish"]);
    expect(detectAllergens([ing("tahini")])).toEqual(["sesame"]);
    expect(detectAllergens([ing("tamari")])).toEqual(["soy"]);
    expect(detectAllergens([ing("peanut butter")])).toEqual(["peanuts"]);
    expect(detectAllergens([ing("shrimp")])).toEqual(["shellfish"]);
  });
});

describe("compareAllergens", () => {
  it("blocks an undeclared allergen and names the ingredient", () => {
    const issues = compareAllergens(["milk"], muffins.ingredients);
    expect(issues).toEqual([expect.objectContaining({ severity: "blocking", allergen: "eggs", message: expect.stringContaining("large eggs") })]);
  });

  it("only warns about an over-declared allergen", () => {
    const issues = compareAllergens(["milk", "eggs", "tree_nuts"], muffins.ingredients);
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", allergen: "tree_nuts" })]);
  });

  it("rejects unknown allergen names", () => {
    expect(compareAllergens(["milk", "eggs", "wheat"], muffins.ingredients)[0]).toMatchObject({ severity: "blocking", allergen: "wheat" });
  });
});

describe("undeclaredOptionalAllergens", () => {
  const faq = (text: string) => [{ field: "faq[3]", text }];

  it("blocks a suggested nut add-in without an allergy note", () => {
    const issues = undeclaredOptionalAllergens(["milk", "eggs"], faq("Can I add mix-ins? Fold in chocolate chips labeled gluten-free or chopped walnuts labeled gluten-free."));
    expect(issues).toEqual([expect.objectContaining({ severity: "blocking", allergen: "tree_nuts", message: expect.stringContaining("faq[3]") })]);
  });

  it("accepts the suggestion once it says it adds an allergen", () => {
    expect(undeclaredOptionalAllergens(["milk"], faq("Fold in chopped walnuts labeled gluten-free (walnuts are a tree-nut allergen; leave them out for a nut-free loaf)."))).toEqual([]);
    expect(undeclaredOptionalAllergens(["milk"], faq("Use pecans, or sunflower seeds for a nut-free version."))).toEqual([]);
  });

  it("accepts nuts the allergen list already declares, and ignores other allergens", () => {
    expect(undeclaredOptionalAllergens(["tree_nuts"], faq("Add chopped walnuts."))).toEqual([]);
    expect(undeclaredOptionalAllergens([], faq("Top with grated Parmesan cheese."))).toEqual([]);
    expect(undeclaredOptionalAllergens([], faq("Coconut milk works too."))).toEqual([]);
  });

  it("covers peanuts", () => {
    expect(undeclaredOptionalAllergens([], faq("Swirl in peanut butter."))[0]).toMatchObject({ allergen: "peanuts", message: expect.stringContaining("peanut allergen") });
  });
});

describe("time and temperature parsing", () => {
  it("reads the longest duration in a sentence", () => {
    expect(maxMinutesIn("Bake for 20 to 22 minutes")).toBe(22);
    expect(maxMinutesIn("Simmer 1 hour")).toBe(60);
    expect(maxMinutesIn("Roast 1.5 hours or until tender")).toBe(90);
    expect(maxMinutesIn("Stir well")).toBe(0);
  });

  it("only counts sentences that apply heat", () => {
    expect(heatMinutes(muffins.instructions)).toBe(22);
  });

  it("finds Fahrenheit oven temperatures", () => {
    expect(ovenTemperaturesF("Preheat to 375°F. Then raise to 425 degrees F.")).toEqual([375, 425]);
  });
});

describe("checkConsistency", () => {
  it("accepts a consistent recipe", () => {
    expect(checkConsistency(muffins).filter((i) => i.severity === "blocking")).toEqual([]);
  });

  it("blocks a listed ingredient the steps never use", () => {
    const recipe = { ...muffins, ingredients: [...muffins.ingredients, ing("vanilla extract", "1", "tsp")] };
    expect(checkConsistency(recipe)).toContainEqual(expect.objectContaining({ severity: "blocking", message: expect.stringContaining("vanilla extract") }));
  });

  it("only warns when the steps refer to ingredients as a group", () => {
    const recipe = {
      ...muffins,
      ingredients: [...muffins.ingredients, ing("vanilla extract", "1", "tsp")],
      instructions: [...muffins.instructions, step("Stir in the remaining ingredients.")],
    };
    const vanilla = checkConsistency(recipe).find((i) => i.message.includes("vanilla"));
    expect(vanilla?.severity).toBe("warning");
  });

  it("blocks a step that uses an unlisted ingredient", () => {
    const recipe = { ...muffins, instructions: [...muffins.instructions, step("Sprinkle with cinnamon before baking.")] };
    expect(checkConsistency(recipe)).toContainEqual(expect.objectContaining({ severity: "blocking", message: expect.stringContaining("cinnamon") }));
  });

  it("blocks steps that cook far longer than the stated cook time", () => {
    expect(checkConsistency({ ...muffins, cook_time: 5 })).toContainEqual(expect.objectContaining({ severity: "blocking", field: "cook_time" }));
    expect(checkConsistency({ ...muffins, cook_time: 0 })).toContainEqual(expect.objectContaining({ severity: "blocking", field: "cook_time" }));
  });

  it("blocks an oven recipe without a temperature, and unrealistic temperatures", () => {
    const noTemp = { ...muffins, instructions: [step("Preheat the oven."), ...muffins.instructions.slice(1)] };
    expect(checkConsistency(noTemp)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("never states the temperature") }));
    const tooHot = { ...muffins, instructions: [step("Preheat the oven to 750°F."), ...muffins.instructions.slice(1)] };
    expect(checkConsistency(tooHot)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("750°F") }));
  });

  it("requires a safe internal temperature for poultry", () => {
    const chicken = {
      prep_time: 10,
      cook_time: 25,
      servings: 4,
      ingredients: [ing("boneless skinless chicken thighs", "1 1/2", "pounds"), ing("olive oil", "1", "tbsp"), ing("kosher salt", "1", "tsp")],
      instructions: [step("Season the chicken with salt."), step("Heat the oil and cook the chicken for 6 to 7 minutes per side.")],
    };
    expect(checkConsistency(chicken)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("165°F") }));
    const safe = {
      ...chicken,
      instructions: [...chicken.instructions, step("It is done when it reaches 165°F on an instant-read thermometer.")],
    };
    expect(checkConsistency(safe).filter((i) => i.severity === "blocking")).toEqual([]);
  });
});

describe("cost tracking", () => {
  it("prices a Claude Opus 5.5 request", () => {
    // 6,000 input at $4/M + 8,000 output at $20/M = $0.024 + $0.16
    expect(textCostUsd("claude-opus-5-5", { input_tokens: 6000, output_tokens: 8000 })).toBe(0.184);
  });

  it("includes cache reads and writes", () => {
    expect(
      textCostUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000 }),
    ).toBe(0.016);
  });

  it("refuses to price an unknown model", () => {
    expect(() => textCostUsd("some-other-model", { input_tokens: 1, output_tokens: 1 })).toThrow(UnknownPriceError);
  });

  it("enforces the daily limit before a call", () => {
    const estimate = estimateTextCostUsd("claude-opus-5-5", 8000, 16000);
    expect(estimate).toBe(0.352);
    expect(() => assertWithinBudget(1.0, estimate, 3)).not.toThrow();
    expect(() => assertWithinBudget(2.8, estimate, 3)).toThrow(BudgetExceededError);
    expect(() => assertWithinBudget(0, estimate, 0)).toThrow(BudgetExceededError);
  });
});

describe("keyword choice", () => {
  it("strips words every keyword shares", () => {
    expect(keywordCore("Easy Gluten-Free Zucchini Bread Recipe")).toBe("zucchini bread");
    expect(keywordCore("How to make GF pancakes")).toBe("pancakes");
  });

  it("ranks demand per unit of difficulty", () => {
    expect(opportunityScore(1000, 10)).toBe(50);
    expect(opportunityScore(900, 30)).toBe(22.5);
    expect(opportunityScore(1000, null)).toBeCloseTo(16.667);
    expect(opportunityScore(null, 5)).toBeNull();
  });

  it("flags keywords that would compete with each other", () => {
    expect(keywordSimilarity("gluten free lemon bars recipe", "gluten free lemon bars")).toBe(1);
    expect(keywordSimilarity("gluten-free chocolate chip cookies", "gluten free chocolate cookies")).toBeGreaterThan(0.5);
    expect(keywordSimilarity("gluten free zucchini bread", "gluten-free banana bread")).toBeLessThan(0.5);
  });
});
