// The daily publishing pipeline: keyword -> recipe -> checks -> photo -> save
// -> (publish) -> refresh the site. Runs in the GitHub Actions worker with the
// service-role client. Nothing becomes public unless every step succeeds:
// the recipe row is only created after all checks and the photo pass, and
// publishing is a single database transaction (publish_generated_recipe).
//
// Each step saves a checkpoint on the job, so a retry resumes where the last
// run stopped instead of paying for the same AI work twice.
//
// A draft the checks rejected can be recovered: a person puts a corrected copy
// on the failed job's checkpoint (corrected_draft) and runs the job again. The
// corrected draft goes through every check, including the AI reviewer, but is
// never rewritten or repaired by the writer, and always lands in review.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeDietaryRestrictions, dietaryRejectionReason, keywordViolation } from "@/lib/recipes/dietary";
import { recipeInputSchema } from "@/lib/recipes/schema";
import { dbError } from "@/lib/services/errors";
import { claimJob, failJob, getOrCreateDailyJob, MAX_JOB_RETRIES, recordJobStep, toJobDate, JOB_LEASE_MINUTES, type PublishingJob } from "@/lib/services/jobs";
import { BudgetExceededError } from "./cost";
import { describeKeywordQueue, loadKeywordQueueStats, type KeywordQueueStats } from "./keyword-queue";
import { replenishKeywords, type ReplenishOutcome } from "./replenish";
import { checkBudget, logEvent, markAttempt, recordAttempt, spentToday, type AttemptKind } from "./log";
import { AiCallError, type AiProviders, type AiResult, type AiStep, type CategoryOption, type GeneratedRecipe, type ImageStore, type Issue, type KeywordRow, type Photo, type ReviewVerdict, type SiteRefresher } from "./types";
import { blocking, parseGeneratedRecipe, validateGeneratedRecipe } from "./validate";
import { applyWordingFixes } from "./wording";
import { repairGlutenRemovalClaims } from "@/lib/recipes/cookware";
import { repairMinorDietaryIssues } from "@/lib/recipes/dietary-repair";

export type RunMode = "dry_run" | "review" | "auto";

export interface AutomationSettings {
  enabled: boolean;
  publish_mode: "review" | "auto";
  min_reviewed_before_auto: number;
  daily_budget_usd: number;
  max_keyword_difficulty: number;
  similarity_threshold: number;
  pinterest_enabled: boolean;
}

export interface PipelineOptions {
  db: SupabaseClient;
  providers: AiProviders;
  images: ImageStore;
  site: SiteRefresher;
  requestedMode: RunMode;
  trigger: "schedule" | "manual";
  /** AUTOMATION_ENABLED in the worker's environment. */
  envEnabled: boolean;
  runUrl?: string | null;
  /** Dry runs only: generate for this keyword instead of the next one in the queue. */
  dryRunKeyword?: string;
  /**
   * Finish this failed job (from any date) instead of today's. Only for a job
   * that carries a corrected draft, so it can never start a new recipe.
   */
  resumeJobId?: string;
  /**
   * Prepares the recipe's Pinterest Pin after an automatic publish (image and
   * text). Posting it is a separate step (src/lib/automation/pins.ts) after the
   * page is confirmed live. Optional and never fatal: a Pin problem is logged
   * and the published recipe stays as it is.
   */
  preparePin?: (recipeId: string, jobId: string) => Promise<void>;
  now?: Date;
}

export type PipelineResult =
  | { status: "skipped"; reason: string }
  | { status: "failed"; jobId: string; mode: RunMode; error: string }
  | { status: "succeeded"; jobId: string; mode: RunMode; recipeId: string | null; slug: string; imageUrl: string; published: boolean };

/**
 * AI repair rounds after the writer's first draft. The second round only runs
 * when the first repair made progress but left a different, fixable problem,
 * and the daily budget still covers it and the photo (see shouldRepairAgain).
 * Minor ingredient problems are corrected in code first and cost no round.
 */
export const MAX_REPAIR_ROUNDS = 2;
export const MAX_PHOTO_ATTEMPTS = 3;
/** Keywords for pork or alcohol dishes skipped in one run before giving up. */
export const MAX_KEYWORD_SKIPS = 10;

