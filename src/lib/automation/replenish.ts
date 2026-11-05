// Keeps the keyword queue from running dry. When fewer than REPLENISH_BELOW
// keywords are usable, the daily worker asks Claude once for new long-tail
// keyword ideas across six categories, screens every idea in code, and adds
// the ones that pass to the Keywords list as ordinary 'new' keywords.
//
// Safety:
// - At most MAX_REPLENISH_RUNS_PER_DAY tries per UTC day, one AI call each, and
//   none once a top-up has succeeded that day. Every call goes through the
//   pipeline's daily budget check and is logged with its cost.
// - The screen drops pork, alcohol and gluten-grain dishes, generic phrases,
//   exact duplicates and near-duplicates of any keyword (whatever its status)
//   or any recipe title or focus keyword, using the same trigram similarity
//   and threshold as claim_next_keyword.
// - The ideas come with no search data. Search volume, difficulty and data
//   source stay empty; nothing is estimated.
// - It never throws. A failure is recorded (keyword_replenishments and the job
//   log) and the pipeline decides what to do: carry on with the keywords that
//   are left, or stop with a clear message when there are none.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keywordViolation } from "@/lib/recipes/dietary";
import { alwaysGlutenTerm } from "@/lib/recipes/gluten";
import { dbError } from "@/lib/services/errors";
import { normalizeKeyword } from "@/lib/services/keywords";
import { keywordCore, keywordSimilarity } from "./keywords";
import { loadKeywordQueueStats, REPLENISH_BELOW, type KeywordQueueStats } from "./keyword-queue";
import type { AiResult, AiStep, KeywordIdea, KeywordIdeaRequest } from "./types";

/** The categories ideas are asked for, in this order. Missing ones are left out. */
export const KEYWORD_IDEA_CATEGORIES = [
  "gluten-free-breakfast",
  "gluten-free-lunch",
  "gluten-free-dinner",
  "gluten-free-desserts",
  "gluten-free-snacks",
  "gluten-free-baking",
] as const;
/** 7 per category: 42 ideas per top-up, about six weeks of daily recipes. */
export const IDEAS_PER_CATEGORY = 7;
/** Tries per UTC day, counting failed ones. A successful top-up ends the day's tries. */
export const MAX_REPLENISH_RUNS_PER_DAY = 2;
/** How many "already covered" topics are sent to Claude, newest first. */
export const AVOID_LIST_LIMIT = 600;

/**
 * Words that say what kind of meal something is, not which dish it is. A
 * keyword needs at least two other words after the filler words are removed
 * ("sheet pan chicken fajitas" passes, "chicken dinner" and "dessert ideas" do not).
 */
const GENERIC_WORDS = new Set(
  (
    "idea ideas option options menu list lists meal meals food foods dish dishes dinner dinners supper lunch lunches breakfast breakfasts brunch " +
    "dessert desserts snack snacks treat treats baking baked bake goods appetizer appetizers side sides kids kid family families healthy cheap budget " +
    "party parties weeknight weekday sweet savory beginners beginner tasty delicious yummy good great top popular viral trending favorite favourite " +
    "things stuff kind kinds types style options alternatives alternative substitute substitutes"
  ).split(" "),
);

export type IdeaRejection =
  | "invalid"
  | "missing gluten free"
  | "unknown category"
  | "pork or alcohol"
  | "gluten grain"
  | "too generic"
  | "duplicate"
  | "near-duplicate";

export interface ScreenedIdeas {
  accepted: KeywordIdea[];
  rejected: Array<{ keyword: string; reason: IdeaRejection; detail?: string }>;
}

/**
 * Screens Claude's ideas. `existing` holds every keyword (any status) and every
 * recipe title and focus keyword; an idea too similar to one of them, or to an
 * idea accepted earlier in the batch, is dropped.
 */
