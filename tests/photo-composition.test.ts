// Regression tests for the Nov 18, 2026 failure (job c02a5e33): three photos of
// "gluten free black bean sweet potato quesadillas" were all rejected as an
// unrealistic stack of tortillas, because every retry resent the same prompt.
import { describe, expect, it } from "vitest";
import { compositionCorrections, dishStyle, photoPlan, simplifyLevel } from "@/lib/automation/photo-composition";
import { imagePrompt, imagePromptVersion } from "@/lib/automation/providers/openai-images";
import { photoCheckPrompt } from "@/lib/automation/providers/anthropic";
import { PHOTO_CHECK_SYSTEM, WRITER_SYSTEM } from "@/lib/automation/providers/prompts";
import { goodRecipe } from "./support/automation-fixtures";

const quesadillas = () =>
  goodRecipe({
    title: "Gluten-Free Black Bean Sweet Potato Quesadillas",
    slug: "gluten-free-black-bean-sweet-potato-quesadillas",
    image_brief:
      "A tall stack of golden quesadillas layered on a wooden board, cheese oozing between the tortillas, with bowls of salsa, lime wedges and cilantro around it.",
    ingredients: [
      { amount: "8", name: "corn tortillas", note: "labeled gluten-free" },
      { amount: "1", name: "sweet potato", note: "roasted and mashed" },
      { amount: "1", unit: "can", name: "black beans", note: "rinsed" },
      { amount: "1", unit: "cup", name: "shredded Monterey Jack cheese" },
      { amount: "1", unit: "tsp", name: "ground cumin" },
    ],
  });

// What the checker said on Nov 18, in substance, attempt after attempt.
const STACK_PROBLEMS = [
  ["Unrealistic tall stack of whole tortillas that could not physically stand."],
  ["Tortillas are stacked into an implausible tower."],
  ["Still shows an unrealistic stack of tortillas."],
];

describe("photo composition: dish styles", () => {
  it("plates quesadillas as two or three wedges, never a stack of whole tortillas", () => {
    expect(dishStyle(quesadillas())?.name).toBe("quesadilla");
    const [first, second, third] = [1, 2, 3].map((a) => photoPlan(quesadillas(), a).plating);
    expect(first).toMatch(/three wedges/);
    expect(second).toMatch(/two or three wedges/);
    expect(third).toMatch(/two wedges/);
    for (const p of [first, second, third]) expect(p).toMatch(/lying flat/);
  });

  it("does not treat other forms of a dish as handheld pieces", () => {
    expect(dishStyle({ title: "Gluten-Free Quesadilla Casserole" })).toBeUndefined();
    expect(dishStyle({ title: "Gluten-Free Taco Soup" })).toBeUndefined();
    expect(dishStyle({ title: "Gluten-Free Burrito Bowl" })).toBeUndefined();
    expect(dishStyle({ title: "Chicken Lettuce Wraps" })).toBeUndefined();
    expect(dishStyle({ title: "Gluten-Free Fish Tacos" })?.name).toBe("tacos");
    expect(dishStyle({ title: "Gluten-Free Taco Pizza" })?.name).toBe("flat bake");
    expect(dishStyle({ title: "Gluten-Free Pizza Quesadillas" })?.name).toBe("quesadilla");
  });

  it("keeps a plain default for other dishes", () => {
    expect(dishStyle({ title: "Sweet Potato Breakfast Hash" })).toBeUndefined();
    expect(photoPlan({ title: "Sweet Potato Breakfast Hash" }, 1).plating).toMatch(/one natural serving/);
  });
});

