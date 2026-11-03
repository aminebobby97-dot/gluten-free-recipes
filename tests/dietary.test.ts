import { describe, expect, it, vi } from "vitest";
import { analyzeDietaryRestrictions, dietaryRejectionReason, findCondimentViolations, findDietaryViolations, keywordViolation } from "@/lib/recipes/dietary";
import { validateGeneratedRecipe } from "@/lib/automation/validate";
import { REVIEWER_SYSTEM, WRITER_SYSTEM } from "@/lib/automation/providers/prompts";
import { automationDb, fakeImages, fakeProviders, fakeSite, goodRecipe } from "./support/automation-fixtures";
import { createFakeDb } from "./support/fake-db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe } = await import("@/lib/automation/pipeline");
const { publishRecipe } = await import("@/lib/services/recipes");

const KEYWORD = { id: "kw-1", keyword: "gluten free blueberry muffins", category_id: null, search_volume: null, keyword_difficulty: null };
const CATEGORIES = [{ id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking" }];

/** Terms found in one ingredient line (which also needs a label check for substitutes). */
const ingredient = (text: string) => findDietaryViolations("ingredients[0]", text, { requireLabel: true }).map((v) => v.term);
const step = (text: string) => findDietaryViolations("instructions[0]", text).map((v) => v.term);

describe("pork is rejected", () => {
  it.each([
    ["4 slices bacon", "bacon"],
    ["1 cup diced ham", "ham"],
    ["4 oz pancetta, diced", "pancetta"],
    ["6 slices prosciutto", "prosciutto"],
    ["1/2 cup lard", "lard"],
    ["1 envelope unflavored gelatin", "pork-derived gelatin"],
    ["1 tbsp pork gelatin", "pork"],
    ["1 lb ground pork", "pork"],
    ["4 cups pork broth", "pork"],
    ["1 lb Italian sausage", "pork sausage"],
    ["2 oz pepperoni", "pepperoni"],
    ["4 oz chorizo", "chorizo"],
    ["1 lb pork shoulder", "pork"],
    ["2 cups mini marshmallows", "pork-derived gelatin"],
    ["1/2 cup bacon bits", "bacon"],
    ["8 oz guanciale", "guanciale"],
    ["1 package Jell-O", "pork-derived gelatin"],
  ])("%s", (text, term) => {
    expect(ingredient(text)).toContain(term);
  });

  it("finds pork in steps, titles and the photo brief", () => {
    expect(step("Fry the bacon until crisp, then set aside.")).toEqual(["bacon"]);
    const issues = analyzeDietaryRestrictions(goodRecipe({ title: "Gluten-Free Ham and Cheese Muffins", image_brief: "Muffins next to a plate of sliced prosciutto, soft daylight." }));
    expect(issues.map((v) => v.field)).toEqual(["title", "image_brief"]);
  });

  it("does not accept a non-pork word that is only nearby", () => {
    expect(ingredient("chicken and bacon")).toEqual(["bacon"]);
    expect(ingredient("turkey, bacon")).toEqual(["bacon"]);
  });
});

describe("alcohol is rejected", () => {
  it.each([
    ["1/2 cup dry white wine", "wine"],
    ["2 tbsp cooking wine", "wine"],
    ["1 bottle gluten-free beer", "beer"],
    ["2 tbsp dark rum", "rum"],
    ["1 tbsp vodka", "vodka"],
    ["2 tbsp brandy", "brandy"],
    ["1 tbsp whiskey", "whiskey"],
    ["1/4 cup bourbon", "bourbon"],
    ["2 tbsp mirin", "rice wine"],
    ["1 tbsp Shaoxing rice wine", "rice wine"],
    ["2 tbsp dry sherry", "sherry"],
    ["1/2 cup Marsala", "wine"],
    ["2 tbsp amaretto", "liqueur"],
    ["1 tbsp orange liqueur", "liqueur"],
    ["2 tbsp sake", "sake"],
    ["3 dashes Angostura bitters", "bitters"],
    ["1 cup hard cider", "hard cider"],
  ])("%s", (text, term) => {
    expect(ingredient(text)).toContain(term);
  });

  it("rejects hidden alcohol in ordinary extracts and flavorings", () => {
    expect(ingredient("1 tsp pure vanilla extract")).toEqual(["alcohol-based extract"]);
    expect(ingredient("1/2 tsp almond extract")).toEqual(["alcohol-based extract"]);
    expect(ingredient("1 tsp vanilla bean paste")).toEqual(["alcohol-based extract"]);
    expect(ingredient("1 tsp rum extract")).toEqual(["rum", "alcohol-based extract"]);
    expect(ingredient("1/2 tsp lemon flavoring")).toEqual(["alcohol-based extract"]);
  });

  it("finds alcohol in steps", () => {
    expect(step("Deglaze the pan with the wine and simmer for 2 minutes.")).toEqual(["wine"]);
    expect(step("Flambé the bananas.")).toEqual(["flambé"]);
    expect(step("Let the alcohol cook off.")).toEqual(["alcohol"]);
  });
});

describe("substitutions, variations, tips and FAQ are checked", () => {
  it("rejects a prohibited substitution", () => {
    const issues = analyzeDietaryRestrictions(goodRecipe({ substitutions: [{ original: "chicken broth", substitute: "dry white wine", note: "Adds acidity." }] }));
    expect(issues).toEqual([expect.objectContaining({ field: "substitutions[0]", category: "alcohol", term: "wine" })]);
  });

  it("rejects a prohibited variation in tips or the FAQ", () => {
    const issues = analyzeDietaryRestrictions(
      goodRecipe({
        tips: ["For a savory version, fold in crumbled bacon."],
        faq: [...goodRecipe().faq, { question: "Can I add a splash of rum?", answer: "Yes, 1 tablespoon works well." }],
      }),
    );
    expect(issues.map((v) => [v.field, v.term])).toEqual([
      ["tips[0]", "bacon"],
      ["faq[4]", "rum"],
    ]);
  });

  it("rejects serving suggestions and 'instead of' mentions too", () => {
    expect(findDietaryViolations("faq[0]", "Serve with a glass of red wine.")).toHaveLength(1);
    expect(findDietaryViolations("introduction", "Use broth instead of wine for a family-friendly version.")).toHaveLength(1);
  });

  it("gives a clear rejection reason for the job log", () => {
    const reason = dietaryRejectionReason(analyzeDietaryRestrictions(goodRecipe({ tips: ["Top with bacon."] })));
    expect(reason).toMatch(/^Rejected by the pork-free and alcohol-free rule: tips\[0\] mentions "bacon"/);
  });
});

describe("valid recipes and harmless words pass", () => {
  it.each([
    "2 lb boneless chicken thighs",
    "1 lb ground beef",
    "1 lb ground turkey",
    "4 slices turkey bacon",
    "1 lb chicken sausage, labeled gluten-free",
    "2 oz beef pepperoni",
    "1 lb beef chorizo",
    "1 tbsp beef gelatin",
    "1 tsp agar-agar powder",
    "1 cup vegan marshmallows",
    "2 cups zucchini",
    "1 tbsp red wine vinegar",
    "1 tbsp rice wine vinegar",
    "2 tbsp apple cider vinegar",
    "1 tbsp sherry vinegar",
    "1 tsp alcohol-free vanilla extract, labeled alcohol-free",
    "1/2 cup non-alcoholic red wine, check the label",
    "1 cup non-alcoholic gluten-free beer, labeled 0.0% alcohol",
    "1 vanilla bean, seeds scraped",
    "1 tsp vanilla powder",
    "1 tsp Bourbon vanilla powder",
    "1 can root beer",
    "1 cup ginger ale",
    "1 Scotch bonnet pepper",
    "2 tbsp butterscotch chips",
    "1 cup graham-style gluten-free crackers",
    "1/2 cup hamburger dill pickles",
    "1 tsp ginger",
    "1 lb porterhouse steak",
    "2 cups shredded kale",
    "1 tsp erythritol (a sugar alcohol)",
    "1/4 cup champagne vinegar",
    "1 cup pomegranate juice",
  ])("%s", (text) => {
    expect(ingredient(text)).toEqual([]);
  });

  it("ignores harmless phrases in the copy", () => {
    expect(step("For the sake of a crisp crust, preheat the pan.")).toEqual([]);
    expect(step("Cook the hamburger patties until they reach 160°F.")).toEqual([]);
    expect(step("Champion of weeknight dinners: a ham-free, pork-free and alcohol-free skillet.")).toEqual([]);
    expect(step("Use a small spoon to scoop out a speck of the filling.")).toEqual([]);
    expect(step("Pigeon peas and a pinch of nutmeg.")).toEqual([]);
    expect(step("Whisk the eggs until pale.")).toEqual([]);
    expect(step("Squeeze the lemon to extract the juice.")).toEqual([]);
    expect(step("Let the dough rest; ginger and pale yellow tones appear.")).toEqual([]);
  });

  it("passes the standard test recipe and a beef recipe", () => {
    expect(analyzeDietaryRestrictions(goodRecipe())).toEqual([]);
    expect(
      analyzeDietaryRestrictions(
        goodRecipe({
          title: "Gluten-Free Beef and Vegetable Stew",
          ingredients: [
            { amount: "2", unit: "lb", name: "beef chuck", note: "cut into cubes" },
            { amount: "4", unit: "cups", name: "beef broth", note: "labeled gluten-free" },
            { amount: "2", unit: "tbsp", name: "red wine vinegar" },
            { amount: "3", name: "carrots" },
          ],
          substitutions: [{ original: "beef broth", substitute: "chicken broth", note: "Lighter flavor; check it is labeled gluten-free." }],
        }),
      ),
    ).toEqual([]);
  });

  it("asks for a label check on a non-alcoholic substitute in the ingredients and suggestions", () => {
    expect(ingredient("1/2 cup non-alcoholic white wine")).toEqual(["wine"]);
    expect(findDietaryViolations("faq[0]", "Use alcohol-free vanilla extract.", { requireLabel: true })[0].message).toMatch(/check the label/);
    // In a step, the qualified name is enough; the ingredient line carries the label note.
    expect(step("Stir in the non-alcoholic white wine.")).toEqual([]);
  });
});

describe("keywords", () => {
  it("flags keywords for pork or alcohol dishes", () => {
    expect(keywordViolation("gluten free bacon wrapped dates")?.term).toBe("bacon");
    expect(keywordViolation("gluten free beer bread")?.term).toBe("beer");
    expect(keywordViolation("gluten free rum cake")?.term).toBe("rum");
    expect(keywordViolation("gluten free blueberry muffins")).toBeNull();
    expect(keywordViolation("gluten free hamburger buns")).toBeNull();
  });
});

describe("validateGeneratedRecipe blocks pork and alcohol", () => {
  it("adds a blocking dietary issue", () => {
    const recipe = goodRecipe({ ingredients: [...goodRecipe().ingredients, { amount: "1", unit: "tsp", name: "vanilla extract" }] });
    const issues = validateGeneratedRecipe(recipe, KEYWORD, CATEGORIES).filter((i) => i.source === "dietary");
    expect(issues).toEqual([expect.objectContaining({ severity: "blocking", field: "ingredients[8]" })]);
  });
});

describe("prompts", () => {
  it("tell the writer and the reviewer about the rule", () => {
    expect(WRITER_SYSTEM).toMatch(/Pork-free and alcohol-free rules/);
    expect(WRITER_SYSTEM).toMatch(/substitutions, variations, tips, serving suggestions, FAQ/);
    expect(REVIEWER_SYSTEM).toMatch(/pork or pork-derived ingredient/);
    expect(REVIEWER_SYSTEM).toMatch(/intentionally added alcohol/);
    expect(REVIEWER_SYSTEM).toMatch(/Hidden ingredients/);
    expect(REVIEWER_SYSTEM).toMatch(/gluten-free/);
  });
});

const NOW = new Date("2026-11-02T13:17:00Z");
function run(db: ReturnType<typeof automationDb>["db"], ai = fakeProviders(), extra: Partial<Parameters<typeof runDailyRecipe>[0]> = {}) {
  const images = fakeImages();
  const site = fakeSite();
  const result = runDailyRecipe({ db, providers: ai.providers, images: images.store, site: site.site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW, ...extra });
  return { result, images, site, ai };
}

describe("runDailyRecipe: pork-free and alcohol-free", () => {
  const withBacon = goodRecipe({ tips: ["Fold in crumbled bacon for a savory version."] });

  it("sends a noncompliant draft to the repair round with the reason, then saves the fixed recipe", async () => {
    const { db, data } = automationDb();
    const ai = fakeProviders({ drafts: [withBacon, goodRecipe()] });
    expect(await run(db, ai).result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(1);
    // The reviewer is not paid for a draft that already failed a code check.
    expect(ai.reviewer.calls()).toBe(1);
    expect((ai.repairer.inputs[0] as { issues: unknown[] }).issues).toEqual([expect.objectContaining({ source: "dietary", field: "tips[0]", message: expect.stringContaining("bacon") })]);
    expect(data.generation_attempts[0]).toMatchObject({ kind: "recipe", status: "rejected" });
    expect(data.recipes).toHaveLength(1);
    expect(data.recipes[0].tips).toEqual(goodRecipe().tips);
  });

  it("rejects the recipe before the photo, save or publish when the repair still breaks the rule", async () => {
    const { db, data } = automationDb({ settings: { publish_mode: "auto" } });
    const { result, images } = run(db, fakeProviders({ drafts: [withBacon, withBacon] }), { requestedMode: "auto" });
    const out = await result;
    expect(out.status).toBe("failed");
    expect(out.status === "failed" && out.error).toMatch(/bacon/);
    expect(data.recipes).toHaveLength(0);
    expect(images.uploaded).toHaveLength(0);
    // Normal retry rules: the keyword stays with the job for the next run.
    expect(data.publishing_jobs[0]).toMatchObject({ status: "failed", retry_count: 1 });
  });

  it("re-checks a recipe resumed from an earlier checkpoint", async () => {
    const { db, data } = automationDb();
    data.keywords[0].status = "queued";
    data.publishing_jobs.push({
      id: "job-r",
      job_type: "daily_recipe",
      job_date: "2026-11-02",
      idempotency_key: "daily_recipe:2026-11-02",
      status: "failed",
      retry_count: 1,
      checkpoint: { keyword_id: "kw-1", recipe: goodRecipe({ substitutions: [{ original: "milk", substitute: "beer", note: "" }] }) },
    });
    const { result, images } = run(db);
    const out = await result;
    expect(out.status === "failed" && out.error).toMatch(/^Rejected by the pork-free and alcohol-free rule: substitutions\[0\] mentions "beer"/);
    expect(images.uploaded).toHaveLength(0);
    expect(data.recipes).toHaveLength(0);
    expect(data.publishing_job_events.some((e) => e.status === "failed" && String(e.message).includes("pork-free and alcohol-free"))).toBe(true);
  });

  it("skips pork and alcohol keywords without any AI call and uses the next one", async () => {
    const { db, data } = automationDb({
      keywords: [
        { id: "kw-bacon", keyword: "gluten free bacon wrapped dates", status: "new", category_id: null, search_volume: null, keyword_difficulty: null },
        { id: "kw-wine", keyword: "gluten free red wine chocolate cake", status: "new", category_id: null, search_volume: null, keyword_difficulty: null },
        { id: "kw-1", keyword: "gluten free blueberry muffins", status: "new", category_id: null, search_volume: null, keyword_difficulty: null },
      ],
    });
    const ai = fakeProviders();
    expect(await run(db, ai).result).toMatchObject({ status: "succeeded" });
    expect(data.keywords.map((k) => k.status)).toEqual(["rejected", "rejected", "assigned"]);
    expect(String(data.keywords[0].last_error)).toMatch(/pork-free and alcohol-free rule.*bacon/);
    expect(ai.writer.calls()).toBe(1);
    expect(data.generation_attempts).toHaveLength(4);
  });

  it("refuses a pork or alcohol keyword in a dry run without saving anything", async () => {
    const { db, data } = automationDb({ settings: { enabled: false } });
    const ai = fakeProviders();
    const out = await run(db, ai, { requestedMode: "dry_run", trigger: "manual", envEnabled: false, dryRunKeyword: "gluten free beer battered fish" }).result;
    expect(out.status === "failed" && out.error).toMatch(/beer/);
    expect(ai.writer.calls()).toBe(0);
    expect(data.keywords[0].status).toBe("new");
  });
});

describe("publishRecipe: AI recipes must be pork-free and alcohol-free", () => {
  const draft = {
    id: "r1",
    title: "Rice Bowl",
    slug: "rice-bowl",
    description: "A simple gluten-free rice bowl.",
    introduction: "i".repeat(200),
    category_id: "00000000-0000-4000-8000-000000000001",
    ingredients: [{ amount: "1", unit: "cup", name: "rice" }],
    instructions: [{ text: "Cook the rice." }],
    prep_time: 5,
    cook_time: 20,
    servings: 2,
    yield_description: null,
    nutrition: null,
    tips: [],
    substitutions: [],
    storage_instructions: "Refrigerate.",
    faq: [],
    featured_image: "https://example.test/rice.jpg",
    featured_image_alt: "Rice bowl",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: null,
    seo_description: null,
    focus_keyword: null,
    is_tested: false,
    status: "in_review",
    source: "ai",
    published_at: null,
  };

  it("refuses to approve an AI draft that mentions pork or alcohol", async () => {
    const { db, data } = createFakeDb({ recipes: [{ ...draft, tips: ["Add a splash of mirin."] }] });
    await expect(publishRecipe(db, "r1")).rejects.toMatchObject({ code: "not_ready", issues: [expect.objectContaining({ field: "tips[0]" })] });
    expect(data.recipes[0].status).toBe("in_review");
  });

  it("publishes a compliant AI draft and leaves hand-written and already published recipes alone", async () => {
    const ok = createFakeDb({ recipes: [draft] });
    await publishRecipe(ok.db, "r1");
    expect(ok.data.recipes[0].status).toBe("published");

    const manual = createFakeDb({ recipes: [{ ...draft, source: "manual", status: "draft", ingredients: [{ amount: "1", unit: "tsp", name: "pure vanilla extract" }] }] });
    await publishRecipe(manual.db, "r1");
    expect(manual.data.recipes[0].status).toBe("published");

    const live = createFakeDb({ recipes: [{ ...draft, status: "published", published_at: "2026-10-01T00:00:00.000Z", ingredients: [{ amount: "1", unit: "tsp", name: "pure vanilla extract" }] }] });
    await expect(publishRecipe(live.db, "r1")).resolves.toBeTruthy();
  });
});

describe("soy sauce and similar condiments", () => {
  const OK = "labeled gluten-free and alcohol-free";
  const terms = (recipe: Parameters<typeof analyzeDietaryRestrictions>[0]) => analyzeDietaryRestrictions(recipe).map((v) => [v.field, v.category, v.term]);
  const stirFry = (overrides: Partial<ReturnType<typeof goodRecipe>> = {}) =>
    goodRecipe({
      title: "Gluten-Free Chicken Stir-Fry",
      ingredients: [
        { amount: "1", unit: "lb", name: "boneless chicken breast", note: "sliced" },
        { amount: "3", unit: "tbsp", name: "tamari", note: OK },
        { amount: "1", unit: "tbsp", name: "honey" },
        { amount: "2", unit: "cups", name: "broccoli florets" },
      ],
      instructions: [{ text: "Whisk the tamari and honey to make the stir-fry sauce." }, { text: "Stir-fry the chicken until it reaches 165°F, then add the broccoli and the tamari mixture." }],
      substitutions: [{ original: "tamari", substitute: "coconut aminos", note: `Sweeter and lower in sodium; use one ${OK}.` }],
      ...overrides,
    });

  it("passes compliant tamari, coconut aminos and a homemade stir-fry sauce", () => {
    expect(terms(stirFry())).toEqual([]);
  });

  it.each([
    ["3 tbsp soy sauce", "soy sauce"],
    ["3 tbsp gluten-free soy sauce", "soy sauce"],
    ["3 tbsp low-sodium soy sauce, labeled gluten-free", "soy sauce"],
    ["2 tbsp tamari", "tamari"],
    ["2 tbsp tamari, labeled gluten-free", "tamari"],
    ["2 tbsp coconut aminos", "coconut aminos"],
    ["1 tbsp fish sauce", "fish sauce"],
    ["2 tbsp oyster sauce, gluten-free", "oyster sauce"],
    ["2 tbsp hoisin sauce", "hoisin sauce"],
    ["1/4 cup teriyaki sauce", "teriyaki sauce"],
    ["1 tbsp white miso paste", "miso"],
    ["1 tbsp gochujang", "gochujang"],
    ["2 tbsp ponzu", "ponzu"],
    ["1/2 cup stir-fry sauce", "cooking sauce"],
    ["1 tbsp kecap manis", "soy sauce"],
    ["1 tbsp black bean sauce", "chili bean sauce"],
  ])("rejects %s in the ingredient list", (name, term) => {
    expect(terms(stirFry({ ingredients: [...stirFry().ingredients, { amount: "", unit: "", name }] }))).toContainEqual(["ingredients[4]", "condiment", term]);
  });

  it.each([
    `soy sauce, ${OK}`,
    `tamari, ${OK}`,
    "coconut aminos (check the label: gluten-free and alcohol-free)",
    `fish sauce, ${OK}`,
    `oyster sauce, ${OK}`,
    `hoisin sauce, ${OK}`,
    `white miso, ${OK}`,
    `gochujang, ${OK}`,
  ])("accepts %s", (name) => {
    expect(findCondimentViolations("ingredients[0]", name, true)).toEqual([]);
  });

  it("never accepts 'regular' soy sauce, even next to a compliant one", () => {
    expect(findCondimentViolations("faq[0]", `Use regular soy sauce or tamari ${OK}.`, true).map((v) => v.match)).toEqual(["soy sauce"]);
  });

  it("rejects XO sauce as a pork ingredient", () => {
    expect(ingredient("1 tbsp XO sauce")).toEqual(["XO sauce (made with ham)"]);
  });

  it("checks substitutions, variations (tips) and FAQ answers", () => {
    expect(terms(stirFry({ substitutions: [{ original: "tamari", substitute: "soy sauce", note: "Same amount." }] }))).toEqual([["substitutions[0]", "condiment", "soy sauce"]]);
    expect(terms(stirFry({ tips: ["For a variation, brush with teriyaki sauce before serving."] }))).toEqual([["tips[0]", "condiment", "teriyaki sauce"]]);
    expect(terms(stirFry({ faq: [...goodRecipe().faq, { question: "Can I use fish sauce?", answer: "Yes, add a teaspoon." }] }))).toEqual([["faq[4]", "condiment", "fish sauce"]]);
    expect(terms(stirFry({ faq: [...goodRecipe().faq, { question: "Can I use coconut aminos?", answer: `Yes, use one ${OK}.` }] }))).toEqual([]);
  });

  it("checks the steps against the ingredient list", () => {
    // A condiment the list does not have in a compliant version.
    expect(terms(stirFry({ instructions: [...stirFry().instructions, { text: "Finish with a splash of oyster sauce." }] }))).toEqual([["instructions[2]", "condiment", "oyster sauce"]]);
    // The steps say tamari, but the list has unlabeled tamari: both are flagged.
    const unlabeled = stirFry({ ingredients: stirFry().ingredients.map((i) => (i.name === "tamari" ? { ...i, note: "" } : i)) });
    expect(terms(unlabeled).map(([field]) => field)).toEqual(["ingredients[1]", "instructions[0]", "instructions[0]", "instructions[1]", "substitutions[0]"]);
  });

  it("does not flag harmless words", () => {
    expect(findCondimentViolations("introduction", "A soy-free, miso-free dinner with soybeans and edamame.", false)).toEqual([]);
    expect(findCondimentViolations("title", "Gluten-Free Teriyaki Chicken", false)).toEqual([]);
    expect(findCondimentViolations("ingredients[0]", "1 lb cod fillets", true)).toEqual([]);
  });

  it("blocks a draft in validateGeneratedRecipe and tells the repair round why", async () => {
    const withSoy = stirFry({ substitutions: [{ original: "tamari", substitute: "regular soy sauce", note: "" }] });
    expect(validateGeneratedRecipe(withSoy, KEYWORD, CATEGORIES).filter((i) => i.source === "dietary")).toEqual([
      expect.objectContaining({ severity: "blocking", field: "substitutions[0]", message: expect.stringContaining("gluten-free and alcohol-free") }),
    ]);
    const { db, data } = automationDb();
    const ai = fakeProviders({ drafts: [goodRecipe({ tips: ["Brush with soy sauce."] }), goodRecipe()] });
    expect(await run(db, ai).result).toMatchObject({ status: "succeeded" });
    expect((ai.repairer.inputs[0] as { issues: Array<{ message: string }> }).issues[0].message).toMatch(/soy sauce.*gluten-free and alcohol-free/);
    expect(data.recipes).toHaveLength(1);
  });

  it("tells the writer and the reviewer", () => {
    expect(WRITER_SYSTEM).toMatch(/labeled gluten-free and alcohol-free/);
    expect(WRITER_SYSTEM).not.toMatch(/"gluten-free soy sauce or tamari"/);
    expect(REVIEWER_SYSTEM).toMatch(/Do not assume tamari or coconut aminos are safe/);
  });
});