export function screenKeywordIdeas(ideas: KeywordIdea[], opts: { existing: string[]; categorySlugs: ReadonlySet<string>; threshold: number }): ScreenedIdeas {
  const out: ScreenedIdeas = { accepted: [], rejected: [] };
  const seen = new Set(opts.existing.map(normalizeKeyword));
  const seenCores = new Set(opts.existing.map(keywordCore).filter(Boolean));
  const compareWith = opts.existing.filter((e) => keywordCore(e));

  for (const idea of ideas) {
    const keyword = (idea.keyword ?? "").toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ").trim();
    const reject = (reason: IdeaRejection, detail?: string) => out.rejected.push({ keyword: keyword || String(idea.keyword ?? ""), reason, ...(detail ? { detail } : {}) });
    const words = keyword.split(" ").filter(Boolean);
    if (keyword.length < 10 || keyword.length > 120 || words.length < 4 || words.length > 12) {
      reject("invalid", "4 to 12 words, 10 to 120 characters");
      continue;
    }
    if (!/\bgluten[- ]free\b/.test(keyword)) {
      reject("missing gluten free");
      continue;
    }
    if (!opts.categorySlugs.has(idea.category_slug)) {
      reject("unknown category", idea.category_slug);
      continue;
    }
    const dietary = keywordViolation(keyword);
    if (dietary) {
      reject("pork or alcohol", dietary.term);
      continue;
    }
    const grain = alwaysGlutenTerm(keyword);
    if (grain) {
      reject("gluten grain", grain);
      continue;
    }
    const core = keywordCore(keyword);
    if (core.split(" ").filter((w) => w && !GENERIC_WORDS.has(w)).length < 2) {
      reject("too generic");
      continue;
    }
    if (seen.has(normalizeKeyword(keyword)) || seenCores.has(core)) {
      reject("duplicate");
      continue;
    }
    const clash = [...compareWith, ...out.accepted.map((a) => a.keyword)].find((e) => keywordSimilarity(keyword, e) >= opts.threshold);
    if (clash) {
      reject("near-duplicate", clash);
      continue;
    }
    seen.add(normalizeKeyword(keyword));
    seenCores.add(core);
    out.accepted.push({ keyword, category_slug: idea.category_slug });
  }
  return out;
}

export type ReplenishOutcome =
  | { status: "not_needed"; before: KeywordQueueStats }
  | { status: "skipped"; before: KeywordQueueStats; reason: string }
  | { status: "succeeded"; before: KeywordQueueStats; after: KeywordQueueStats; suggested: number; inserted: number; rejected: number }
  | { status: "failed"; before: KeywordQueueStats; error: string };

export interface ReplenishContext {
  db: SupabaseClient;
  jobId: string;
  now: Date;
  settings: { max_keyword_difficulty: number; similarity_threshold: number };
  keywordWriter?: AiStep<KeywordIdeaRequest, KeywordIdea[]>;
  /** Runs the AI step through the pipeline: daily budget check first, then the cost log. */
  callAi: (step: AiStep<KeywordIdeaRequest, KeywordIdea[]>, input: KeywordIdeaRequest, attempt: number) => Promise<AiResult<KeywordIdea[]>>;
}

/** PostgREST / Postgres codes for a missing table or column: the migration is not applied yet. */
const MISSING = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

