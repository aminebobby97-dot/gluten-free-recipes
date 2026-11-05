import { describe, expect, it, vi } from "vitest";
import { automationDb, fakeProviders } from "./support/automation-fixtures";
import { describeKeywordQueue, loadKeywordQueueStats, REPLENISH_BELOW } from "@/lib/automation/keyword-queue";
import { IDEAS_PER_CATEGORY, MAX_REPLENISH_RUNS_PER_DAY, screenKeywordIdeas } from "@/lib/automation/replenish";
import { keywordPrompt } from "@/lib/automation/providers/anthropic";
import { alwaysGlutenTerm } from "@/lib/recipes/gluten";
import type { KeywordIdea } from "@/lib/automation/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { runDailyRecipe, noKeywordsMessage } = await import("@/lib/automation/pipeline");

const NOW = new Date("2026-11-06T02:00:00Z");
const BAKING = new Set(["gluten-free-baking"]);
const idea = (keyword: string, category_slug = "gluten-free-baking"): KeywordIdea => ({ keyword, category_slug });

describe("screenKeywordIdeas", () => {
  const screen = (ideas: KeywordIdea[], existing: string[] = []) => screenKeywordIdeas(ideas, { existing, categorySlugs: BAKING, threshold: 0.5 });

  it("keeps specific long-tail gluten-free recipe searches", () => {
    const out = screen([idea("Gluten Free Lemon Blueberry Muffins with Almond Flour"), idea("gluten-free sheet pan chicken fajitas")]);
    expect(out.accepted.map((a) => a.keyword)).toEqual(["gluten free lemon blueberry muffins with almond flour", "gluten-free sheet pan chicken fajitas"]);
    expect(out.rejected).toEqual([]);
  });

  it("drops pork, alcohol and gluten-grain dishes", () => {
    const out = screen([
      idea("gluten free bacon cheddar scones recipe"),
      idea("gluten free beer bread with cheddar"),
      idea("gluten free rum raisin cookies"),
      idea("gluten free vanilla extract pound cake"),
      idea("gluten free rye sandwich bread loaf"),
      idea("gluten free malted chocolate milkshake"),
    ]);
    expect(out.accepted).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["pork or alcohol", "pork or alcohol", "pork or alcohol", "pork or alcohol", "gluten grain", "gluten grain"]);
  });

  it("drops generic phrases, invalid ideas and unknown categories", () => {
    const out = screen([
      idea("gluten free dinner ideas for kids"),
      idea("easy gluten free dessert recipes"),
      idea("gluten free chicken dinner recipe"),
      idea("gluten free bread"),
      idea("dairy free banana chocolate chip muffins"),
      idea("gluten free carrot cake cupcakes", "gluten-free-pizza"),
    ]);
    expect(out.accepted).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["too generic", "too generic", "too generic", "invalid", "missing gluten free", "unknown category"]);
  });

  it("drops duplicates and near-duplicates of keywords, recipes and each other", () => {
    const out = screen(
      [
        idea("gluten free banana bread"), // same keyword, other filler words
        idea("easy gluten free blueberry muffins recipe"), // same core as an existing recipe title
        idea("best gluten free lemon blueberry muffins"), // near-duplicate of an existing recipe
        idea("gluten free pumpkin snickerdoodle cookies"),
        idea("gluten free pumpkin snickerdoodle cookie bars"), // near-duplicate of the idea above
      ],
      ["Gluten-Free Banana Bread Recipe", "Gluten-Free Blueberry Muffins"],
    );
    expect(out.accepted.map((a) => a.keyword)).toEqual(["gluten free pumpkin snickerdoodle cookies"]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["duplicate", "duplicate", "near-duplicate", "near-duplicate"]);
  });
});

describe("alwaysGlutenTerm", () => {
  it("finds gluten grains but not wheat-free or buckwheat", () => {
    expect(alwaysGlutenTerm("gluten free barley risotto")).toBe("barley");
    expect(alwaysGlutenTerm("gluten free wheat-free crackers")).toBeNull();
    expect(alwaysGlutenTerm("gluten free buckwheat pancakes")).toBeNull();
  });
});

describe("keyword prompt", () => {
  it("asks for a fixed number per category and lists what is covered, with no search data", () => {
    const prompt = keywordPrompt({ categories: [{ slug: "gluten-free-baking", name: "Gluten-Free Baking", count: 7 }], avoid: ["banana bread"] });
    expect(prompt).toContain("Suggest 7 new keyword ideas");
    expect(prompt).toContain("- gluten-free-baking (Gluten-Free Baking): 7");
    expect(prompt).toContain("- banana bread");
    expect(prompt).not.toMatch(/volume|difficulty/i);
  });
});

