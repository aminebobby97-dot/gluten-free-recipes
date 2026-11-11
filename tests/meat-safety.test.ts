// Safe internal temperatures are checked per kind of meat. On November 11,
// 2026 a turkey sausage hash that correctly said 165°F was failed because the
// old "ground meat" rule matched the word "sausage" and asked for 160°F. Two AI
// repairs could not satisfy it without writing an unsafe temperature. Poultry
// (including ground turkey, ground chicken and turkey or chicken sausage) now
// needs 165°F (74°C), ground beef or lamb 160°F (71°C), a mixed poultry and
// beef sausage 165°F, and a meat the list does not name is never guessed.

import { describe, expect, it, vi } from "vitest";
import { automationDb, fakeImages, fakeProviders, fakeSite, goodRecipe } from "./support/automation-fixtures";
import { checkConsistency } from "@/lib/automation/consistency";
import { validateGeneratedRecipe } from "@/lib/automation/validate";
import { REVIEWER_SYSTEM, WRITER_SYSTEM } from "@/lib/automation/providers/prompts";
import { analyzeDietaryRestrictions } from "@/lib/recipes/dietary";
import { checkMeatSafety, classifyMeat, repairMeatTemperatures } from "@/lib/recipes/meat-safety";
import type { GeneratedRecipe, RepairInput } from "@/lib/automation/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe } = await import("@/lib/automation/pipeline");