describe("photo composition: each retry is simpler", () => {
  it("moves from the normal shot to simpler and then simplest", () => {
    expect([1, 2, 3, 4].map(simplifyLevel)).toEqual([0, 1, 2, 2]);
    const plans = [1, 2, 3].map((a) => photoPlan(quesadillas(), a));
    expect(plans.map((p) => p.useBrief)).toEqual([true, false, false]);
    expect(plans[0].scene.join(" ")).toMatch(/at most two plain props/);
    expect(plans[1].scene.join(" ")).toMatch(/at most one plain prop/);
    expect(plans[2].scene.join(" ")).toMatch(/no props, no garnish/);
  });

  it("drops the writer's brief after the first attempt, so a stacked brief is not resent", () => {
    const recipe = quesadillas();
    const first = imagePrompt({ recipe, orientation: "landscape", attempt: 1 });
    const second = imagePrompt({ recipe, orientation: "landscape", attempt: 2, avoid: STACK_PROBLEMS[0] });
    const third = imagePrompt({ recipe, orientation: "landscape", attempt: 3, avoid: STACK_PROBLEMS.slice(0, 2).flat() });
    expect(first).toContain(recipe.image_brief);
    expect(second).not.toContain(recipe.image_brief);
    expect(third).not.toContain(recipe.image_brief);
    // Three different prompts: a retry never repeats the rejected one.
    expect(new Set([first, second, third]).size).toBe(3);
    // Even on the first attempt, the wedge plating wins over the brief's stack.
    expect(first).toMatch(/three wedges cut from one quesadilla.*This plating wins over any other arrangement/);
  });

  it("turns a repeated stacking complaint into a positive instruction to lay pieces flat", () => {
    const second = imagePrompt({ recipe: quesadillas(), orientation: "landscape", attempt: 2, avoid: STACK_PROBLEMS[0] });
    expect(second).toMatch(/To fix that, this time: Lay every piece flat on the plate/);
    const third = imagePrompt({ recipe: quesadillas(), orientation: "landscape", attempt: 3, avoid: STACK_PROBLEMS.slice(0, 2).flat() });
    expect(third).toMatch(/Lay every piece flat/);
    expect(third).toMatch(/fewer, simpler pieces/);
    expect(third).toMatch(/two wedges cut from one quesadilla/);
    expect(third).toMatch(/no props, no garnish/);
  });

  it("maps common checker complaints to fixes, without repeats", () => {
    expect(compositionCorrections(["Stacked tortillas.", "Tall stack."])).toHaveLength(1);
    expect(compositionCorrections(["A fork is merged into the food.", "Busy props."])).toEqual([
      "Use fewer, simpler pieces, each with clean, natural edges and a believable shape.",
      "Nothing around the plate: no props, no loose ingredients, no extra garnish.",
      "No utensils anywhere in the frame.",
    ]);
    expect(compositionCorrections(["Shows a wheat bagel."])).toEqual([]);
  });

  it("lets a quesadilla be cut into wedges but still forbids lifted or tilted pieces", () => {
    const prompt = imagePrompt({ recipe: quesadillas(), orientation: "landscape" });
    expect(prompt).not.toMatch(/Nothing folded, rolled, lifted, cut away/);
    expect(prompt).toMatch(/nothing lifted, peeled back or tilted/);
    // Dishes that are not served cut keep the original rule.
    expect(imagePrompt({ recipe: goodRecipe(), orientation: "landscape" })).toMatch(/Nothing folded, rolled, lifted, cut away or tilted/);
  });

  it("keeps the recipe's real ingredients and the safety rules on every attempt", () => {
    for (const attempt of [1, 2, 3]) {
      const prompt = imagePrompt({ recipe: quesadillas(), orientation: "landscape", attempt });
      for (const food of ["corn tortillas", "sweet potato", "black beans", "shredded Monterey Jack cheese", "ground cumin"]) expect(prompt).toContain(food);
      expect(prompt).toMatch(/No people, no hands, no text/);
      expect(prompt).toMatch(/No bread, pasta, crackers or pastries that are not part of this recipe/);
      expect(prompt).toMatch(/no melted cheese, sauce or toppings that are not in the ingredient list/);
    }
  });

  it("logs which simplification level each photo used", () => {
    expect([1, 2, 3].map(imagePromptVersion)).toEqual(["photo-v3-s0", "photo-v3-s1", "photo-v3-s2"]);
  });
});

describe("photo check stays strict", () => {
  it("still rejects wrong dishes, gluten foods, artifacts, and now unrealistic stacks", () => {
    expect(PHOTO_CHECK_SYSTEM).toMatch(/noticeably different dish/);
    expect(PHOTO_CHECK_SYSTEM).toMatch(/visibly contains gluten/);
    expect(PHOTO_CHECK_SYSTEM).toMatch(/impossible geometry/);
    expect(PHOTO_CHECK_SYSTEM).toMatch(/tall or leaning stack of whole tortillas/);
  });

  it("tells the checker which plating was asked for, while the dish and ingredients must still match", () => {
    const plating = photoPlan(quesadillas(), 2).plating;
    const prompt = photoCheckPrompt(quesadillas(), plating);
    expect(prompt).toContain(plating);
    expect(prompt).toMatch(/must still match the recipe/);
    expect(prompt).toContain("Ingredients: corn tortillas, sweet potato, black beans");
    expect(photoCheckPrompt(quesadillas())).not.toMatch(/Plating asked for/);
  });

  it("asks the recipe writer for natural portions instead of tall stacks", () => {
    expect(WRITER_SYSTEM).toMatch(/quesadillas as 2 or 3 wedges/);
    expect(WRITER_SYSTEM).toMatch(/never a tall stack/);
  });
});
