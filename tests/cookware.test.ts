// Practical cookware wording: clean cookware and cast iron need no warning,
// genuine cross-contact precautions stay, and the false claim that heat,
// preheating or wiping removes gluten is repaired in code instead of failing
// the recipe. Gluten, pork and alcohol checks stay as strict as before.

import { describe, expect, it, vi } from "vitest";
import { automationDb, fakeImages, fakeProviders, fakeSite, goodRecipe } from "./support/automation-fixtures";
import { analyzeCookwareClaims, findGlutenRemovalClaims, isGlutenRemovalClaim, repairGlutenRemovalClaims, repairGlutenRemovalText } from "@/lib/recipes/cookware";
import { validateGeneratedRecipe } from "@/lib/automation/validate";
import { applyWordingFixes, parseProseField } from "@/lib/automation/wording";
import { REVIEWER_SYSTEM, REVIEW_JSON_SCHEMA, WRITER_SYSTEM, PROMPT_VERSION } from "@/lib/automation/providers/prompts";
import type { ReviewIssue } from "@/lib/automation/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe, MAX_REPAIR_ROUNDS } = await import("@/lib/automation/pipeline");
const { MAX_JOB_RETRIES } = await import("@/lib/services/jobs");

const NOW = new Date("2026-11-06T02:00:00Z");
const KEYWORD = { id: "kw-1", keyword: "gluten free blueberry muffins", category_id: null, search_volume: null, keyword_difficulty: null };
const CATEGORIES = [{ id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking" }];

const blockers = (recipe = goodRecipe()) => validateGeneratedRecipe(recipe, KEYWORD, CATEGORIES).filter((i) => i.severity === "blocking");

function run(ai = fakeProviders()) {
  const { db, data } = automationDb();
  const result = runDailyRecipe({ db, providers: ai.providers, images: fakeImages().store, site: fakeSite().site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW });
  return { result, data, ai };
}

describe("clean cookware", () => {
  it.each([
    "Heat a clean skillet over medium heat.",
    "Heat a large nonstick skillet over medium-high heat and add the oil.",
    "Preheat the oven to 400°F and line a sheet pan with parchment.",
    "Heat the oil in a heavy pot until it reaches 350°F.",
  ])("needs no warning and is never flagged: %s", (text) => {
    expect(isGlutenRemovalClaim(text)).toBe(false);
    expect(repairGlutenRemovalText(text)).toEqual({ text, removed: [] });
  });

  it("passes every code check without a cookware tip", () => {
    const recipe = goodRecipe({ tips: ["Rest the batter for 10 minutes so the rice flour hydrates."] });
    expect(blockers(recipe)).toEqual([]);
    expect(analyzeCookwareClaims(recipe)).toEqual([]);
  });
});

describe("cast iron", () => {
  it.each([
    "Heat a 12-inch cast-iron skillet over medium-high heat.",
    "A well-seasoned cast-iron skillet gives the sweet potatoes the crispiest edges.",
    "Heat a clean cast-iron skillet over medium heat, then add the turkey sausage.",
  ])("is treated as ordinary clean cookware: %s", (text) => {
    expect(findGlutenRemovalClaims("instructions[0]", text)).toEqual([]);
    const recipe = goodRecipe({ instructions: [{ text: `${text} Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners.` }, ...goodRecipe().instructions.slice(1)] });
    expect(blockers(recipe).filter((b) => b.source === "cookware")).toEqual([]);
  });
});

describe("genuine cross-contact precautions are kept", () => {
  it.each([
    "Use fresh oil in a clean pot; never use a shared fryer that has cooked breaded foods.",
    "Use a dedicated toaster or toaster bags, because a shared toaster holds wheat crumbs.",
    "Wash any board or bowl dusted with wheat flour before using it for this batter.",
    "Wooden spoons and scratched nonstick pans are hard to clean, so use separate ones if they are also used for wheat foods.",
    "Heat does not destroy gluten, so wash shared pans thoroughly with hot soapy water.",
    "Wiping and preheating does not remove gluten.",
    "No amount of heat will remove gluten from a shared pan.",
    "Scrub the skillet with hot soapy water to remove any gluten.",
  ])("is not flagged or rewritten: %s", (text) => {
    expect(isGlutenRemovalClaim(text)).toBe(false);
    const recipe = goodRecipe({ tips: [text] });
    expect(repairGlutenRemovalClaims(recipe)).toEqual({ recipe, repairs: [] });
  });
});

describe("claims that heat, preheating or wiping removes gluten", () => {
  it.each([
    "Wipe out the skillet and preheat it to remove any traces of gluten.",
    "Preheating the pan kills any gluten left behind.",
    "The high heat burns off any gluten residue.",
    "Heat destroys gluten, so a hot pan is safe.",
    "Seasoning the pan makes it gluten-free.",
    "If your cast iron is shared, wipe it clean and heat it well, which will burn off gluten.",
  ])("are detected: %s", (text) => {
    expect(isGlutenRemovalClaim(text)).toBe(true);
    expect(findGlutenRemovalClaims("tips[0]", text)).toHaveLength(1);
  });

  it("keeps the instruction and drops only the false explanation", () => {
    expect(repairGlutenRemovalText("Wipe out the skillet and preheat it to remove any traces of gluten.").text).toBe("Wipe out the skillet and preheat it.");
    expect(repairGlutenRemovalText("To kill any gluten, preheat the pan for 5 minutes.").text).toBe("Preheat the pan for 5 minutes.");
    expect(repairGlutenRemovalText("Heat a clean skillet over medium heat. The hot pan will destroy any gluten. Add the oil.").text).toBe(
      "Heat a clean skillet over medium heat. Add the oil.",
    );
  });

  it("drops advice about a shared pan whole instead of keeping half of it", () => {
    expect(repairGlutenRemovalText("If your cast iron is shared, wipe it clean and heat it well, which will burn off gluten.").text).toBe("");
  });

  it("repairs a recipe in code: steps keep their instruction, a claim-only tip is removed, ingredients never change", () => {
    const recipe = goodRecipe({
      instructions: [
        { text: "Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners, which will burn off any gluten left in the tin." },
        ...goodRecipe().instructions.slice(1),
      ],
      tips: ["Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact.", "Preheating the pan kills any gluten left behind."],
      faq: [...goodRecipe().faq.slice(0, 3), { question: "Is my old muffin tin OK?", answer: "Yes, if it is clean. Heat removes any gluten anyway, so just preheat it." }],
    });
    expect(blockers(recipe).filter((b) => b.source === "cookware").map((b) => b.field)).toEqual(["instructions[0]", "tips[1]", "faq[3].answer"]);

    const { recipe: fixed, repairs } = repairGlutenRemovalClaims(recipe);
    expect(fixed.instructions[0].text).toBe("Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners.");
    expect(fixed.tips).toEqual(["Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact."]);
    expect(fixed.faq[3].answer).toBe("Yes, if it is clean. Just preheat it.");
    expect(fixed.ingredients).toEqual(recipe.ingredients);
    expect(repairs.map((r) => r.field).sort()).toEqual(["faq[3].answer", "instructions[0]", "tips[1]"]);
    expect(blockers(fixed)).toEqual([]);
  });

  it("still blocks a claim it cannot remove cleanly, so the normal repair step rewrites it", () => {
    const recipe = goodRecipe({ instructions: [{ text: "Heat removes gluten." }, ...goodRecipe().instructions.slice(1)] });
    const { recipe: fixed } = repairGlutenRemovalClaims(recipe);
    expect(fixed.instructions[0].text).toBe("Heat removes gluten.");
    expect(blockers(fixed).some((b) => b.source === "cookware" && b.field === "instructions[0]")).toBe(true);
  });
});

describe("gluten, pork and alcohol checks stay strict", () => {
  it("a cookware repair never hides a gluten ingredient", () => {
    const recipe = goodRecipe({
      ingredients: [...goodRecipe().ingredients, { amount: "1", unit: "tbsp", name: "soy sauce" }],
      tips: ["Use new liners.", "Preheating the pan kills any gluten left behind."],
    });
    const { recipe: fixed } = repairGlutenRemovalClaims(recipe);
    expect(blockers(fixed).some((b) => /soy sauce/i.test(b.message) || b.field.startsWith("ingredients"))).toBe(true);
  });

  it("pork and alcohol stay blocked", () => {
    const pork = goodRecipe({ tips: ["Serve with crispy bacon."] });
    const wine = goodRecipe({ tips: ["Splash in a little white wine."] });
    expect(blockers(pork).some((b) => b.source === "dietary")).toBe(true);
    expect(blockers(wine).some((b) => b.source === "dietary")).toBe(true);
  });
});

describe("the reviewer's wording fixes", () => {
  const wording = (field: string, quote: string, replacement: string): ReviewIssue => ({ severity: "blocking", kind: "wording", field, message: "Misleading cookware wording.", quote, replacement });

  it("reads only prose fields", () => {
    expect(parseProseField("instructions[2]")).toEqual({ kind: "instruction", index: 2 });
    expect(parseProseField("faq[1].answer")).toEqual({ kind: "faq", index: 1, key: "answer" });
    expect(parseProseField("ingredients[0]")).toBeNull();
    expect(parseProseField("title")).toBeNull();
    expect(parseProseField("allergens")).toBeNull();
  });

  it("applies a blocking wording fix that quotes the exact text", () => {
    const issue = wording("tips[0]", "Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact.", "Use new paper liners.");
    const out = applyWordingFixes(goodRecipe(), [issue]);
    expect(out.recipe.tips[0]).toBe("Use new paper liners.");
    expect(out.applied).toEqual([issue]);
    expect(out.rest).toEqual([]);
  });

  it("never applies safety or accuracy issues, ingredient fields, or a quote it cannot find", () => {
    const issues: ReviewIssue[] = [
      { ...wording("ingredients[2]", "baking powder", "baking powder, labeled gluten-free"), kind: "wording" },
      { ...wording("tips[0]", "muffin tin", "pan"), kind: "safety" },
      { ...wording("tips[0]", "muffin tin", "pan"), kind: "accuracy" },
      wording("tips[0]", "this text is not in the tip", "x y z"),
      { ...wording("tips[0]", "muffin tin", "pan"), severity: "warning" },
    ];
    const out = applyWordingFixes(goodRecipe(), issues);
    expect(out.recipe).toEqual(goodRecipe());
    expect(out.applied).toEqual([]);
    expect(out.rest).toEqual(issues);
  });
});

describe("pipeline", () => {
  it("keeps the repair and retry limits bounded: at most two repair rounds per run and three job retries", () => {
    expect(MAX_REPAIR_ROUNDS).toBe(2);
    expect(MAX_JOB_RETRIES).toBe(3);
  });

  it("repairs a false cookware claim in code and saves the recipe without a repair call", async () => {
    const draft = goodRecipe({
      instructions: [
        { text: "Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners, which will burn off any gluten left in the tin." },
        ...goodRecipe().instructions.slice(1),
      ],
    });
    const { result, data, ai } = run(fakeProviders({ drafts: [draft] }));
    expect(await result).toMatchObject({ status: "succeeded" });
    expect([ai.writer.calls(), ai.repairer.calls(), ai.reviewer.calls()]).toEqual([1, 0, 1]);
    expect((data.recipes[0] as unknown as { instructions: Array<{ text: string }> }).instructions[0].text).toBe("Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners.");
    // The reviewer only ever sees the repaired text.
    expect(JSON.stringify(ai.reviewer.inputs[0])).not.toMatch(/burn off any gluten/);
    expect(data.generation_attempts[0].issues).toContainEqual(expect.objectContaining({ severity: "warning", source: "cookware", field: "instructions[0]" }));
  });

  it("Nov 6 case: a wording issue found on the final review is fixed in code instead of failing the recipe", async () => {
    const final = wording();
    const ai = fakeProviders({
      drafts: [goodRecipe(), goodRecipe()],
      reviewRounds: [[{ severity: "blocking", kind: "safety", field: "ingredients[2]", message: "Say the baking powder is gluten-free.", quote: "", replacement: "" }], [final]],
    });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    // Same AI calls as before: one writer call, one repair, two reviews.
    expect([ai.writer.calls(), ai.repairer.calls(), ai.reviewer.calls()]).toEqual([1, 1, 2]);
    expect((data.recipes[0] as unknown as { tips: string[] }).tips[0]).toBe("Use new paper liners.");
  });

  it("re-runs every code check after a wording fix: a replacement that adds pork goes to the repair step", async () => {
    const ai = fakeProviders({
      drafts: [goodRecipe(), goodRecipe()],
      reviewRounds: [[{ ...wording(), replacement: "Serve with crispy bacon." }], []],
    });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(1);
    expect(JSON.stringify(data.recipes[0])).not.toMatch(/bacon/i);
  });

  it("still fails when a blocking issue cannot be fixed in code after the one repair round", async () => {
    const unfixable = { ...wording(), quote: "text the recipe does not contain" };
    const { result, data, ai } = run(fakeProviders({ reviewRounds: [[unfixable], [unfixable]] }));
    expect(await result).toMatchObject({ status: "failed" });
    expect(ai.repairer.calls()).toBe(1);
    expect(data.recipes).toHaveLength(0);
  });

  it("never applies a safety issue in code, even with a quote", async () => {
    const safety: ReviewIssue = { severity: "blocking", kind: "safety", field: "tips[0]", message: "Unsafe advice.", quote: "Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact.", replacement: "Use new liners." };
    const { result, ai } = run(fakeProviders({ reviewRounds: [[safety], [safety]] }));
    expect(await result).toMatchObject({ status: "failed" });
    expect(ai.repairer.calls()).toBe(1);
  });

  function wording(): ReviewIssue {
    return {
      severity: "blocking",
      kind: "wording",
      field: "tips[0]",
      message: "Wiping and preheating does not remove gluten; remove the suggestion.",
      quote: "Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact.",
      replacement: "Use new paper liners.",
    };
  }
});

describe("prompts", () => {
  it("tell the writer to assume clean cookware and never claim heat removes gluten", () => {
    expect(PROMPT_VERSION).toBe("recipe-v8");
    expect(WRITER_SYSTEM).toMatch(/Assume the reader cooks with clean cookware/);
    expect(WRITER_SYSTEM).toMatch(/Heat a clean skillet over medium heat/);
    expect(WRITER_SYSTEM).toMatch(/Never say or imply that heating, preheating/);
    expect(WRITER_SYSTEM).toMatch(/shared fryer/);
    expect(WRITER_SYSTEM).not.toMatch(/Include one tip on avoiding cross-contact in a shared kitchen when it is relevant/);
    // The permanent rules are still there.
    expect(WRITER_SYSTEM).toMatch(/Pork-free and alcohol-free rules/);
    expect(WRITER_SYSTEM).toMatch(/labeled gluten-free and alcohol-free/);
  });

  it("tell the reviewer not to flag clean cookware or cast iron, and to mark wording issues", () => {
    expect(REVIEWER_SYSTEM).toMatch(/do not treat cast iron as contaminated/);
    expect(REVIEWER_SYSTEM).toMatch(/Do not report a missing cookware or cross-contact warning/);
    expect(REVIEWER_SYSTEM).toMatch(/"kind": "wording"/);
    expect(REVIEWER_SYSTEM).toMatch(/Any ingredient that contains gluten/);
    expect(REVIEWER_SYSTEM).toMatch(/Any pork or pork-derived ingredient/);
    const item = REVIEW_JSON_SCHEMA.properties.issues.items;
    expect(item.required).toEqual(["severity", "field", "message", "kind", "quote", "replacement"]);
  });
});