const NOW = new Date("2026-11-11T02:00:00Z");
const HASH_KEYWORD = "gluten free sweet potato breakfast hash with turkey sausage";
const KEYWORD = { id: "kw-1", keyword: HASH_KEYWORD, category_id: null, search_volume: null, keyword_difficulty: null };
const CATEGORIES = [{ id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking" }];

/** A recipe like the one the November 11 run asked for, stating the correct 165°F (74°C). */
function hash(overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return goodRecipe({
    title: "Gluten-Free Sweet Potato Breakfast Hash with Turkey Sausage",
    slug: "gluten-free-sweet-potato-breakfast-hash-turkey-sausage",
    description: "A one-skillet gluten-free breakfast hash with crispy sweet potatoes, turkey sausage, peppers and soft eggs.",
    introduction:
      "This gluten-free sweet potato breakfast hash with turkey sausage cooks in one skillet, so breakfast is on the table with very little cleanup. Small cubes of sweet potato brown faster and stay crisp at the edges.\n\n" +
      "Turkey sausage brings savory seasoning without much extra fat, so a spoonful of olive oil keeps the potatoes from sticking. Check that the turkey sausage is labeled gluten-free, because some brands use wheat-based fillers. Eggs cooked right in the hash make it a full meal.",
    ingredients: [
      { amount: "1", unit: "lb", name: "turkey breakfast sausage", note: "casings removed, labeled gluten-free", metric: "450 g" },
      { amount: "2", name: "medium sweet potatoes", note: "cut into 1/2-inch cubes", metric: "600 g" },
      { amount: "1", name: "red bell pepper", note: "diced" },
      { amount: "1", name: "yellow onion", note: "diced" },
      { amount: "2", unit: "tbsp", name: "olive oil" },
      { amount: "1/2", unit: "tsp", name: "kosher salt" },
      { amount: "4", name: "large eggs" },
    ],
    instructions: [
      { text: "Heat 1 tablespoon of the olive oil in a 12-inch skillet over medium-high heat." },
      {
        text: "Add the turkey sausage and cook for 6 to 8 minutes, breaking it up, until browned and an instant-read thermometer reads 165°F (74°C). Transfer to a plate.",
      },
      { text: "Add the remaining olive oil, the sweet potatoes and the salt and cook for 10 to 12 minutes, stirring occasionally, until tender and browned." },
      { text: "Stir in the bell pepper and onion and cook for 4 minutes, then return the turkey sausage to the skillet." },
      { text: "Make 4 wells, crack in the eggs, cover and cook for 4 to 5 minutes, until the whites are set." },
    ],
    prep_time: 15,
    cook_time: 30,
    servings: 4,
    yield_description: "4 servings",
    tips: ["Cut the sweet potatoes the same size so they brown evenly.", "If you use precooked turkey sausage, heat it through until it reaches 165°F (74°C)."],
    substitutions: [{ original: "turkey breakfast sausage", substitute: "ground chicken", note: "Season with sage and pepper and cook it to 165°F (74°C)." }],
    storage_instructions: "Refrigerate leftovers in an airtight container for up to 3 days. Reheat in a skillet until hot.",
    faq: [
      { question: "Can I make it ahead?", answer: "Cook the potatoes and turkey sausage ahead, then reheat and add the eggs." },
      { question: "How do I know the turkey sausage is done?", answer: "Turkey sausage is poultry, so cook it to 165°F (74°C) on an instant-read thermometer." },
      { question: "Can I use white potatoes?", answer: "Yes. Yukon Gold potatoes take about 2 minutes longer." },
      { question: "Is turkey sausage gluten-free?", answer: "Not always. Choose one labeled gluten-free." },
    ],
    seo_title: "Sweet Potato Breakfast Hash with Turkey Sausage (GF)",
    seo_description: "A one-skillet gluten-free sweet potato breakfast hash with turkey sausage, peppers and eggs. Crispy, filling and ready in about 45 minutes.",
    focus_keyword: HASH_KEYWORD,
    allergens: ["eggs"],
    image_alt: "A skillet of sweet potato hash with turkey sausage and four eggs",
    image_brief: "A 12-inch skillet of browned sweet potato cubes, crumbled turkey sausage, red pepper and four sunny eggs, overhead, soft daylight.",
    ...overrides,
  });
}

/** The hash with the sausage step saying no temperature, and no step that clearly cooks the sausage by name. */
const unfixable = (): GeneratedRecipe => {
  const base = withStep(withStep(hash(), 1, "Add the sausage, then transfer to a plate."), 3, "Stir in the bell pepper and onion and cook for 4 minutes, then return the browned meat to the skillet.");
  return {
    ...base,
    tips: [base.tips[0]],
    substitutions: [{ original: "red bell pepper", substitute: "green bell pepper", note: "Slightly less sweet." }],
    faq: base.faq.map((f, i) => (i === 1 ? { ...f, answer: "Use an instant-read thermometer." } : f)),
  };
};

/** Replaces one instruction step. */
function withStep(recipe: GeneratedRecipe, index: number, text: string): GeneratedRecipe {
  return {
    ...recipe,
    instructions: recipe.instructions.map((s, i) => (i === index ? { ...s, text } : s)),
  };
}

const blockers = (recipe: GeneratedRecipe) => validateGeneratedRecipe(recipe, KEYWORD, CATEGORIES).filter((i) => i.severity === "blocking");
const meatBlockers = (recipe: Parameters<typeof checkMeatSafety>[0]) => checkMeatSafety(recipe).filter((i) => i.severity === "blocking");

/** A small recipe with one meat, for the classification cases. */
const simple = (meat: string, stepText: string, extra: Partial<Parameters<typeof checkMeatSafety>[0]> = {}) => ({
  ingredients: [{ name: meat }, { name: "olive oil" }, { name: "kosher salt" }],
  instructions: [{ text: "Heat the olive oil in a skillet over medium-high heat and season with the salt." }, { text: stepText }],
  ...extra,
});

function run(ai: ReturnType<typeof fakeProviders>) {
  const { db, data } = automationDb({ keywords: [{ ...KEYWORD, status: "new" }] });
  const result = runDailyRecipe({ db, providers: ai.providers, images: fakeImages().store, site: fakeSite().site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW });
  return { result, data };
}

describe("the November 11 recipe", () => {
  it("passes every check when it says 165°F for the turkey sausage", () => {
    expect(blockers(hash())).toEqual([]);
    expect(analyzeDietaryRestrictions(hash())).toEqual([]);
  });

  it("is never asked for the ground-meat 160°F any more", () => {
    const messages = checkConsistency(hash()).map((i) => i.message).join(" ");
    expect(messages).not.toMatch(/160/);
    expect(messages).not.toMatch(/ground meat/);
  });

  it("is saved with no AI repair round", async () => {
    const ai = fakeProviders({ drafts: [hash()] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded", slug: "gluten-free-sweet-potato-breakfast-hash-turkey-sausage" });
    expect([ai.writer.calls(), ai.repairer.calls(), ai.reviewer.calls()]).toEqual([1, 0, 1]);
    expect(JSON.stringify(data.recipes[0])).toMatch(/165°F \(74°C\)/);
  });

  it("corrects a draft that used 160°F for the turkey sausage, in steps, tips and FAQ alike, without an AI round", async () => {
    const wrong = hash({
      instructions: hash().instructions.map((s, i) => (i === 1 ? { text: s.text.replace("165°F (74°C)", "160°F (71°C)") } : s)),
      tips: [hash().tips[0], "If you use precooked turkey sausage, heat it through until it reaches 160°F."],
      faq: hash().faq.map((f, i) => (i === 1 ? { ...f, answer: "Cook the turkey sausage to 160°F (71°C) on an instant-read thermometer." } : f)),
    });
    expect(meatBlockers(wrong).map((b) => b.field)).toEqual(["instructions", "instructions[1]", "tips[1]", "faq[1]"]);

    const { recipe, fixes } = repairMeatTemperatures(wrong);
    expect(fixes.map((f) => f.field)).toEqual(["instructions[1]", "tips[1]", "faq[1]"]);
    expect(recipe.instructions[1].text).toContain("an instant-read thermometer reads 165°F (74°C).");
    expect(recipe.tips[1]).toBe("If you use precooked turkey sausage, heat it through until it reaches 165°F (74°C).");
    expect(recipe.faq[1].answer).toBe("Cook the turkey sausage to 165°F (74°C) on an instant-read thermometer.");
    expect(blockers(recipe)).toEqual([]);

    const ai = fakeProviders({ drafts: [wrong] });
    const { result, data } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(0);
    const saved = JSON.stringify(data.recipes[0]);
    expect(saved).not.toMatch(/160°F/);
    expect(data.generation_attempts[0].issues).toContainEqual(expect.objectContaining({ severity: "warning", source: "consistency", field: "faq[1]" }));
  });

  it("adds the missing temperature to the step that cooks the sausage", () => {
    const missing = withStep(hash(), 1, "Add the turkey sausage and cook for 6 to 8 minutes, breaking it up, until browned. Transfer to a plate.");
    expect(meatBlockers(missing)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("165°F (74°C)") }));
    const { recipe, fixes } = repairMeatTemperatures(missing);
    expect(fixes).toHaveLength(1);
    expect(recipe.instructions[1].text).toBe(
      "Add the turkey sausage and cook for 6 to 8 minutes, breaking it up, until browned. Transfer to a plate. The turkey sausage is done when it reaches 165°F (74°C) on an instant-read thermometer.",
    );
    expect(blockers(recipe)).toEqual([]);
  });

  it("gives the repairer the exact poultry temperature when code cannot fix it", () => {
    // No step clearly cooks the sausage by name, so code does not guess where the temperature goes.
    const draft = unfixable();
    expect(repairMeatTemperatures(draft).fixes).toEqual([]);
    const problems = blockers(repairMeatTemperatures(draft).recipe).filter((b) => b.source === "consistency");
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toBe("Recipes with poultry (turkey sausage) must say to cook it to an internal temperature of 165°F (74°C).");
    expect(problems[0].hint).toMatch(/165°F \(74°C\).*such as 160°F, which is for ground beef, not poultry/);
  });

  it("sends that problem to the repairer with the hint, and saves the repaired recipe", async () => {
    const ai = fakeProviders({ drafts: [unfixable(), hash()] });
    const { result } = run(ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(1);
    const sent = (ai.repairer.inputs[0] as RepairInput).issues;
    expect(sent).toContainEqual(expect.objectContaining({ message: expect.stringContaining("165°F (74°C)"), hint: expect.stringContaining("165°F (74°C)") }));
    expect(JSON.stringify(sent)).not.toMatch(/must say to cook it to an internal temperature of 160/);
  });
});

describe("classifying meat", () => {
  it.each([
    ["ground turkey", "poultry", "ground turkey"],
    ["93% lean ground turkey", "poultry", "ground turkey"],
    ["turkey sausage", "poultry", "turkey sausage"],
    ["turkey breakfast sausage links", "poultry", "turkey sausage"],
    ["fully cooked chicken sausage", "poultry", "chicken sausage"],
    ["ground chicken", "poultry", "ground chicken"],
    ["boneless skinless chicken thighs", "poultry", "chicken"],
    ["turkey bacon", "poultry", "turkey"],
    ["chicken and beef sausage", "poultry", "chicken and beef sausage"],
    ["beef and turkey meatballs", "poultry", "beef and turkey"],
    ["lean ground beef", "ground", "ground beef"],
    ["beef sausage", "ground", "beef sausage"],
    ["ground lamb", "ground", "ground lamb"],
    ["beef sirloin steak", "whole", "beef"],
    ["lamb chops", "whole", "lamb"],
  ])("%s is %s", (name, cls, label) => {
    expect(classifyMeat(name)).toMatchObject({ cls, label });
  });

  it.each(["sausage", "breakfast sausage", "ground meat", "meatballs", "burger patties", "mixed-meat sausage"])("%s is not identified, so it is never guessed", (name) => {
    expect(classifyMeat(name)).toMatchObject({ cls: null });
  });

  it.each(["chicken broth", "low-sodium beef broth", "beef gelatin", "gluten-free hamburger buns", "black bean burgers", "plant-based sausage", "ground cinnamon", "coconut meat", "salmon steak", "beef stew meat"])(
    "%s needs no meat temperature rule",
    (name) => {
      expect(classifyMeat(name)).toBeNull();
    },
  );
});

describe("safe internal temperatures", () => {
  it("ground turkey needs 165°F (74°C); 160°F is unsafe and corrected in code", () => {
    expect(meatBlockers(simple("ground turkey", "Cook the ground turkey for 8 minutes until it reaches 165°F."))).toEqual([]);
    const wrong = simple("ground turkey", "Cook the ground turkey for 8 minutes until it reaches 160°F.");
    expect(meatBlockers(wrong).map((b) => b.message)).toEqual([
      "Recipes with poultry (ground turkey) must say to cook it to an internal temperature of 165°F (74°C).",
      "Unsafe temperature: 160°F is too low for ground turkey; poultry (chicken, turkey, ground chicken or turkey, and chicken or turkey sausage) must reach 165°F (74°C).",
    ]);
    const { recipe } = repairMeatTemperatures(wrong);
    expect(recipe.instructions[1].text).toBe("Cook the ground turkey for 8 minutes until it reaches 165°F (74°C).");
    expect(meatBlockers(recipe)).toEqual([]);
  });

  it("turkey sausage needs 165°F, also when a tip only says 'the sausage'", () => {
    const recipe = simple("turkey sausage, labeled gluten-free", "Brown the turkey sausage for 8 minutes until it reaches 165°F (74°C).", {
      tips: ["The sausage is safe at 160°F (71°C)."],
    });
    expect(meatBlockers(recipe)).toEqual([expect.objectContaining({ field: "tips[0]", message: expect.stringContaining("160°F is too low for turkey sausage") })]);
    expect(repairMeatTemperatures(recipe).recipe.tips).toEqual(["The sausage is safe at 165°F (74°C)."]);
  });

  it("ground chicken needs 165°F; a missing temperature is added to its cooking step", () => {
    const recipe = simple("ground chicken", "Cook the ground chicken for 7 to 8 minutes, breaking it up.");
    expect(meatBlockers(recipe)).toEqual([expect.objectContaining({ message: expect.stringContaining("poultry (ground chicken)") })]);
    const fixed = repairMeatTemperatures(recipe).recipe;
    expect(fixed.instructions[1].text).toBe("Cook the ground chicken for 7 to 8 minutes, breaking it up. The ground chicken is done when it reaches 165°F (74°C) on an instant-read thermometer.");
    expect(meatBlockers(fixed)).toEqual([]);
  });

  it("ground beef needs 160°F (71°C); a higher temperature is fine and never lowered", () => {
    expect(meatBlockers(simple("lean ground beef", "Cook the ground beef for 8 minutes until it reaches 160°F (71°C)."))).toEqual([]);
    const hotter = simple("lean ground beef", "Cook the beef until it reaches 165°F.");
    expect(meatBlockers(hotter)).toEqual([]);
    expect(repairMeatTemperatures(hotter).fixes).toEqual([]);
    const low = simple("lean ground beef", "Cook the ground beef until it reaches 155°F.");
    expect(meatBlockers(low)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("155°F is too low for ground beef") }));
    expect(repairMeatTemperatures(low).recipe.instructions[1].text).toBe("Cook the ground beef until it reaches 160°F (71°C).");
  });

  it("a mixed chicken and beef sausage needs the poultry temperature, 165°F", () => {
    const recipe = simple("chicken and beef sausage, labeled gluten-free", "Brown the sausage until it reaches 160°F.");
    expect(meatBlockers(recipe).map((b) => b.message)).toEqual([
      "Recipes with poultry (chicken and beef sausage) must say to cook it to an internal temperature of 165°F (74°C).",
      expect.stringContaining("160°F is too low for chicken and beef sausage"),
    ]);
    const fixed = repairMeatTemperatures(recipe).recipe;
    expect(fixed.instructions[1].text).toBe("Brown the sausage until it reaches 165°F (74°C).");
    expect(meatBlockers(fixed)).toEqual([]);
  });

  it("an ambiguous meat blocks and is never corrected in code, whatever temperature it states", () => {
    for (const meat of ["ground meat", "breakfast sausage", "meatballs"]) {
      for (const temp of ["160°F", "165°F"]) {
        const recipe = simple(meat, `Cook the ${meat} until it reaches ${temp}.`);
        expect(meatBlockers(recipe)).toContainEqual(expect.objectContaining({ field: "ingredients[0]", message: expect.stringContaining("does not say what meat it is") }));
        expect(repairMeatTemperatures(recipe)).toEqual({ recipe, fixes: [] });
      }
    }
  });

  it("does not change a temperature it cannot attribute to one meat", () => {
    const twoMeats = {
      ingredients: [{ name: "turkey sausage" }, { name: "ground beef" }, { name: "olive oil" }],
      instructions: [
        { text: "Heat the olive oil in a skillet and brown the turkey sausage and ground beef together." },
        { text: "Cook the meat until it reaches 160°F." },
      ],
    };
    const { recipe, fixes } = repairMeatTemperatures(twoMeats);
    expect(recipe.instructions[1].text).toBe("Cook the meat until it reaches 160°F.");
    expect(fixes).toEqual([]);
    // The poultry still needs its own temperature, so this stays for the AI repair.
    expect(meatBlockers(recipe)).toContainEqual(expect.objectContaining({ message: expect.stringContaining("poultry (turkey sausage)") }));
  });

  it("does not touch an egg, oil or milk temperature in a poultry recipe", () => {
    const recipe = simple("ground turkey", "Cook the ground turkey until it reaches 165°F.", {
      tips: ["Egg dishes are done at 160°F.", "Warm the milk to 110°F before adding the yeast."],
    });
    expect(meatBlockers(recipe)).toEqual([]);
    expect(repairMeatTemperatures(recipe).fixes).toEqual([]);
  });

  it("corrects a Celsius value that does not match its Fahrenheit", () => {
    const recipe = simple("chicken breasts", "Cook the chicken until it reaches 165°F (71°C).");
    expect(meatBlockers(recipe)).toEqual([expect.objectContaining({ message: "165°F is 74°C, not 71°C (\"165°F (71°C)\")." })]);
    expect(repairMeatTemperatures(recipe).recipe.instructions[1].text).toBe("Cook the chicken until it reaches 165°F (74°C).");
  });

  it("does not ask for a meat temperature in a recipe with only chicken broth", () => {
    expect(meatBlockers(simple("low-sodium chicken broth, labeled gluten-free", "Simmer the broth for 10 minutes."))).toEqual([]);
  });

  it("still requires 145°F for steaks", () => {
    expect(meatBlockers(simple("flank steak", "Sear the steak for 4 minutes per side."))).toContainEqual(expect.objectContaining({ message: expect.stringContaining("145°F (63°C)") }));
    expect(meatBlockers(simple("flank steak", "Sear the steak for 4 minutes per side, until it reaches 145°F."))).toEqual([]);
  });
});

describe("prompts", () => {
  it("give the writer and the reviewer the right temperatures from the start", () => {
    for (const prompt of [WRITER_SYSTEM, REVIEWER_SYSTEM]) {
      expect(prompt).toMatch(/Ground turkey, ground chicken, chicken or turkey sausage[^.]*: 165°F \(74°C\)/);
      expect(prompt).toMatch(/Ground beef, lamb or veal[^.]*: 160°F \(71°C\)/);
      expect(prompt).toMatch(/poultry and red meat[^:]*: 165°F \(74°C\)/);
    }
    expect(WRITER_SYSTEM).toMatch(/Turkey and chicken sausages are poultry: they need 165°F \(74°C\), never 160°F/);
    expect(WRITER_SYSTEM).not.toMatch(/ground meat 160°F/);
    // The pork-free and alcohol-free rules are unchanged.
    expect(WRITER_SYSTEM).toMatch(/No pork or pork-derived ingredient anywhere/);
    expect(WRITER_SYSTEM).toMatch(/No intentionally added alcohol anywhere/);
  });
});
