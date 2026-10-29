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
import { recipeInputSchema } from "@/lib/recipes/schema";
import { dbError } from "@/lib/services/errors";
import { claimJob, failJob, getOrCreateDailyJob, MAX_JOB_RETRIES, recordJobStep, toJobDate, JOB_LEASE_MINUTES, type PublishingJob } from "@/lib/services/jobs";
import { BudgetExceededError } from "./cost";
import { checkBudget, logEvent, markAttempt, recordAttempt, type AttemptKind } from "./log";
import { AiCallError, type AiProviders, type AiResult, type AiStep, type CategoryOption, type GeneratedRecipe, type ImageStore, type Issue, type KeywordRow, type Photo, type SiteRefresher } from "./types";
import { blocking, parseGeneratedRecipe, validateGeneratedRecipe } from "./validate";

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
   * text saved for review, never posted). Optional and never fatal: a Pin
   * problem is logged and the published recipe stays as it is.
   */
  preparePin?: (recipeId: string, jobId: string) => Promise<void>;
  now?: Date;
}

export type PipelineResult =
  | { status: "skipped"; reason: string }
  | { status: "failed"; jobId: string; mode: RunMode; error: string }
  | { status: "succeeded"; jobId: string; mode: RunMode; recipeId: string | null; slug: string; imageUrl: string; published: boolean };

/** Writer gets one repair round after its first draft. */
export const MAX_REPAIR_ROUNDS = 1;
export const MAX_PHOTO_ATTEMPTS = 3;

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

  try {
    // --- 1. Keyword ------------------------------------------------------------
    const keyword = await step("select_keyword", async () => {
      if (cp.keyword_id) return loadKeyword(db, cp.keyword_id);
      if (mode === "dry_run") return previewKeyword(db, opts.dryRunKeyword);
      const { data, error } = await db.rpc("claim_next_keyword", { p_job_id: jobId });
      if (error) throw dbError("Claim keyword", error);
      const claimed = data as KeywordRow | null;
      if (!claimed?.id) throw new PipelineError("No usable keywords left. Import more keywords in /admin/keywords.");
      await saveCheckpoint({ keyword_id: claimed.id });
      return claimed;
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
      for (let round = 0; ; round++) {
        const { recipe: parsed, issues } = await evaluate(db, result.output, keyword, categories, settings, (r) => callAi("review", providers.reviewer, r, round + 1));
        const blockers = blocking(issues);
        await markAttempt(db, attemptId, blockers.length ? "rejected" : "succeeded", issues);
        if (parsed && blockers.length === 0) {
          await saveCheckpoint({ recipe: parsed });
          return parsed;
        }
        if (round >= MAX_REPAIR_ROUNDS) {
          throw new PipelineError(`The recipe failed ${blockers.length} check(s): ${blockers.slice(0, 5).map((b) => b.message).join(" ")}`, blockers);
        }
        ({ result, attemptId } = parsed
          ? await callAi("repair", providers.repairer, { ...input, draft: parsed, issues: blockers }, round + 2)
          : await callAi("recipe", providers.writer, input, round + 2));
      }
    });

    // --- 3. Photo ------------------------------------------------------------------
    // One landscape photo for the site. The Pinterest Pin is drawn from this same
    // photo when the recipe is published (src/lib/services/pinterest.ts), so no
    // second AI image is generated.
    const takePhoto = async (attempts: number): Promise<StoredImage> => {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const { result: shot, attemptId } = await callAi("image", providers.photographer, { recipe, orientation: "landscape" }, attempt);
        const { result: check } = await callAi("image_check", providers.photoChecker, { recipe, photo: shot.output }, attempt);
        if (check.output.ok) {
          const ext = shot.output.mimeType.split("/")[1];
          const folder = mode === "dry_run" ? "dry-run" : "recipes";
          const path = `${folder}/${toJobDate(now).slice(0, 4)}/${recipe.slug}-${jobId.slice(0, 8)}.${ext}`;
          const url = await opts.images.upload(path, shot.output);
          return { path, url, alt: recipe.image_alt };
        }
        await markAttempt(
          db,
          attemptId,
          "rejected",
          check.output.problems.map((p) => ({ severity: "blocking", source: "photo", field: "featured_image", message: p })),
        );
      }
      throw new PipelineError(`No acceptable photo after ${attempts} attempts.`);
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

async function finishJob(db: SupabaseClient, jobId: string, step: string) {
  const { error } = await db
    .from("publishing_jobs")
    .update({ status: "succeeded", current_step: step, completed_at: new Date().toISOString(), error_message: null, lease_expires_at: null })
    .eq("id", jobId);
  if (error) throw dbError("Finish publishing job", error);
}

/** Parses, validates, checks for duplicates and, if nothing blocks yet, asks the AI reviewer. */
async function evaluate(
  db: SupabaseClient,
  raw: unknown,
  keyword: KeywordRow,
  categories: CategoryOption[],
  settings: AutomationSettings,
  review: (recipe: GeneratedRecipe) => Promise<{ result: AiResult<{ issues: Array<Pick<Issue, "severity" | "field" | "message">> }> }>,
): Promise<{ recipe: GeneratedRecipe | null; issues: Issue[] }> {
  const parsed = parseGeneratedRecipe(raw);
  if (!parsed.recipe) return parsed;
  const recipe = parsed.recipe;
  const issues = validateGeneratedRecipe(recipe, keyword, categories);

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
    for (const i of result.output.issues) issues.push({ ...i, source: "review" });
  }
  return { recipe, issues };
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