class PipelineError extends Error {
  constructor(
    message: string,
    public readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

interface Checkpoint {
  keyword_id?: string;
  recipe?: GeneratedRecipe;
  /** A person's corrected copy of a rejected draft. Checked again in full before it is used. */
  corrected_draft?: unknown;
  /** Who corrected what, shown in the job log. */
  correction?: { note?: string; source_attempt_id?: string; corrected_at?: string };
  /** Set when the corrected draft failed its checks, so a retry does not pay to review it again. */
  corrected_draft_rejected_at?: string;
  image?: StoredImage;
  /** Only on jobs from before the Pinterest photo step was removed; kept so its file is cleaned up. */
  pin_image?: StoredImage;
  recipe_id?: string;
}

interface StoredImage {
  path: string;
  url: string;
  alt: string;
}

export async function loadSettings(db: SupabaseClient): Promise<AutomationSettings> {
  const { data, error } = await db.from("automation_settings").select("*").eq("id", true).single();
  if (error) throw dbError("Load automation settings", error);
  const s = data as AutomationSettings;
  return { ...s, daily_budget_usd: Number(s.daily_budget_usd), max_keyword_difficulty: Number(s.max_keyword_difficulty) };
}

/** AI recipes a person approved (approved_at is set only when an admin publishes one), whatever their status now. */
async function countReviewedAiRecipes(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("recipes").select("id").eq("source", "ai").not("approved_at", "is", null);
  if (error) throw dbError("Count reviewed recipes", error);
  return data?.length ?? 0;
}

/** Decides how this run may behave. Returns a reason string when it must not run. */
export async function resolveMode(db: SupabaseClient, settings: AutomationSettings, opts: Pick<PipelineOptions, "requestedMode" | "trigger" | "envEnabled">): Promise<RunMode | { skip: string }> {
  if (!(settings.daily_budget_usd > 0)) return { skip: "The daily AI budget is 0." };
  if (opts.requestedMode === "dry_run") {
    return opts.trigger === "manual" ? "dry_run" : { skip: "Dry runs can only be started manually." };
  }
  if (!opts.envEnabled || !settings.enabled) return { skip: "Automation is turned off." };
  if (opts.requestedMode === "auto" && settings.publish_mode === "auto") {
    const reviewed = await countReviewedAiRecipes(db);
    if (reviewed >= settings.min_reviewed_before_auto) return "auto";
  }
  return "review";
}

export async function runDailyRecipe(opts: PipelineOptions): Promise<PipelineResult> {
  const { db, providers } = opts;
  const now = opts.now ?? new Date();
  const settings = await loadSettings(db);
  const resolved = await resolveMode(db, settings, opts);
  if (typeof resolved !== "string") return { status: "skipped", reason: resolved.skip };
  let mode: RunMode = resolved;
  if (mode !== "dry_run") {
    // Housekeeping only: a problem here never stops the day's recipe.
    await releaseStaleKeywords(db, toJobDate(now)).catch((err: unknown) => console.error(`Could not release stale keywords: ${err instanceof Error ? err.message : String(err)}`));
  }

  // --- Job -------------------------------------------------------------------
  let job: PublishingJob | null;
  if (opts.resumeJobId) {
    if (mode === "dry_run") return { status: "skipped", reason: "A job can only be resumed in review mode, not as a dry run." };
    const { data, error } = await db.from("publishing_jobs").select("*").eq("id", opts.resumeJobId).maybeSingle();
    if (error) throw dbError("Load publishing job", error);
    const target = data as PublishingJob | null;
    if (!target || target.job_type !== "daily_recipe") return { status: "skipped", reason: `No daily recipe job ${opts.resumeJobId}.` };
    if (!(target.checkpoint as Checkpoint | undefined)?.corrected_draft) {
      return { status: "skipped", reason: "That job has no corrected draft. Resuming by job id is only for finishing a job with a corrected draft." };
    }
    job = await claimJob(db, target, now);
    if (!job) return { status: "skipped", reason: "That job is already done, running, or out of retries." };
  } else if (mode === "dry_run") {
    const { data, error } = await db
      .from("publishing_jobs")
      .insert({
        job_type: "dry_run",
        job_date: toJobDate(now),
        idempotency_key: `dry_run:${now.toISOString()}`,
        status: "running",
        started_at: now.toISOString(),
        lease_expires_at: new Date(now.getTime() + JOB_LEASE_MINUTES * 60_000).toISOString(),
      })
      .select("*")
      .single();
    if (error) throw dbError("Create dry-run job", error);
    job = data as PublishingJob;
  } else {
    job = await claimJob(db, await getOrCreateDailyJob(db, toJobDate(now)), now);
    if (!job) return { status: "skipped", reason: "Today's job is already done, running, or out of retries." };
  }
  const jobId = job.id;
  const claimedJob = job;
  const retriesBefore = job.retry_count;
  const cp: Checkpoint = { ...((job.checkpoint as Checkpoint | undefined) ?? {}) };
  // A person edited this recipe, so a person approves it: never publish it automatically.
  if (cp.corrected_draft && !cp.recipe && mode === "auto") mode = "review";
  await db.from("publishing_jobs").update({ mode, trigger: opts.trigger, run_url: opts.runUrl ?? null }).eq("id", jobId);

  const saveCheckpoint = async (patch: Checkpoint) => {
    Object.assign(cp, patch);
    const { error } = await db.from("publishing_jobs").update({ checkpoint: cp }).eq("id", jobId);
    if (error) throw dbError("Save checkpoint", error);
  };

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    await recordJobStep(db, jobId, name);
    await logEvent(db, jobId, name, "started");
    const t0 = Date.now();
    try {
      const out = await fn();
      await logEvent(db, jobId, name, "succeeded", undefined, {}, Date.now() - t0);
      return out;
    } catch (err) {
      await logEvent(db, jobId, name, "failed", err instanceof Error ? err.message : String(err), {}, Date.now() - t0);
      throw err;
    }
  };

  let keywordId: string | null = cp.keyword_id ?? null;
  const callAi = async <I, O>(kind: AttemptKind, ai: AiStep<I, O>, input: I, attempt: number): Promise<{ result: AiResult<O>; attemptId: string }> => {
    await checkBudget(db, ai.estimateUsd(input), settings.daily_budget_usd);
    const t0 = Date.now();
    try {
      const result = await ai.run(input);
      const { output, ...meta } = result;
      const stored = kind === "image" || kind === "pin_image" ? { bytes: (output as Photo).data.length, mimeType: (output as Photo).mimeType } : output;
      const attemptId = await recordAttempt(db, { jobId, keywordId, kind, attempt, status: "succeeded", result: meta, output: stored, durationMs: Date.now() - t0 }, "unknown", "unknown");
      return { result, attemptId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const billed = err instanceof AiCallError ? { provider: err.provider, model: err.model, promptVersion: "unknown", costUsd: err.costUsd } : undefined;
      await recordAttempt(db, { jobId, keywordId, kind, attempt, status: "error", errorMessage: message, result: billed, durationMs: Date.now() - t0 }, "unknown", "unknown");
      throw err;
    }
  };

  // Asks for new keyword ideas when the queue is low. Never throws: a failure
  // is logged and the claim below decides whether the run can go on.
  const topUpKeywords = async (): Promise<ReplenishOutcome> => {
    const outcome = await replenishKeywords({
      db,
      jobId,
      now,
      settings,
      keywordWriter: providers.keywordWriter,
      callAi: async (ai, input, attempt) => (await callAi("keywords", ai, input, attempt)).result,
    }).catch((err: unknown): ReplenishOutcome => ({ status: "failed", before: EMPTY_QUEUE, error: err instanceof Error ? err.message : String(err) }));
    if (outcome.status === "not_needed") return outcome;
    const queue = describeKeywordQueue(outcome.before);
    if (outcome.status === "succeeded") {
      await logEvent(db, jobId, "replenish_keywords", "succeeded", `Keyword queue was low (${queue}) Added ${outcome.inserted} new keyword idea(s); ${outcome.rejected} idea(s) were screened out. ${outcome.after.usable} usable now.`, { ...outcome });
    } else if (outcome.status === "skipped") {
      await logEvent(db, jobId, "replenish_keywords", "skipped", `Keyword queue is low (${queue}) ${outcome.reason}`);
    } else {
      await logEvent(db, jobId, "replenish_keywords", "failed", `Keyword queue is low (${queue}) Automatic top-up failed: ${outcome.error}`);
    }
    return outcome;
  };

  // Runs every check on a person's corrected draft, including one AI review.
  // Never calls the writer or the repairer: a draft that still fails stops the
  // run, and is not reviewed again until a person replaces it.
  const checkCorrectedDraft = async (keyword: KeywordRow, categories: CategoryOption[]): Promise<GeneratedRecipe> => {
    if (cp.corrected_draft_rejected_at) {
      throw new PipelineError("The corrected draft already failed its checks. Replace it with a new correction before running this job again.");
    }
    await logEvent(db, jobId, "generate_recipe", "info", "Checking a corrected draft from a person. The writer is not called.", { correction: cp.correction ?? {} });
    const { count } = await db.from("generation_attempts").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "review");
    const { recipe: parsed, issues } = await evaluate(db, cp.corrected_draft, keyword, categories, settings, (r) => callAi("review", providers.reviewer, r, (count ?? 0) + 1));
    const blockers = blocking(issues);
    await logEvent(db, jobId, "generate_recipe", "info", blockers.length || !parsed ? "The corrected draft failed its checks." : "The corrected draft passed every check.", { issues });
    if (!parsed || blockers.length > 0) {
      await saveCheckpoint({ corrected_draft_rejected_at: new Date().toISOString() });
      throw new PipelineError(`The corrected draft failed ${blockers.length} check(s): ${blockers.slice(0, 5).map((b) => b.message).join(" ")}`, blockers);
    }
    await saveCheckpoint({ recipe: parsed });
    return parsed;
  };

  // Decides whether another AI repair round is worth it. Never more than
  // MAX_REPAIR_ROUNDS, so a recipe can never loop. After the first repair,
  // another round needs: a different set of problems than last time (the
  // repairer made progress and is not stuck), no near-duplicate problem (that
  // needs a different dish, not a repair), and enough budget left today for the
  // repair, its review and at least one photo.
  const shouldRepairAgain = async (ctx: {
    round: number;
    blockers: Issue[];
    previous: Issue[] | null;
    parsed: GeneratedRecipe | null;
    input: { keyword: KeywordRow; categories: CategoryOption[]; existingTitles: string[] };
  }): Promise<{ ok: boolean; reason?: string }> => {
    if (ctx.round >= MAX_REPAIR_ROUNDS) return { ok: false, reason: `No repair rounds left (limit ${MAX_REPAIR_ROUNDS}).` };
    if (ctx.round === 0) return { ok: true };
    if (!ctx.parsed) return { ok: false, reason: "The repaired draft could not be read." };
    if (ctx.blockers.some((b) => b.source === "duplicate")) return { ok: false, reason: "The recipe is too close to an existing one; a repair cannot fix that." };
    if (ctx.previous && sameProblems(ctx.previous, ctx.blockers)) return { ok: false, reason: "The last repair left exactly the same problems, so another round was not tried." };
    const recipe = ctx.parsed;
    const needed =
      providers.repairer.estimateUsd({ ...ctx.input, draft: recipe, issues: ctx.blockers }) +
      providers.reviewer.estimateUsd(recipe) +
      providers.photographer.estimateUsd({ recipe, orientation: "landscape" }) +
      providers.photoChecker.estimateUsd({ recipe, photo: { data: new Uint8Array(), mimeType: "image/webp" } });
    const spent = await spentToday(db);
    if (spent + needed > settings.daily_budget_usd) {
      return {
        ok: false,
        reason: `Another repair round was not tried: with the photo it could cost up to $${needed.toFixed(2)}, and $${spent.toFixed(2)} of the $${settings.daily_budget_usd.toFixed(2)} daily budget is already spent.`,
      };
    }
    return { ok: true };
  };

  try {
    // --- 1. Keyword ------------------------------------------------------------
    const keyword = await step("select_keyword", async () => {
      if (cp.keyword_id) {
        const saved = await loadKeyword(db, cp.keyword_id);
        // A keyword claimed before the pork-free and alcohol-free rule existed.
        // Only an unfinished job reaches here; a corrected draft is still checked in full.
        if (cp.recipe || cp.corrected_draft || !keywordViolation(saved.keyword)) return saved;
        await rejectKeyword(db, jobId, saved);
      } else if (mode === "dry_run") {
        const preview = await previewKeyword(db, opts.dryRunKeyword);
        const violation = keywordViolation(preview.keyword);
        if (violation) throw new PipelineError(`The keyword "${preview.keyword}" asks for a dish with ${violation.term}, which recipes must not contain. Try another keyword.`);
        return preview;
      }
      // Tops up the queue first when fewer than REPLENISH_BELOW keywords are usable.
      const refill = await topUpKeywords();
      // Keywords for pork or alcohol dishes are rejected without spending
      // anything on AI, and the next keyword in the queue is tried.
      for (let tries = 0; tries < MAX_KEYWORD_SKIPS; tries++) {
        const { data, error } = await db.rpc("claim_next_keyword", { p_job_id: jobId });
        if (error) throw dbError("Claim keyword", error);
        const claimed = data as KeywordRow | null;
        if (!claimed?.id) {
          // claim_next_keyword gives up after rejecting 50 near-duplicates in one
          // call, so "nothing claimed" does not always mean the queue is empty.
          const left = await loadKeywordQueueStats(db, settings.max_keyword_difficulty);
          if (left.usable > 0) continue;
          throw new PipelineError(noKeywordsMessage(left, refill));
        }
        if (keywordViolation(claimed.keyword)) {
          await rejectKeyword(db, jobId, claimed);
          continue;
        }
        await saveCheckpoint({ keyword_id: claimed.id });
        return claimed;
      }
      throw new PipelineError(
        `No keyword could be claimed after ${MAX_KEYWORD_SKIPS} tries: the keywords tried were for pork or alcohol dishes, or too similar to existing recipes, and were rejected. No recipe was generated. Import more keywords in /admin/keywords.`,
      );
    });
    keywordId = keyword.id || null;

    const categories = await loadCategories(db);
    const existingTitles = await loadTitles(db);

    // --- 2. Recipe ---------------------------------------------------------------
    const recipe = await step("generate_recipe", async () => {
      if (cp.recipe) return cp.recipe;
      if (cp.corrected_draft) return checkCorrectedDraft(keyword, categories);
      const input = { keyword, categories, existingTitles };
      let { result, attemptId } = await callAi("recipe", providers.writer, input, 1);
      let previous: Issue[] | null = null;
      for (let round = 0; ; round++) {
        const { recipe: parsed, issues } = await evaluate(db, result.output, keyword, categories, settings, (r) => callAi("review", providers.reviewer, r, round + 1));
        const blockers = blocking(issues);
        await markAttempt(db, attemptId, blockers.length ? "rejected" : "succeeded", issues);
        const fixedInCode = issues.filter((i) => i.severity === "warning" && i.message.startsWith("Fixed automatically"));
        if (fixedInCode.length > 0) {
          await logEvent(db, jobId, "generate_recipe", "info", `Corrected ${fixedInCode.length} minor problem(s) in code; every check ran again on the corrected recipe.`, { fixes: fixedInCode });
        }
        if (parsed && blockers.length === 0) {
          await saveCheckpoint({ recipe: parsed });
          return parsed;
        }
        const next = await shouldRepairAgain({ round, blockers, previous, parsed, input });
        if (!next.ok) {
          const rounds = round === 0 ? "" : ` after ${round} repair round(s)`;
          throw new PipelineError(`The recipe failed ${blockers.length} check(s)${rounds}: ${blockers.slice(0, 5).map((b) => b.message).join(" ")}${next.reason ? ` ${next.reason}` : ""}`, blockers);
        }
        if (round > 0) {
          await logEvent(db, jobId, "generate_recipe", "info", `Repair round ${round + 1} of ${MAX_REPAIR_ROUNDS}: the last repair fixed some problems but left ${blockers.length} other fixable problem(s).`, { issues: blockers });
        }
        previous = blockers;
        ({ result, attemptId } = parsed
          ? await callAi("repair", providers.repairer, { ...input, draft: parsed, issues: blockers }, round + 2)
          : await callAi("recipe", providers.writer, input, round + 2));
      }
    });

    // Final pork-free and alcohol-free gate. The checks above already ran on a
    // new draft; this also covers a recipe resumed from an earlier checkpoint,
    // so nothing that breaks the rule can reach the photo, save or publish steps.
    const dietary = analyzeDietaryRestrictions(recipe);
    if (dietary.length > 0) {
      throw new PipelineError(dietaryRejectionReason(dietary), dietary.map((v) => ({ severity: "blocking", source: "dietary", field: v.field, message: v.message })));
    }

    // --- 3. Photo ------------------------------------------------------------------
    // One landscape photo for the site. The Pinterest Pin is drawn from this same
    // photo when the recipe is published (src/lib/services/pinterest.ts), so no
    // second AI image is generated.
    // Each rejected photo's problems go into the next attempt's prompt, so a
    // retry steers away from them instead of repeating them. The checker itself
    // is never relaxed.
    const takePhoto = async (attempts: number): Promise<StoredImage> => {
      const rejections: string[][] = [];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const avoid = rejections.flat();
        const { result: shot, attemptId } = await callAi("image", providers.photographer, { recipe, orientation: "landscape", ...(avoid.length ? { avoid } : {}) }, attempt);
        const { result: check } = await callAi("image_check", providers.photoChecker, { recipe, photo: shot.output }, attempt);
        if (check.output.ok) {
          const ext = shot.output.mimeType.split("/")[1];
          const folder = mode === "dry_run" ? "dry-run" : "recipes";
          const path = `${folder}/${toJobDate(now).slice(0, 4)}/${recipe.slug}-${jobId.slice(0, 8)}.${ext}`;
          const url = await opts.images.upload(path, shot.output);
          return { path, url, alt: recipe.image_alt };
        }
        const problems = check.output.problems.length ? check.output.problems : ["The photo checker rejected it without giving a reason."];
        rejections.push(problems);
        await markAttempt(
          db,
          attemptId,
          "rejected",
          problems.map((p) => ({ severity: "blocking", source: "photo", field: "featured_image", message: p })),
        );
      }
      throw new PipelineError(photoFailureMessage(rejections), rejections.flat().map((p) => ({ severity: "blocking", source: "photo", field: "featured_image", message: p })));
    };

    const image = await step("generate_photo", async () => {
      if (cp.image) return cp.image;
      const saved = await takePhoto(MAX_PHOTO_ATTEMPTS);
      await saveCheckpoint({ image: saved });
      return saved;
    });

    // --- 4. Dry run ends here, nothing saved -------------------------------------
    if (mode === "dry_run") {
      await finishJob(db, jobId, "dry_run_complete");
      return { status: "succeeded", jobId, mode, recipeId: null, slug: recipe.slug, imageUrl: image.url, published: false };
    }

    // --- 5. Save as in review ------------------------------------------------------
    const recipeId = await step("save_recipe", async () => {
      if (cp.recipe_id) return cp.recipe_id;
      // Never a second recipe for one job, even if the checkpoint was lost.
      const { data: existing, error: existingError } = await db.from("recipes").select("id").eq("generation_job_id", jobId).maybeSingle();
      if (existingError) throw dbError("Check for an existing recipe", existingError);
      if (existing) throw new PipelineError(`This job already saved a recipe (${(existing as { id: string }).id}). Check Recipes in the admin dashboard.`);
      const category = categories.find((c) => c.slug === recipe.category_slug)!;
      const content = recipeInputSchema.parse({
        ...recipe,
        category_id: category.id,
        featured_image: image.url,
        featured_image_alt: image.alt,
        pinterest_image: null,
        pinterest_image_alt: null,
        is_tested: false,
      });
      const { data, error } = await db
        .from("recipes")
        .insert({ ...content, status: "in_review", source: "ai", image_source: "ai", generation_job_id: jobId, allergens: recipe.allergens })
        .select("id")
        .single();
      if (error) throw dbError("Save recipe", error);
      const id = (data as { id: string }).id;
      await saveCheckpoint({ recipe_id: id });
      const kw = await db.from("keywords").update({ status: "assigned", assigned_recipe_id: id }).eq("id", keyword.id);
      if (kw.error) throw dbError("Assign keyword", kw.error);
      await recordJobStep(db, jobId, "save_recipe", { recipe_id: id });
      return id;
    });

    // --- 6. Publish (auto) or hand over for review -------------------------------
    if (mode === "review") {
      await finishJob(db, jobId, "awaiting_review");
      return { status: "succeeded", jobId, mode, recipeId, slug: recipe.slug, imageUrl: image.url, published: false };
    }

    await step("publish_recipe", async () => {
      const { error } = await db.rpc("publish_generated_recipe", { p_job_id: jobId });
      if (error) throw dbError("Publish recipe", error);
    });
    try {
      await step("refresh_site", () => opts.site.revalidate(recipe.slug));
    } catch {
      // The recipe is already correct in the database; listing pages refresh on
      // the next publish or deploy. Logged by step(), not fatal.
    }
    if (opts.preparePin) {
      const preparePin = opts.preparePin;
      try {
        await step("prepare_pin", () => preparePin(recipeId, jobId));
      } catch {
        // Logged by step(); the Pin can be retried from Admin → Pinterest.
      }
    }
    return { status: "succeeded", jobId, mode, recipeId, slug: recipe.slug, imageUrl: image.url, published: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(db, jobId, "job", "failed", message, err instanceof PipelineError ? { issues: err.issues } : {});
    await failJob(db, claimedJob, message);

    // Out of retries (or a dry run): give the keyword back and remove the unused photos.
    const finalAttempt = mode === "dry_run" || retriesBefore + 1 >= MAX_JOB_RETRIES || err instanceof BudgetExceededError;
    if (finalAttempt && !cp.recipe_id) {
      if (cp.keyword_id) await db.rpc("release_keyword", { p_keyword_id: cp.keyword_id, p_reason: message });
      const unused = [cp.image?.path, cp.pin_image?.path].filter((p): p is string => Boolean(p));
      if (unused.length > 0 && mode !== "dry_run") await opts.images.remove(unused).catch(() => undefined);
    }
    return { status: "failed", jobId, mode, error: message };
  }
}

/**
 * A daily job that failed and was not retried on its own day keeps its keyword
 * "queued" forever, because the next day starts a new job. Gives those
 * keywords back to the pool and closes the jobs as cancelled. Jobs carrying a
 * person's corrected draft are left alone: they can still be resumed by id.
 * Returns how many jobs were closed.
 */
export async function releaseStaleKeywords(db: SupabaseClient, today: string): Promise<number> {
  const { data, error } = await db
    .from("publishing_jobs")
    .select("id, job_date, keyword_id, recipe_id, checkpoint")
    .eq("job_type", "daily_recipe")
    .eq("status", "failed")
    .lt("job_date", today)
    .not("keyword_id", "is", null)
    .is("recipe_id", null)
    .limit(20);
  if (error) throw dbError("Find unfinished jobs", error);
  let closed = 0;
  for (const job of (data ?? []) as Array<{ id: string; job_date: string; keyword_id: string; checkpoint: Checkpoint | null }>) {
    if (job.checkpoint?.corrected_draft || job.checkpoint?.recipe_id) continue;
    const reason = `The job of ${job.job_date} failed and was not finished that day, so its keyword was put back in the queue.`;
    const released = await db.rpc("release_keyword", { p_keyword_id: job.keyword_id, p_reason: reason });
    if (released.error) throw dbError("Release keyword", released.error);
    const { error: closeError } = await db.from("publishing_jobs").update({ status: "cancelled", lease_expires_at: null }).eq("id", job.id).eq("status", "failed");
    if (closeError) throw dbError("Close unfinished job", closeError);
    await logEvent(db, job.id, "job", "info", reason);
    closed++;
  }
  return closed;
}

/** True when two rounds failed on the same problems (same source, field and message), so a repair made no progress. */
export function sameProblems(a: Issue[], b: Issue[]): boolean {
  const key = (i: Issue) => `${i.source}|${i.field}|${i.message}`;
  const left = new Set(a.map(key));
  const right = new Set(b.map(key));
  return left.size === right.size && [...left].every((k) => right.has(k));
}

/** "No acceptable photo after 3 attempts. Attempt 1: …; …. Attempt 2: …" kept short enough for the job log. */
export function photoFailureMessage(rejections: string[][]): string {
  const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}...` : s);
  const parts = rejections.map((problems, i) => `Attempt ${i + 1}: ${problems.map((p) => clip(p.trim().replace(/[.\s]+$/, ""))).join("; ")}.`);
  return `No acceptable photo after ${rejections.length} attempts. ${parts.join(" ")}`.slice(0, 1900);
}

async function finishJob(db: SupabaseClient, jobId: string, step: string) {
  const { error } = await db
    .from("publishing_jobs")
    .update({ status: "succeeded", current_step: step, completed_at: new Date().toISOString(), error_message: null, lease_expires_at: null })
    .eq("id", jobId);
  if (error) throw dbError("Finish publishing job", error);
}

/**
 * Parses, validates, checks for duplicates and, if nothing blocks yet, asks the AI reviewer.
 *
 * Three kinds of small problems are fixed in code, without another AI call, so
 * they never fail a recipe on their own:
 * - a false claim that heat, preheating or wiping removes gluten is removed
 *   (repairGlutenRemovalClaims), before any check runs;
 * - minor pork-free / alcohol-free problems with a like-for-like fix (an
 *   ordinary vanilla extract, a missing "labeled alcohol-free" or "labeled
 *   gluten-free and alcohol-free" note) are corrected in every section
 *   (repairMinorDietaryIssues), before any check runs;
 * - the reviewer's blocking "wording" issues that quote the exact text to
 *   change are applied (applyWordingFixes), and every code check runs again.
 * The returned recipe is the fixed one. What was fixed is kept as warnings.
 */
async function evaluate(
  db: SupabaseClient,
  raw: unknown,
  keyword: KeywordRow,
  categories: CategoryOption[],
  settings: AutomationSettings,
  review: (recipe: GeneratedRecipe) => Promise<{ result: AiResult<ReviewVerdict> }>,
): Promise<{ recipe: GeneratedRecipe | null; issues: Issue[] }> {
  const parsed = parseGeneratedRecipe(raw);
  if (!parsed.recipe) return parsed;
  const cleaned = repairGlutenRemovalClaims(parsed.recipe);
  const dietary = repairMinorDietaryIssues(cleaned.recipe);
  let recipe = dietary.recipe;
  const autoFixed: Issue[] = [
    ...cleaned.repairs.map((r): Issue => ({
      severity: "warning",
      source: "cookware",
      field: r.field,
      message: `Fixed automatically: removed "${r.removed}" (heat, preheating or wiping does not remove gluten).`,
    })),
    ...dietary.fixes.map((f): Issue => ({ severity: "warning", source: "dietary", field: f.field, message: `Fixed automatically: "${f.from}" -> "${f.to}". ${f.reason}` })),
  ];
  let issues = validateGeneratedRecipe(recipe, keyword, categories);

  const { data: slugTaken } = await db.from("recipes").select("id").eq("slug", recipe.slug).maybeSingle();
  if (slugTaken) issues.push({ severity: "blocking", source: "duplicate", field: "slug", message: `The slug "${recipe.slug}" is already used.` });
  const { data: similar, error } = await db.rpc("find_similar_recipes", {
    p_title: recipe.title,
    p_focus_keyword: recipe.focus_keyword,
    p_threshold: settings.similarity_threshold,
  });
  if (error) throw dbError("Check for duplicate recipes", error);
  for (const s of (similar as Array<{ title: string }> | null) ?? []) {
    issues.push({ severity: "blocking", source: "duplicate", field: "title", message: `Too similar to the existing recipe "${s.title}".` });
  }

  if (blocking(issues).length === 0) {
    const { result } = await review(recipe);
    const wording = applyWordingFixes(recipe, result.output.issues);
    if (wording.applied.length > 0) {
      // Prose changed: run every code check again on the fixed recipe. Title,
      // slug and focus keyword cannot change, so the duplicate checks still hold.
      recipe = repairMinorDietaryIssues(repairGlutenRemovalClaims(wording.recipe).recipe).recipe;
      issues = issues.filter((i) => i.source === "duplicate").concat(validateGeneratedRecipe(recipe, keyword, categories));
      for (const i of wording.applied) {
        issues.push({ severity: "warning", source: "review", field: i.field, message: `Fixed automatically: ${i.message}` });
      }
    }
    for (const i of wording.rest) issues.push({ severity: i.severity, field: i.field, message: i.message, source: "review" });
  }
  return { recipe, issues: [...autoFixed, ...issues] };
}

/** Takes a pork or alcohol keyword out of the queue for good, with the reason. */
const EMPTY_QUEUE: KeywordQueueStats = { usable: 0, tooHard: 0, outOfAttempts: 0, queued: 0, assigned: 0, used: 0, rejected: 0, total: 0 };

/** Why the run stopped without a keyword, and what the automatic top-up did. */
export function noKeywordsMessage(queue: KeywordQueueStats, refill: ReplenishOutcome): string {
  const topUp =
    refill.status === "failed"
      ? ` Automatic keyword top-up failed: ${refill.error}`
      : refill.status === "skipped"
        ? ` Automatic keyword top-up did not run: ${refill.reason}`
        : refill.status === "succeeded"
          ? ` The automatic top-up added ${refill.inserted} keyword(s), but none could be claimed.`
          : "";
  return `No usable keywords left (${describeKeywordQueue(queue)})${topUp} No recipe was generated. Import more keywords in /admin/keywords, or the next run will try the top-up again.`;
}

async function rejectKeyword(db: SupabaseClient, jobId: string, keyword: KeywordRow) {
  const violation = keywordViolation(keyword.keyword)!;
  const reason = `Rejected by the pork-free and alcohol-free rule: the keyword asks for a dish with ${violation.term} ("${violation.match}").`;
  const { error } = await db.from("keywords").update({ status: "rejected", last_error: reason }).eq("id", keyword.id);
  if (error) throw dbError("Reject keyword", error);
  await logEvent(db, jobId, "select_keyword", "info", `Skipped the keyword "${keyword.keyword}". ${reason}`);
}

async function loadKeyword(db: SupabaseClient, id: string): Promise<KeywordRow> {
  const { data, error } = await db.from("keywords").select("*").eq("id", id).single();
  if (error) throw dbError("Load keyword", error);
  return data as KeywordRow;
}

async function previewKeyword(db: SupabaseClient, keyword?: string): Promise<KeywordRow> {
  if (keyword?.trim()) return { id: "", keyword: keyword.trim(), category_id: null, search_volume: null, keyword_difficulty: null };
  const { data, error } = await db
    .from("keywords")
    .select("*")
    .eq("status", "new")
    .order("priority", { ascending: false })
    .order("opportunity_score", { ascending: false, nullsFirst: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Preview keyword", error);
  if (!data) throw new PipelineError("No keywords to try. Pass a keyword for the dry run or import keywords.");
  return data as KeywordRow;
}

async function loadCategories(db: SupabaseClient): Promise<CategoryOption[]> {
  const { data, error } = await db.from("categories").select("id, slug, name").order("sort_order");
  if (error) throw dbError("Load categories", error);
  return (data ?? []) as CategoryOption[];
}

async function loadTitles(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("recipes").select("title").order("created_at", { ascending: false }).limit(300);
  if (error) throw dbError("Load recipe titles", error);
  return ((data ?? []) as Array<{ title: string }>).map((r) => r.title);
}
