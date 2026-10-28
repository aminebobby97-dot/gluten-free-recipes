import { describe, expect, it, vi } from "vitest";
import { automationDb, fakeImages, fakeProviders, fakeSite, goodRecipe } from "./support/automation-fixtures";
import { validateGeneratedRecipe } from "@/lib/automation/validate";
import { AiCallError } from "@/lib/automation/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe } = await import("@/lib/automation/pipeline");

const NOW = new Date("2026-11-02T13:17:00Z");
const KEYWORD = { id: "kw-1", keyword: "gluten free blueberry muffins", category_id: null, search_volume: null, keyword_difficulty: null };
const CATEGORIES = [{ id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking" }];

function run(db: ReturnType<typeof automationDb>["db"], ai = fakeProviders(), extra: Partial<Parameters<typeof runDailyRecipe>[0]> = {}) {
  const images = fakeImages();
  const site = fakeSite();
  const result = runDailyRecipe({ db, providers: ai.providers, images: images.store, site: site.site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW, ...extra });
  return { result, images, site, ai };
}

describe("the test recipe fixture", () => {
  it("passes every code check", () => {
    expect(validateGeneratedRecipe(goodRecipe(), KEYWORD, CATEGORIES).filter((i) => i.severity === "blocking")).toEqual([]);
  });
});

describe("runDailyRecipe: switches", () => {
  it("does nothing while automation is off in the environment or the database", async () => {
    const { db, data } = automationDb();
    expect(await run(db, fakeProviders(), { envEnabled: false }).result).toEqual({ status: "skipped", reason: "Automation is turned off." });
    const off = automationDb({ settings: { enabled: false } });
    expect((await run(off.db).result).status).toBe("skipped");
    expect(data.publishing_jobs).toHaveLength(0);
  });

  it("only allows dry runs from a manual trigger", async () => {
    const { db } = automationDb({ settings: { enabled: false } });
    expect(await run(db, fakeProviders(), { requestedMode: "dry_run" }).result).toEqual({ status: "skipped", reason: "Dry runs can only be started manually." });
  });

  it("runs only once per day", async () => {
    const { db } = automationDb();
    expect((await run(db).result).status).toBe("succeeded");
    expect(await run(db).result).toMatchObject({ status: "skipped" });
  });
});

describe("runDailyRecipe: review mode", () => {
  it("saves a complete recipe for review without publishing it", async () => {
    const { db, data } = automationDb();
    const { result, images, site, ai } = run(db);
    expect(await result).toMatchObject({ status: "succeeded", mode: "review", published: false, slug: "gluten-free-blueberry-muffins" });

    const recipe = data.recipes[0];
    expect(recipe).toMatchObject({ status: "in_review", source: "ai", image_source: "ai", is_tested: false, allergens: ["milk", "eggs"], category_id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f" });
    expect(recipe.featured_image).toBe(`https://cdn.test/${images.uploaded[0]}`);
    expect(images.uploaded[0]).toMatch(/^recipes\/2026\/gluten-free-blueberry-muffins-.+\.webp$/);
    expect(data.keywords[0]).toMatchObject({ status: "assigned", assigned_recipe_id: recipe.id });
    expect(data.publishing_jobs[0]).toMatchObject({ status: "succeeded", current_step: "awaiting_review", mode: "review", recipe_id: recipe.id });
    expect(site.refreshed).toEqual([]);

    // One writer call, one review, then one site photo and its check: each logged with its cost.
    // No separate AI Pinterest photo: the Pin is drawn from the site photo when the recipe is published.
    expect([ai.writer.calls(), ai.reviewer.calls(), ai.photographer.calls(), ai.photoChecker.calls()]).toEqual([1, 1, 1, 1]);
    expect(data.generation_attempts.map((a) => a.kind)).toEqual(["recipe", "review", "image", "image_check"]);
    expect(data.publishing_jobs[0].cost_usd).toBe(0.37);
    expect(images.uploaded).toHaveLength(1);
    expect(recipe.pinterest_image).toBeNull();
    expect(data.generation_attempts[2].output).toEqual({ bytes: 3, mimeType: "image/webp" });
    expect(data.publishing_job_events.filter((e) => e.status === "succeeded").map((e) => e.step)).toEqual([
      "select_keyword",
      "generate_recipe",
      "generate_photo",
      "save_recipe",
    ]);
  });

  it("stays in review mode until five AI recipes were approved, even when auto is requested", async () => {
    const reviewed = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, title: `Reviewed ${i}`, slug: `reviewed-${i}`, source: "ai", status: "published", approved_at: "2026-10-30T12:00:00Z" }));
    const { db } = automationDb({ settings: { publish_mode: "auto" }, recipes: reviewed });
    expect(await run(db, fakeProviders(), { requestedMode: "auto" }).result).toMatchObject({ mode: "review", published: false });
  });

  it("counts only human approvals, not AI recipes that were published automatically", async () => {
    const approved = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, title: `Reviewed ${i}`, slug: `reviewed-${i}`, source: "ai", status: "published", approved_at: "2026-10-30T12:00:00Z" }));
    const automatic = { id: "auto-1", title: "Automatic", slug: "automatic", source: "ai", status: "published", approved_at: null };
    const { db } = automationDb({ settings: { publish_mode: "auto" }, recipes: [...approved, automatic] });
    expect(await run(db, fakeProviders(), { requestedMode: "auto" }).result).toMatchObject({ mode: "review", published: false });
  });
});

