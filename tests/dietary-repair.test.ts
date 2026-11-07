// Minor pork-free / alcohol-free problems are corrected before a recipe is
// given up on, consistently across every section, and the full checks and the
// independent review run again on the corrected recipe. Genuine problems
// (pork, wine, "regular soy sauce", a sentence about avoiding an ingredient)
// still go to the bounded AI repair, and nothing prohibited is ever saved.

import { describe, expect, it, vi } from "vitest";
import { automationDb, fakeImages, fakeProviders, fakeSite, goodRecipe } from "./support/automation-fixtures";
import { analyzeDietaryRestrictions } from "@/lib/recipes/dietary";
import { repairHint, repairMinorDietaryIssues, sameIngredient, swapExtracts } from "@/lib/recipes/dietary-repair";
import { validateGeneratedRecipe } from "@/lib/automation/validate";
import { WRITER_SYSTEM } from "@/lib/automation/providers/prompts";
import type { GeneratedRecipe, Issue, RepairInput } from "@/lib/automation/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe, MAX_REPAIR_ROUNDS, sameProblems } = await import("@/lib/automation/pipeline");

const NOW = new Date("2026-11-07T02:00:00Z");
const OATMEAL_KEYWORD = "gluten free baked oatmeal with fresh peaches";
const KEYWORD = { id: "kw-1", keyword: OATMEAL_KEYWORD, category_id: null, search_volume: null, keyword_difficulty: null };
const CATEGORIES = [{ id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking" }];

/** A recipe like the one the November 7 run produced: compliant except for the vanilla. */
function oatmeal(overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return goodRecipe({
    title: "Gluten-Free Baked Oatmeal with Fresh Peaches",
    slug: "gluten-free-baked-oatmeal-fresh-peaches",
    description: "A soft, sliceable gluten-free baked oatmeal with juicy fresh peaches and warm cinnamon, ready for a make-ahead breakfast.",
    introduction:
      "This gluten-free baked oatmeal with fresh peaches sets into soft squares that hold together for breakfast all week. Certified gluten-free oats soak in milk while the oven heats, so they bake up tender instead of chewy.\n\n" +
      "Ripe peaches release juice as they bake; slicing them thick keeps them from turning mushy. A little maple syrup sweetens the oats without hiding the fruit, and cinnamon rounds out the flavor. Check that your oats and baking powder are labeled gluten-free.",
    ingredients: [
      { amount: "2", unit: "cups", name: "certified gluten-free rolled oats", note: "", metric: "180 g" },
      { amount: "1", unit: "tsp", name: "baking powder", note: "labeled gluten-free" },
      { amount: "1", unit: "tsp", name: "ground cinnamon" },
      { amount: "1/4", unit: "tsp", name: "kosher salt" },
      { amount: "1 3/4", unit: "cups", name: "whole milk" },
      { amount: "2", name: "large eggs" },
      { amount: "1/3", unit: "cup", name: "pure maple syrup" },
      { amount: "1", unit: "tsp", name: "pure vanilla extract" },
      { amount: "3", name: "ripe peaches", note: "sliced" },
    ],
    instructions: [
      { text: "Preheat the oven to 375°F and grease an 8-inch square baking dish." },
      { text: "Stir the oats, baking powder, cinnamon and salt together in a large bowl." },
      { text: "Whisk the milk, eggs, maple syrup and vanilla extract, pour over the oats and rest for 10 minutes." },
      { text: "Spread half the oats in the dish, add half the peaches, then the rest of the oats and peaches." },
      { text: "Bake for 35 to 40 minutes, until the center is set." },
    ],
    prep_time: 15,
    cook_time: 40,
    servings: 8,
    yield_description: "8 squares",
    tips: ["Use ripe but firm peaches so the slices hold their shape."],
    substitutions: [
      { original: "whole milk", substitute: "unsweetened oat milk", note: "Choose one labeled gluten-free." },
      { original: "ripe peaches", substitute: "frozen peach slices", note: "Thaw and pat dry first." },
      { original: "pure maple syrup", substitute: "honey", note: "Slightly sweeter." },
      { original: "vanilla extract", substitute: "1/2 teaspoon vanilla powder", note: "Gives the same warm flavor." },
    ],
    faq: [
      { question: "Can I make it ahead?", answer: "Yes. Bake it, cool it and refrigerate it for up to 4 days." },
      { question: "Can I use canned peaches?", answer: "Yes, drained well and packed in juice, not syrup." },
      { question: "Why rest the oats?", answer: "Resting lets the oats absorb the milk so they bake up tender." },
      { question: "Can I freeze it?", answer: "Freeze cooled squares for up to 3 months and reheat in the microwave." },
    ],
    seo_title: "Gluten-Free Baked Oatmeal with Fresh Peaches",
    seo_description: "Soft gluten-free baked oatmeal with fresh peaches, cinnamon and maple syrup. An easy make-ahead breakfast that slices into neat squares all week.",
    focus_keyword: OATMEAL_KEYWORD,
    allergens: ["milk", "eggs"],
    image_alt: "Squares of baked oatmeal with golden peach slices in a white baking dish",
    image_brief: "An 8-inch square dish of golden baked oatmeal topped with peach slices, one square lifted out beside it, soft daylight.",
    ...overrides,
  });
}

const blockers = (recipe: GeneratedRecipe) => validateGeneratedRecipe(recipe, KEYWORD, CATEGORIES).filter((i) => i.severity === "blocking");

function run(ai: ReturnType<typeof fakeProviders>, opts: Parameters<typeof automationDb>[0] = {}) {
  const { db, data } = automationDb({ keywords: [{ ...KEYWORD, status: "new" }], ...opts });
  const result = runDailyRecipe({ db, providers: ai.providers, images: fakeImages().store, site: fakeSite().site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW });
  return { result, data };
}

describe("the November 7 recipe", () => {
  it("only failed on the ordinary vanilla extract", () => {
    const problems = blockers(oatmeal());
    expect(problems.map((b) => b.field)).toEqual(["ingredients[7]", "instructions[2]", "substitutions[3]"]);
    expect(problems.every((b) => b.source === "dietary" && /vanilla extract/.test(b.message))).toBe(true);
  });

  it("is corrected in code consistently across every section", () => {
    const { recipe, fixes } = repairMinorDietaryIssues(oatmeal());
    expect(recipe.ingredients[7]).toMatchObject({ amount: "1", unit: "tsp", name: "alcohol-free vanilla flavoring", note: "labeled alcohol-free" });
    expect(recipe.instructions[2].text).toBe("Whisk the milk, eggs, maple syrup and alcohol-free vanilla flavoring, pour over the oats and rest for 10 minutes.");
    // The substitution names the recipe's own (corrected) ingredient, with the label check.
    expect(recipe.substitutions[3]).toMatchObject({ original: "alcohol-free vanilla flavoring (labeled alcohol-free)", substitute: "1/2 teaspoon vanilla powder" });
    expect(fixes.map((f) => f.field)).toEqual(["ingredients[7]", "instructions[2]", "substitutions[3]", "substitutions[3]"]);
    // Nothing else changed: quantities, times and the other sections are the same.
    expect({ ...recipe, ingredients: [], instructions: [], substitutions: [] }).toEqual({ ...oatmeal(), ingredients: [], instructions: [], substitutions: [] });
    expect(recipe.ingredients.map((i) => i.amount)).toEqual(oatmeal().ingredients.map((i) => i.amount));
    expect(analyzeDietaryRestrictions(recipe)).toEqual([]);
    expect(blockers(recipe)).toEqual([]);
  });

  it("is saved without an AI repair round, and the reviewer checks the corrected recipe", async () => {
    const ai = fakeProviders({ drafts: [oatmeal()] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded", slug: "gluten-free-baked-oatmeal-fresh-peaches" });
    expect([ai.writer.calls(), ai.repairer.calls(), ai.reviewer.calls()]).toEqual([1, 0, 1]);
    expect(JSON.stringify(ai.reviewer.inputs[0])).not.toMatch(/vanilla extract/);
    const saved = data.recipes[0] as unknown as GeneratedRecipe;
    expect(JSON.stringify(saved)).not.toMatch(/vanilla extract/);
    expect(analyzeDietaryRestrictions(saved)).toEqual([]);
    // The fixes are recorded on the attempt and in the job log.
    expect(data.generation_attempts[0].issues).toContainEqual(expect.objectContaining({ severity: "warning", source: "dietary", field: "substitutions[3]" }));
    expect(data.publishing_job_events).toContainEqual(expect.objectContaining({ step: "generate_recipe", status: "info", message: expect.stringContaining("Corrected 4 minor problem(s) in code") }));
  });

  it("no longer fails when the AI repair leaves the vanilla extract in one substitution", async () => {
    // What happened on November 7: the repaired draft still had it in substitutions[3].
    const firstDraft = oatmeal({ tips: ["Bake it in a shared toaster oven that also toasts wheat bread."] });
    const repaired = oatmeal();
    const ai = fakeProviders({ drafts: [firstDraft, repaired], reviewRounds: [[{ severity: "blocking", field: "tips[0]", message: "A shared toaster oven is a cross-contact risk.", kind: "safety" }], []] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(1);
    expect(JSON.stringify(data.recipes[0])).not.toMatch(/vanilla extract/);
  });
});

describe("extracts and flavorings", () => {
  it("swaps alcohol-based vanilla extract for an alcohol-free flavoring, keeping the amount", () => {
    expect(swapExtracts("1 tsp vanilla extract").text).toBe("1 tsp alcohol-free vanilla flavoring");
    expect(swapExtracts("Pure vanilla extract").text).toBe("Alcohol-free vanilla flavoring");
    expect(swapExtracts("1/2 tsp almond extract").text).toBe("1/2 tsp alcohol-free almond flavoring");
    expect(swapExtracts("1 tsp vanilla bean paste").text).toBe("1 tsp alcohol-free vanilla flavoring");
  });

  it("leaves alcohol-free vanilla flavoring and vanilla powder alone", () => {
    for (const text of ["1 tsp alcohol-free vanilla flavoring, labeled alcohol-free", "1 tsp glycerin-based vanilla extract", "1 tsp vanilla powder", "1 vanilla bean, seeds scraped"]) {
      expect(swapExtracts(text)).toEqual({ text, swaps: [], skipped: false });
    }
    const compliant = oatmeal({
      ingredients: oatmeal().ingredients.map((i, n) => (n === 7 ? { ...i, name: "alcohol-free vanilla flavoring", note: "labeled alcohol-free" } : i)),
      instructions: oatmeal().instructions.map((s, n) => (n === 2 ? { text: "Whisk the milk, eggs, maple syrup and alcohol-free vanilla flavoring, pour over the oats and rest for 10 minutes." } : s)),
      substitutions: oatmeal().substitutions.slice(0, 3),
    });
    expect(blockers(compliant)).toEqual([]);
    expect(repairMinorDietaryIssues(compliant)).toEqual({ recipe: compliant, fixes: [] });
  });

  it("adds the missing label check to an alcohol-free product in a suggestion", () => {
    const recipe = oatmeal({ faq: [...oatmeal().faq.slice(0, 3), { question: "Can I add almond?", answer: "Add 1/4 tsp alcohol-free almond extract with the vanilla." }] });
    const { recipe: fixed } = repairMinorDietaryIssues(recipe);
    expect(fixed.faq[3].answer).toBe("Add 1/4 tsp alcohol-free almond extract (labeled alcohol-free) with the vanilla.");
  });

  it("points other sections at the vanilla the ingredient list uses", () => {
    const recipe = oatmeal({ ingredients: oatmeal().ingredients.map((i, n) => (n === 7 ? { ...i, name: "vanilla powder", amount: "1/2" } : i)) });
    const { recipe: fixed } = repairMinorDietaryIssues(recipe);
    expect(fixed.instructions[2].text).toContain("maple syrup and vanilla powder");
    // "vanilla extract -> vanilla powder" became "vanilla powder -> vanilla powder": it is removed.
    expect(fixed.substitutions).toHaveLength(3);
    expect(blockers(fixed)).toEqual([]);
  });

  it("does not swap a mention in a sentence about avoiding it; the AI repair rewrites that", () => {
    const tip = "Instead of vanilla extract, use vanilla powder.";
    expect(swapExtracts(tip)).toMatchObject({ text: tip, skipped: true });
    expect(swapExtracts("Vanilla extract contains alcohol, so use vanilla powder.").skipped).toBe(true);
    const { recipe } = repairMinorDietaryIssues(oatmeal({ tips: [tip] }));
    expect(recipe.tips[0]).toBe(tip);
    expect(blockers(recipe)).toContainEqual(expect.objectContaining({ field: "tips[0]", source: "dietary" }));
  });

  it("does not swap rum, brandy or bourbon flavorings in code", () => {
    expect(swapExtracts("1 tsp rum extract").swaps).toEqual([]);
    expect(blockers(repairMinorDietaryIssues(oatmeal({ tips: ["Add 1/2 tsp rum extract."] })).recipe)).toContainEqual(expect.objectContaining({ field: "tips[0]" }));
  });
});

describe("pork-derived ingredients are never swapped in code", () => {
  const withBacon = () =>
    oatmeal({
      ingredients: [...oatmeal().ingredients.slice(0, 7), { amount: "1", unit: "tsp", name: "alcohol-free vanilla flavoring", note: "labeled alcohol-free" }, oatmeal().ingredients[8], { amount: "4", unit: "slices", name: "bacon" }],
      instructions: [...oatmeal().instructions.slice(0, 4).map((s, n) => (n === 2 ? { text: "Whisk the milk, eggs, maple syrup and alcohol-free vanilla flavoring, pour over the oats and rest for 10 minutes." } : s)), { text: "Top with the crumbled bacon and bake for 35 to 40 minutes, until the center is set." }],
      substitutions: oatmeal().substitutions.slice(0, 3),
    });

  it("leaves bacon for the AI repair, with a pork-free suggestion", () => {
    const { recipe, fixes } = repairMinorDietaryIssues(withBacon());
    expect(fixes).toEqual([]);
    const problems = blockers(recipe).filter((b) => b.source === "dietary");
    expect(problems.map((b) => b.field)).toEqual(["ingredients[9]", "instructions[4]"]);
    expect(problems[0].hint).toMatch(/turkey bacon, labeled gluten-free.*165°F/);
  });

  it("sends bacon to the repairer with the suggestion, then saves the pork-free repair", async () => {
    const ai = fakeProviders({ drafts: [withBacon(), oatmeal()] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    const issues = (ai.repairer.inputs[0] as RepairInput).issues;
    expect(issues).toContainEqual(expect.objectContaining({ field: "ingredients[9]", hint: expect.stringMatching(/turkey bacon/) }));
    expect(JSON.stringify(data.recipes[0])).not.toMatch(/\bbacon\b|vanilla extract/);
  });

  it("gives other pork and alcohol problems a compliant suggestion", () => {
    expect(repairHint("alcohol", "wine")).toMatch(/broth labeled gluten-free/);
    expect(repairHint("alcohol", "rice wine")).toMatch(/broth labeled gluten-free/);
    expect(repairHint("alcohol", "alcohol-based extract")).toMatch(/alcohol-free vanilla flavoring.*vanilla powder/);
    expect(repairHint("pork", "ham")).toMatch(/turkey/);
    expect(repairHint("pork", "pork-derived gelatin")).toMatch(/agar-agar/);
    expect(repairHint("pork", "lard")).toMatch(/butter/);
    expect(repairHint("condiment", "soy sauce")).toMatch(/tamari, labeled gluten-free and alcohol-free/);
  });

  it("leaves cooking wine for the AI repair", () => {
    const recipe = oatmeal({ tips: ["Poach the peaches in 1/2 cup cooking wine first."] });
    const out = repairMinorDietaryIssues(recipe);
    expect(out.recipe.tips[0]).toBe(recipe.tips[0]);
    expect(blockers(out.recipe)).toContainEqual(expect.objectContaining({ field: "tips[0]", hint: expect.stringMatching(/broth/) }));
  });
});

describe("gluten-containing sauces", () => {
  const sauce = (name: string, note = "") =>
    oatmeal({
      ingredients: [...oatmeal().ingredients.slice(0, 7), { amount: "1", unit: "tsp", name: "vanilla powder" }, oatmeal().ingredients[8], { amount: "1", unit: "tsp", name, note }],
      instructions: oatmeal().instructions.map((s, n) => (n === 2 ? { text: `Whisk the milk, eggs, maple syrup, vanilla powder and ${name}, pour over the oats and rest for 10 minutes.` } : s)),
      substitutions: oatmeal().substitutions.slice(0, 3),
      allergens: ["milk", "eggs", "soy"],
    });

  it("adds the gluten-free and alcohol-free label to soy sauce and tamari", () => {
    for (const [name, note] of [["soy sauce", ""], ["tamari", "labeled gluten-free"]]) {
      const before = sauce(name, note);
      expect(blockers(before).some((b) => b.source === "dietary")).toBe(true);
      const { recipe } = repairMinorDietaryIssues(before);
      expect(recipe.ingredients[9].note).toBe("labeled gluten-free and alcohol-free");
      expect(blockers(recipe)).toEqual([]);
    }
  });

  it("never fixes 'regular soy sauce' in code: the AI repair replaces it", () => {
    const before = sauce("regular soy sauce");
    const { recipe, fixes } = repairMinorDietaryIssues(before);
    expect(fixes).toEqual([]);
    expect(blockers(recipe)).toContainEqual(expect.objectContaining({ field: "ingredients[9]", source: "dietary", hint: expect.stringMatching(/tamari/) }));
  });

  it("does not label soy sauce in a sentence about avoiding it", () => {
    const tip = "Do not use soy sauce here; it usually contains wheat.";
    const { recipe } = repairMinorDietaryIssues(oatmeal({ tips: [tip] }));
    expect(recipe.tips[0]).toBe(tip);
  });
});

describe("consistency between sections", () => {
  it("treats amounts and label notes as the same ingredient", () => {
    expect(sameIngredient("vanilla powder", "1/2 teaspoon vanilla powder")).toBe(true);
    expect(sameIngredient("alcohol-free vanilla flavoring (labeled alcohol-free)", "alcohol-free vanilla flavoring")).toBe(true);
    expect(sameIngredient("whole milk", "unsweetened oat milk")).toBe(false);
  });

  it("rejects a substitution that swaps an ingredient for itself", () => {
    const recipe = oatmeal({ substitutions: [{ original: "whole milk", substitute: "Whole milk", note: "" }] });
    expect(blockers(repairMinorDietaryIssues(recipe).recipe)).toContainEqual(expect.objectContaining({ source: "consistency", field: "substitutions[0]" }));
  });

  it("keeps the ingredient name used in the steps in step with the list", () => {
    const { recipe } = repairMinorDietaryIssues(oatmeal());
    const listed = recipe.ingredients[7].name;
    expect(recipe.instructions[2].text).toContain(listed);
    expect(recipe.substitutions[3].original).toContain(listed);
  });

  it("tells the writer to name a substitution's original as the list does", () => {
    expect(WRITER_SYSTEM).toMatch(/A substitution's "original" is an ingredient from your own list/);
    expect(WRITER_SYSTEM).toMatch(/alcohol-free vanilla flavoring/);
  });
});

describe("bounded repair", () => {
  const extraBlocker = (field: string, message: string): Issue[] => [{ severity: "blocking", source: "review", field, message }];

  it("allows at most two AI repair rounds", () => {
    expect(MAX_REPAIR_ROUNDS).toBe(2);
  });

  it("tries a second round when the first repair fixed something but left a different problem", async () => {
    const ai = fakeProviders({
      drafts: [oatmeal(), oatmeal(), oatmeal()],
      reviewRounds: [
        [{ severity: "blocking", field: "ingredients[4]", message: "Quantity of milk is too high.", kind: "accuracy" }],
        [{ severity: "blocking", field: "instructions[4]", message: "Bake time is too short.", kind: "accuracy" }],
        [],
      ],
    });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(2);
    expect(data.publishing_job_events).toContainEqual(expect.objectContaining({ message: expect.stringContaining("Repair round 2 of 2") }));
  });

  it("stops after two repair rounds, never loops, and saves nothing", async () => {
    const ai = fakeProviders({
      drafts: [oatmeal()],
      reviewRounds: [
        [{ severity: "blocking", field: "ingredients[4]", message: "Problem A.", kind: "accuracy" }],
        [{ severity: "blocking", field: "ingredients[4]", message: "Problem B.", kind: "accuracy" }],
        [{ severity: "blocking", field: "ingredients[4]", message: "Problem C.", kind: "accuracy" }],
        [{ severity: "blocking", field: "ingredients[4]", message: "Problem D.", kind: "accuracy" }],
      ],
    });
    const { result, data } = run(ai);
    const out = await result;
    expect(out).toMatchObject({ status: "failed" });
    expect(out.status === "failed" && out.error).toMatch(/after 2 repair round\(s\).*No repair rounds left/);
    expect([ai.writer.calls(), ai.repairer.calls(), ai.reviewer.calls()]).toEqual([1, 2, 3]);
    expect(data.recipes).toHaveLength(0);
  });

  it("does not try a second round when the repair left exactly the same problems", async () => {
    const same = { severity: "blocking" as const, field: "ingredients[4]", message: "Quantity of milk is too high.", kind: "accuracy" as const };
    const ai = fakeProviders({ drafts: [oatmeal()], reviewRounds: [[same], [same]] });
    const { result } = run(ai);
    const out = await result;
    expect(out.status === "failed" && out.error).toMatch(/exactly the same problems/);
    expect(ai.repairer.calls()).toBe(1);
  });

  it("does not try a second round the daily budget cannot cover with the photo", async () => {
    const ai = fakeProviders({
      drafts: [oatmeal()],
      reviewRounds: [[{ severity: "blocking", field: "ingredients[4]", message: "Problem A.", kind: "accuracy" }], [{ severity: "blocking", field: "ingredients[4]", message: "Problem B.", kind: "accuracy" }]],
    });
    // $3 limit, $2.10 spent earlier today: writer + review + repair + review leave about $0.30, less than another round and a photo.
    const { result } = run(ai, { spent: 2.1 });
    const out = await result;
    expect(out.status === "failed" && out.error).toMatch(/Another repair round was not tried.*daily budget/);
    expect(ai.repairer.calls()).toBe(1);
  });

  it("compares problems by field and message", () => {
    expect(sameProblems(extraBlocker("a", "x"), extraBlocker("a", "x"))).toBe(true);
    expect(sameProblems(extraBlocker("a", "x"), extraBlocker("a", "y"))).toBe(false);
  });
});

describe("never publishes prohibited ingredients", () => {
  it("fails without saving when every repair still contains pork", async () => {
    const bacon = oatmeal({ tips: ["Top each square with crumbled bacon."] });
    const ai = fakeProviders({ drafts: [bacon, bacon, bacon] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "failed" });
    expect(data.recipes).toHaveLength(0);
  });

  it("does not change recipes that are already published", async () => {
    const published = { id: "pub-1", title: "Old Vanilla Cake", slug: "old-vanilla-cake", source: "ai", status: "published", ingredients: [{ amount: "1", unit: "tsp", name: "pure vanilla extract" }] };
    const ai = fakeProviders({ drafts: [oatmeal()] });
    const { result, data } = run(ai, { recipes: [{ ...published }] });
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(data.recipes.find((r) => r.id === "pub-1")).toEqual(published);
  });
});