describe("loadKeywordQueueStats", () => {
  it("counts only keywords the worker can pick as usable", async () => {
    const { db } = automationDb({
      keywords: [
        { id: "a", keyword: "gluten free a", status: "new", keyword_difficulty: null },
        { id: "b", keyword: "gluten free b", status: "new", keyword_difficulty: 35 },
        { id: "c", keyword: "gluten free c", status: "new", keyword_difficulty: 60 },
        { id: "d", keyword: "gluten free d", status: "new", attempt_count: 3 },
        { id: "e", keyword: "gluten free e", status: "used" },
        { id: "f", keyword: "gluten free f", status: "rejected" },
        { id: "g", keyword: "gluten free g", status: "queued" },
      ],
    });
    const stats = await loadKeywordQueueStats(db, 40);
    expect(stats).toEqual({ usable: 2, tooHard: 1, outOfAttempts: 1, queued: 1, assigned: 0, used: 1, rejected: 1, total: 7 });
    expect(describeKeywordQueue(stats)).toBe(
      "2 usable of 7 keyword(s): 1 used, 1 held by a job, 1 rejected, 1 skipped as harder than the maximum difficulty, 1 skipped after 3 failed attempts.",
    );
  });
});

// --- In the daily run ----------------------------------------------------------

// The first one matches the test recipe; the rest only fill the queue.
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `kw-${i + 1}`, keyword: i === 0 ? "gluten free blueberry muffins" : `gluten free test dish number ${i + 1}`, status: "new" }));
const IDEAS = [
  idea("gluten free lemon poppy seed loaf cake"),
  idea("gluten free cinnamon swirl sandwich bread"),
  idea("gluten free bacon cheddar scones recipe"), // screened out
];

function withWriter(ideas: KeywordIdea[] | Error = IDEAS) {
  const ai = fakeProviders();
  let calls = 0;
  const keywordWriter = {
    calls: () => calls,
    estimateUsd: () => 0.2,
    run: async () => {
      calls++;
      if (ideas instanceof Error) throw ideas;
      return { output: ideas, provider: "fake", model: "fake-keywords", promptVersion: "keywords-test", costUsd: 0.05 };
    },
  };
  return { ...ai, providers: { ...ai.providers, keywordWriter }, keywordWriter };
}

const run = (db: ReturnType<typeof automationDb>["db"], ai: ReturnType<typeof withWriter>, extra: Partial<Parameters<typeof runDailyRecipe>[0]> = {}) =>
  runDailyRecipe({
    db,
    providers: ai.providers,
    images: { upload: async (p) => `https://cdn.test/${p}`, remove: async () => undefined },
    site: { revalidate: async () => undefined },
    requestedMode: "review",
    trigger: "schedule",
    envEnabled: true,
    now: NOW,
    ...extra,
  });