/** Tops up the keyword queue when it is low. Never throws. */
export async function replenishKeywords(ctx: ReplenishContext): Promise<ReplenishOutcome> {
  const { db } = ctx;
  const before = await loadKeywordQueueStats(db, ctx.settings.max_keyword_difficulty);
  if (before.usable >= REPLENISH_BELOW) return { status: "not_needed", before };
  if (!ctx.keywordWriter) return { status: "skipped", before, reason: "No keyword writer is configured for this run." };

  const today = ctx.now.toISOString().slice(0, 10);
  const { data: runs, error: runsError } = await db.from("keyword_replenishments").select("id, status").eq("run_date", today);
  if (runsError) {
    return MISSING.has(runsError.code ?? "")
      ? { status: "skipped", before, reason: "The keyword replenishment migration is not applied yet, so the queue cannot be topped up automatically (see docs/AUTOMATION.md)." }
      : { status: "failed", before, error: `Could not read today's keyword top-ups: ${runsError.message}` };
  }
  const todays = (runs ?? []) as Array<{ status: string }>;
  if (todays.some((r) => r.status === "succeeded")) return { status: "skipped", before, reason: "The keyword queue was already topped up today. The next top-up can run tomorrow." };
  if (todays.length >= MAX_REPLENISH_RUNS_PER_DAY) {
    return { status: "skipped", before, reason: `Keyword top-up already tried ${todays.length} times today without success. The next try is tomorrow.` };
  }

  const { data: row, error: rowError } = await db
    .from("keyword_replenishments")
    .insert({ job_id: ctx.jobId, run_date: today, status: "running", usable_before: before.usable, requested: 0 })
    .select("id")
    .single();
  if (rowError) return { status: "failed", before, error: `Could not record the keyword top-up: ${rowError.message}` };
  const rowId = (row as { id: string }).id;
  const update = async (patch: Record<string, unknown>) => {
    const { error } = await db.from("keyword_replenishments").update(patch).eq("id", rowId);
    if (error) console.error(`Could not update keyword top-up ${rowId}: ${error.message}`);
  };
  const finish = (patch: Record<string, unknown>) => update({ ...patch, finished_at: new Date().toISOString() });

  try {
    const { data: cats, error: catError } = await db.from("categories").select("id, slug, name").in("slug", [...KEYWORD_IDEA_CATEGORIES]);
    if (catError) throw dbError("Load categories", catError);
    const categories = ((cats ?? []) as Array<{ id: string; slug: string; name: string }>).sort(
      (a, b) => KEYWORD_IDEA_CATEGORIES.indexOf(a.slug as never) - KEYWORD_IDEA_CATEGORIES.indexOf(b.slug as never),
    );
    if (categories.length === 0) throw new Error("None of the breakfast, lunch, dinner, dessert, snack or baking categories exist.");

    const existing = await loadCoveredTopics(db);
    const avoid = [...new Set(existing.map(keywordCore).filter(Boolean))].slice(0, AVOID_LIST_LIMIT);
    const request: KeywordIdeaRequest = { categories: categories.map((c) => ({ slug: c.slug, name: c.name, count: IDEAS_PER_CATEGORY })), avoid };
    const requested = categories.length * IDEAS_PER_CATEGORY;
    await update({ requested });

    const result = await ctx.callAi(ctx.keywordWriter, request, todays.length + 1);
    const screened = screenKeywordIdeas(result.output, { existing, categorySlugs: new Set(categories.map((c) => c.slug)), threshold: ctx.settings.similarity_threshold });

    let inserted = 0;
    if (screened.accepted.length > 0) {
      const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
      const note = `AI suggestion (${result.promptVersion}, ${today}). No search volume or difficulty data.`;
      const { data, error } = await db
        .from("keywords")
        .upsert(
          screened.accepted.map((a) => ({ keyword: a.keyword, category_id: bySlug.get(a.category_slug) ?? null, notes: note })),
          { onConflict: "normalized_keyword", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw dbError("Add keywords", error);
      inserted = data?.length ?? 0;
    }

    const after = await loadKeywordQueueStats(db, ctx.settings.max_keyword_difficulty);
    const summary = {
      suggested: result.output.length,
      inserted,
      rejected: screened.rejected.length,
      usable_after: after.usable,
      cost_usd: result.costUsd,
      rejections: screened.rejected.slice(0, 60),
    };
    if (inserted === 0) {
      const error = `None of the ${result.output.length} keyword ideas could be added (${rejectionSummary(screened.rejected)}).`;
      await finish({ ...summary, status: "failed", error_message: error });
      return { status: "failed", before, error };
    }
    await finish({ ...summary, status: "succeeded", error_message: null });
    return { status: "succeeded", before, after, suggested: result.output.length, inserted, rejected: screened.rejected.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error_message: error.slice(0, 2000) });
    return { status: "failed", before, error };
  }
}

/** "3 near-duplicate, 1 pork or alcohol" */
export function rejectionSummary(rejected: ScreenedIdeas["rejected"]): string {
  if (rejected.length === 0) return "none were returned";
  const counts = new Map<string, number>();
  for (const r of rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} ${reason}`).join(", ");
}

const PAGE = 1000;

/** Every keyword (any status), recipe title and focus keyword, newest first. */
async function loadCoveredTopics(db: SupabaseClient): Promise<string[]> {
  const out: string[] = [];
  for (const [table, columns] of [
    ["keywords", "keyword"],
    ["recipes", "title, focus_keyword"],
  ] as const) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select(columns).order("created_at", { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw dbError(`Load ${table}`, error);
      const rows = (data ?? []) as unknown as Array<Record<string, string | null>>;
      for (const r of rows) for (const v of Object.values(r)) if (v) out.push(v);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}