describe("runDailyRecipe: auto mode", () => {
  it("publishes in one transaction and refreshes the site", async () => {
    const reviewed = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `Reviewed ${i}`, slug: `reviewed-${i}`, source: "ai", status: "published", approved_at: "2026-10-30T12:00:00Z" }));
    const { db, data } = automationDb({ settings: { publish_mode: "auto" }, recipes: reviewed });
    const { result, site } = run(db, fakeProviders(), { requestedMode: "auto" });
    expect(await result).toMatchObject({ status: "succeeded", mode: "auto", published: true });
    expect(data.recipes.at(-1)?.status).toBe("published");
    expect(site.refreshed).toEqual(["gluten-free-blueberry-muffins"]);
  });

  it("keeps the published recipe when only the site refresh fails", async () => {
    const reviewed = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `Reviewed ${i}`, slug: `reviewed-${i}`, source: "ai", status: "published", approved_at: "2026-10-30T12:00:00Z" }));
    const { db, data } = automationDb({ settings: { publish_mode: "auto" }, recipes: reviewed });
    const ai = fakeProviders();
    const images = fakeImages();
    const result = await runDailyRecipe({ db, providers: ai.providers, images: images.store, site: fakeSite(true).site, requestedMode: "auto", trigger: "schedule", envEnabled: true, now: NOW });
    expect(result).toMatchObject({ status: "succeeded", published: true });
    expect(data.publishing_job_events).toContainEqual(expect.objectContaining({ step: "refresh_site", status: "failed" }));
  });

  it("prepares the Pinterest Pin after publishing, and a Pin failure keeps the recipe published", async () => {
    const reviewed = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `Reviewed ${i}`, slug: `reviewed-${i}`, source: "ai", status: "published", approved_at: "2026-10-30T12:00:00Z" }));
    const ok = automationDb({ settings: { publish_mode: "auto" }, recipes: reviewed });
    const preparePin = vi.fn(async () => undefined);
    expect(await run(ok.db, fakeProviders(), { requestedMode: "auto", preparePin }).result).toMatchObject({ status: "succeeded", published: true });
    expect(preparePin).toHaveBeenCalledWith(ok.data.recipes.at(-1)?.id, expect.any(String));
    expect(ok.data.publishing_job_events).toContainEqual(expect.objectContaining({ step: "prepare_pin", status: "succeeded" }));

    const broken = automationDb({ settings: { publish_mode: "auto" }, recipes: reviewed });
    const failing = vi.fn(async () => Promise.reject(new Error("photo download failed")));
    expect(await run(broken.db, fakeProviders(), { requestedMode: "auto", preparePin: failing }).result).toMatchObject({ status: "succeeded", published: true });
    expect(broken.data.recipes.at(-1)?.status).toBe("published");
    expect(broken.data.publishing_job_events).toContainEqual(expect.objectContaining({ step: "prepare_pin", status: "failed" }));
  });

  it("does not prepare a Pin in review mode (the admin's publish does that)", async () => {
    const { db } = automationDb();
    const preparePin = vi.fn(async () => undefined);
    expect(await run(db, fakeProviders(), { preparePin }).result).toMatchObject({ mode: "review", published: false });
    expect(preparePin).not.toHaveBeenCalled();
  });
});