describe("runDailyRecipe: keyword top-up", () => {
  it("adds screened keyword ideas first when fewer than 30 are usable, then makes the recipe", async () => {
    const { db, data } = automationDb();
    const ai = withWriter();
    expect(await run(db, ai)).toMatchObject({ status: "succeeded", slug: "gluten-free-blueberry-muffins" });

    expect(ai.keywordWriter.calls()).toBe(1);
    const added = data.keywords.filter((k) => String(k.notes ?? "").startsWith("AI suggestion"));
    expect(added.map((k) => k.keyword)).toEqual(["gluten free lemon poppy seed loaf cake", "gluten free cinnamon swirl sandwich bread"]);
    // No invented metrics.
    expect(added.every((k) => k.search_volume === undefined && k.keyword_difficulty === undefined && k.data_source === undefined)).toBe(true);
    expect(added[0]).toMatchObject({ category_id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", notes: "AI suggestion (keywords-test, 2026-11-06). No search volume or difficulty data." });

    expect(data.keyword_replenishments).toHaveLength(1);
    expect(data.keyword_replenishments[0]).toMatchObject({ run_date: "2026-11-06", status: "succeeded", usable_before: 1, requested: IDEAS_PER_CATEGORY, suggested: 3, inserted: 2, rejected: 1, cost_usd: 0.05 });
    // Logged and counted toward the daily budget like every AI call.
    expect(data.generation_attempts[0]).toMatchObject({ kind: "keywords", cost_usd: 0.05, prompt_version: "keywords-test" });
    expect(data.publishing_job_events.find((e) => e.step === "replenish_keywords")).toMatchObject({ status: "succeeded" });
  });

  it("does not ask for ideas while enough keywords are usable", async () => {
    const { db, data } = automationDb({ keywords: many(REPLENISH_BELOW) });
    const ai = withWriter();
    expect((await run(db, ai)).status).toBe("succeeded");
    expect(ai.keywordWriter.calls()).toBe(0);
    expect(data.keyword_replenishments ?? []).toHaveLength(0);
  });

  it("stops safely with a clear message when the queue is empty and the top-up fails", async () => {
    const { db, data } = automationDb({ keywords: [{ id: "kw-1", keyword: "gluten free blueberry muffins", status: "used" }] });
    const ai = withWriter(new Error("Claude is unavailable"));
    const result = await run(db, ai);
    expect(result).toMatchObject({ status: "failed" });
    const error = (result as { error: string }).error;
    expect(error).toContain("No usable keywords left (0 usable of 1 keyword(s): 1 used.)");
    expect(error).toContain("Automatic keyword top-up failed: Claude is unavailable");
    expect(error).toContain("No recipe was generated.");
    expect(ai.writer.calls()).toBe(0);
    expect(data.recipes).toHaveLength(0);
    expect(data.keyword_replenishments[0]).toMatchObject({ status: "failed", error_message: "Claude is unavailable" });
    expect(data.publishing_job_events.find((e) => e.step === "replenish_keywords")).toMatchObject({ status: "failed" });
  });

  it("fails the top-up when every idea is screened out", async () => {
    const { db, data } = automationDb({ keywords: [] });
    const ai = withWriter([idea("gluten free beer bread with cheddar"), idea("gluten free dinner ideas for kids")]);
    const result = await run(db, ai);
    expect((result as { error: string }).error).toContain("None of the 2 keyword ideas could be added (1 pork or alcohol, 1 too generic).");
    expect(data.keywords).toHaveLength(0);
    expect(ai.writer.calls()).toBe(0);
  });

  it("tries at most twice a day and never again after a successful top-up", async () => {
    const failedTwice = automationDb({ keywords: [] });
    failedTwice.data.keyword_replenishments = Array.from({ length: MAX_REPLENISH_RUNS_PER_DAY }, (_, i) => ({ id: `r${i}`, run_date: "2026-11-06", status: "failed" }));
    const ai = withWriter();
    const result = await run(failedTwice.db, ai);
    expect((result as { error: string }).error).toContain("Automatic keyword top-up did not run: Keyword top-up already tried 2 times today without success.");
    expect(ai.keywordWriter.calls()).toBe(0);

    const done = automationDb();
    done.data.keyword_replenishments = [{ id: "r1", run_date: "2026-11-06", status: "succeeded" }];
    const ai2 = withWriter();
    expect((await run(done.db, ai2)).status).toBe("succeeded"); // one keyword was still usable
    expect(ai2.keywordWriter.calls()).toBe(0);
    expect(done.data.publishing_job_events.find((e) => e.step === "replenish_keywords")).toMatchObject({ status: "skipped" });
  });

  it("keeps to the daily AI budget", async () => {
    const { db, data } = automationDb({ keywords: [], spent: 2.9 });
    const ai = withWriter();
    const result = await run(db, ai);
    expect((result as { error: string }).error).toContain("Daily AI budget reached");
    expect(ai.keywordWriter.calls()).toBe(0);
    expect(data.generation_attempts.filter((a) => a.status === "succeeded")).toHaveLength(0);
  });

  it("goes on with the recipe when the top-up fails but keywords are left", async () => {
    const { db } = automationDb();
    const ai = withWriter(new Error("Claude is unavailable"));
    expect(await run(db, ai)).toMatchObject({ status: "succeeded", slug: "gluten-free-blueberry-muffins" });
  });

  it("never tops up during a dry run", async () => {
    const { db, data } = automationDb({ keywords: [] });
    const ai = withWriter();
    await run(db, ai, { requestedMode: "dry_run", trigger: "manual", dryRunKeyword: "gluten free blueberry muffins" });
    expect(ai.keywordWriter.calls()).toBe(0);
    expect(data.keywords).toHaveLength(0);
  });

  it("tries the claim again when it gives up early while usable keywords remain", async () => {
    const { db, data, calls } = automationDb({ keywords: many(REPLENISH_BELOW) });
    // The first claim stops after rejecting near-duplicates and returns nothing.
    const original = (db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> }).rpc;
    let first = true;
    (db as unknown as { rpc: unknown }).rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_next_keyword" && first) {
        first = false;
        return { data: null, error: null };
      }
      return original(name, args);
    };
    expect((await run(db, withWriter())).status).toBe("succeeded");
    expect(data.keywords[0].status).toBe("assigned");
    expect(calls.filter((c) => c.table === "rpc:claim_next_keyword")).toHaveLength(1); // the faked first call is not recorded
  });
});

describe("noKeywordsMessage", () => {
  it("says the queue is empty without blaming the top-up when none was needed", () => {
    const empty = { usable: 0, tooHard: 0, outOfAttempts: 0, queued: 0, assigned: 0, used: 0, rejected: 0, total: 0 };
    expect(noKeywordsMessage(empty, { status: "not_needed", before: empty })).toBe(
      "No usable keywords left (0 usable of 0 keyword(s).) No recipe was generated. Import more keywords in /admin/keywords, or the next run will try the top-up again.",
    );
  });
});