describe("runDailyRecipe: failures never publish", () => {
  it("repairs a draft that fails a check", async () => {
    const bad = goodRecipe({ allergens: ["milk"] }); // eggs not declared
    const { db, data } = automationDb();
    const ai = fakeProviders({ drafts: [bad, goodRecipe()] });
    expect(await run(db, ai).result).toMatchObject({ status: "succeeded" });
    expect(ai.repairer.calls()).toBe(1);
    expect(data.generation_attempts[0]).toMatchObject({ kind: "recipe", status: "rejected" });
    expect(data.recipes).toHaveLength(1);
  });

  it("fails without saving anything when the repair also fails", async () => {
    const bad = goodRecipe({ ingredients: [...goodRecipe().ingredients, { amount: "2", unit: "cups", name: "all-purpose flour" }] });
    const { db, data } = automationDb();
    const { result, images } = run(db, fakeProviders({ drafts: [bad, bad] }));
    const out = await result;
    expect(out).toMatchObject({ status: "failed" });
    expect(out.status === "failed" && out.error).toMatch(/failed .* check/);
    expect(data.recipes).toHaveLength(0);
    expect(images.uploaded).toHaveLength(0);
    expect(data.publishing_jobs[0]).toMatchObject({ status: "failed", retry_count: 1 });
    // Retries are left, so the keyword stays with the job for the next run.
    expect(data.keywords[0].status).toBe("queued");
  });

  it("rejects a blocking finding from the independent reviewer", async () => {
    const { db, data } = automationDb();
    const ai = fakeProviders({ reviewIssues: [{ severity: "blocking", field: "ingredients[2]", message: "Baking powder may contain wheat starch; say gluten-free." }] });
    expect(await run(db, ai).result).toMatchObject({ status: "failed" });
    expect(ai.reviewer.calls()).toBe(2);
    expect(data.recipes).toHaveLength(0);
  });

  it("rejects a near-duplicate of an existing recipe", async () => {
    const { db, data } = automationDb({ similar: ["Easy Gluten-Free Blueberry Muffins"] });
    const ai = fakeProviders();
    expect(await run(db, ai).result).toMatchObject({ status: "failed" });
    expect(ai.reviewer.calls()).toBe(0); // code checks block before paying for a review
    expect(data.generation_attempts[0].issues).toContainEqual(expect.objectContaining({ source: "duplicate" }));
  });

  it("retries a photo the checker rejects", async () => {
    const { db, data } = automationDb();
    const ai = fakeProviders({ photoOk: [false, true] });
    const { result, images } = run(db, ai);
    expect(await result).toMatchObject({ status: "succeeded" });
    expect(ai.photographer.calls()).toBe(2);
    expect(images.uploaded).toHaveLength(1);
    expect(data.generation_attempts.filter((a) => a.kind === "image").map((a) => a.status)).toEqual(["rejected", "succeeded"]);
  });

  it("stops before any AI call when the daily budget is spent", async () => {
    const { db, data } = automationDb({ spent: 2.9 });
    const ai = fakeProviders();
    const out = await run(db, ai).result;
    expect(out).toMatchObject({ status: "failed" });
    expect(out.status === "failed" && out.error).toMatch(/Daily AI budget reached/);
    expect(ai.writer.calls()).toBe(0);
    expect(data.keywords[0].status).toBe("new"); // released: no retry can succeed today
  });

  it("counts the cost of a billed AI call that failed", async () => {
    const { db, data } = automationDb();
    const ai = fakeProviders();
    ai.providers.writer = { estimateUsd: () => 0.5, run: async () => Promise.reject(new AiCallError("Claude declined the request.", 0.03, "anthropic", "claude-opus-5-5")) };
    expect((await run(db, ai).result).status).toBe("failed");
    expect(data.generation_attempts[0]).toMatchObject({ kind: "recipe", status: "error", provider: "anthropic", cost_usd: 0.03, error_message: "Claude declined the request." });
    expect(data.publishing_jobs[0].cost_usd).toBe(0.03);
  });

  it("fails without saving when no site photo passes the check", async () => {
    const { db, data } = automationDb();
    const ai = fakeProviders({ photoOk: [false, false, false] });
    const { result, images } = run(db, ai);
    expect(await result).toMatchObject({ status: "failed", error: expect.stringContaining("No acceptable photo") });
    expect(ai.photographer.calls()).toBe(3);
    expect(images.uploaded).toHaveLength(0);
    expect(data.recipes).toHaveLength(0);
    expect(data.generation_attempts.filter((a) => a.kind === "image").map((a) => a.status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("gives the keyword back and deletes the photos when the last retry fails", async () => {
    const { db, data } = automationDb();
    // Two earlier failed attempts, then this run fails while saving.
    data.publishing_jobs.push({ id: "job-x", job_type: "daily_recipe", job_date: "2026-11-02", idempotency_key: "daily_recipe:2026-11-02", status: "failed", retry_count: 2, checkpoint: {} });
    const images = fakeImages();
    const ai = fakeProviders();
    const failingDb = { ...db, from: (t: string) => (t === "recipes" && ai.photoChecker.calls() > 0 ? brokenInsert(db.from(t)) : db.from(t)) } as typeof db;
    const out = await runDailyRecipe({ db: failingDb, providers: ai.providers, images: images.store, site: fakeSite().site, requestedMode: "review", trigger: "schedule", envEnabled: true, now: NOW });
    expect(out).toMatchObject({ status: "failed" });
    expect(out.status === "failed" && out.error).toMatch(/insert failed/);
    expect(data.keywords[0].status).toBe("new");
    expect(images.uploaded).toHaveLength(1);
    expect(images.removed).toEqual(images.uploaded);
  });
});

describe("runDailyRecipe: resume", () => {
  it("resumes from the saved recipe instead of paying for it again", async () => {
    const { db, data } = automationDb();
    data.keywords[0].status = "queued";
    data.publishing_jobs.push({
      id: "job-r",
      job_type: "daily_recipe",
      job_date: "2026-11-02",
      idempotency_key: "daily_recipe:2026-11-02",
      status: "failed",
      retry_count: 1,
      checkpoint: { keyword_id: "kw-1", recipe: goodRecipe() },
    });
    const ai = fakeProviders();
    expect(await run(db, ai).result).toMatchObject({ status: "succeeded" });
    expect(ai.writer.calls()).toBe(0);
    expect(ai.photographer.calls()).toBe(1);
  });

  it("takes over a job whose worker crashed", async () => {
    const { db, data } = automationDb();
    data.publishing_jobs.push({
      id: "job-c",
      job_type: "daily_recipe",
      job_date: "2026-11-02",
      idempotency_key: "daily_recipe:2026-11-02",
      status: "running",
      retry_count: 0,
      lease_expires_at: "2026-11-02T12:00:00Z",
      checkpoint: {},
    });
    expect(await run(db).result).toMatchObject({ status: "succeeded" });
  });
});

describe("runDailyRecipe: dry run", () => {
  it("generates and checks everything but saves no recipe and claims no keyword", async () => {
    const { db, data } = automationDb({ settings: { enabled: false } });
    const { result, images } = run(db, fakeProviders(), { requestedMode: "dry_run", trigger: "manual", envEnabled: false });
    expect(await result).toMatchObject({ status: "succeeded", mode: "dry_run", recipeId: null, published: false });
    expect(data.recipes).toHaveLength(0);
    expect(data.keywords[0].status).toBe("new");
    expect(images.uploaded[0]).toMatch(/^dry-run\//);
    expect(data.publishing_jobs[0]).toMatchObject({ job_type: "dry_run", status: "succeeded" });
    expect((data.publishing_jobs[0].checkpoint as { recipe: unknown }).recipe).toMatchObject({ slug: "gluten-free-blueberry-muffins" });
  });
});

function brokenInsert(builder: ReturnType<ReturnType<typeof automationDb>["db"]["from"]>) {
  return {
    ...builder,
    select: (...args: unknown[]) => (builder.select as (...a: unknown[]) => unknown)(...args),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "insert failed" } }) }) }),
  };
}
