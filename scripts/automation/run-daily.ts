// Entry point for the daily recipe worker. Runs in GitHub Actions
// (.github/workflows/daily-recipe.yml), never in the web app:
//
//   npm run automation:run
//
// Settings come from environment variables (GitHub Actions secrets and
// variables). Nothing here prints a secret. Exits 1 when the run fails or a Pin
// needs a look, so the workflow shows red and GitHub emails you; a skipped run
// (automation off, already ran today) exits 0.

import { appendFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { automaticPinsBlocked, publishAutomaticPins, type AutoPinRun } from "@/lib/automation/pins";
import { loadSettings, runDailyRecipe, type RunMode } from "@/lib/automation/pipeline";
import { createAnthropicProviders } from "@/lib/automation/providers/anthropic";
import { createOpenAiPhotographer } from "@/lib/automation/providers/openai-images";
import { createSiteRefresher, createSupabaseImageStore } from "@/lib/automation/providers/site";
import { createPinImageStore, preparePin } from "@/lib/services/pinterest";
import { PinterestClient } from "@/lib/services/pinterest-api";
import { getPinterestConfig } from "@/lib/services/pinterest-connection";

const MODES: RunMode[] = ["dry_run", "review", "auto"];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Add it as a GitHub Actions secret or variable (see docs/AUTOMATION.md).`);
  return value;
}

function summary(lines: string[]) {
  console.log(lines.join("\n"));
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
}

async function main(): Promise<number> {
  const requestedMode = (process.env.RUN_MODE?.trim() || "dry_run") as RunMode;
  if (!MODES.includes(requestedMode)) throw new Error(`RUN_MODE must be one of ${MODES.join(", ")}.`);
  const trigger = process.env.RUN_TRIGGER === "schedule" ? "schedule" : "manual";
  const resumeJobId = process.env.RESUME_JOB_ID?.trim() || undefined;
  if (resumeJobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resumeJobId)) {
    throw new Error("resume_job_id must be a job id like f5e10611-25e2-46f5-a577-2a4de83483bd.");
  }

  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim() || required("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const writer = createAnthropicProviders({ apiKey: required("ANTHROPIC_API_KEY"), model: process.env.ANTHROPIC_MODEL?.trim() || undefined });
  const photographer = createOpenAiPhotographer({
    apiKey: required("OPENAI_API_KEY"),
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || undefined,
    quality: (process.env.OPENAI_IMAGE_QUALITY?.trim() as "low" | "medium" | "high" | undefined) || undefined,
  });
  // Only needed to refresh the site after an automatic publish.
  const siteUrl = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();
  const site =
    siteUrl && secret
      ? createSiteRefresher(siteUrl, secret)
      : { revalidate: async () => Promise.reject(new Error("SITE_URL or REVALIDATE_SECRET is not set.")) };

  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  const result = await runDailyRecipe({
    db,
    providers: { ...writer, photographer },
    images: createSupabaseImageStore(db),
    site,
    requestedMode,
    trigger,
    envEnabled: process.env.AUTOMATION_ENABLED === "true",
    runUrl,
    dryRunKeyword: process.env.DRY_RUN_KEYWORD?.trim() || undefined,
    resumeJobId,
    // Draws the Pin right after an automatic publish (no AI cost). Posting it
    // happens below, after the page is confirmed live.
    preparePin: siteUrl
      ? async (recipeId, jobId) => {
          const result = await preparePin(db, recipeId, { siteUrl, store: createPinImageStore(db) }, { jobId });
          if (result.outcome === "failed") throw new Error(result.message);
        }
      : undefined,
  });

  let code = 0;
  switch (result.status) {
    case "skipped":
      summary([`## Daily recipe: skipped`, "", result.reason]);
      break;
    case "failed":
      summary([`## Daily recipe: failed (${result.mode})`, "", `Job \`${result.jobId}\``, "", `Error: ${result.error}`]);
      code = 1;
      break;
    case "succeeded":
      summary([
        `## Daily recipe: ${result.published ? "published" : result.mode === "dry_run" ? "dry run complete" : "saved for review"}`,
        "",
        `- Recipe: \`${result.slug}\``,
        `- Photo: ${result.imageUrl}`,
        `- Job: \`${result.jobId}\``,
        result.mode === "review" ? "- Next: approve or edit it in the admin dashboard under Recipes → In review." : "",
      ]);
      break;
  }

  // Pinterest: posts the Pins of automatically published recipes (today's and
  // any earlier one still waiting). Never runs for dry runs, and does nothing
  // unless automation, Automatic mode and automatic Pinterest publishing are on.
  if (requestedMode !== "dry_run") {
    try {
      const pins = await runAutomaticPins(db, siteUrl);
      code = Math.max(code, reportPins(pins));
    } catch (error) {
      summary([`## Pinterest: could not run`, "", error instanceof Error ? error.message : String(error)]);
      code = 1;
    }
  }
  return code;
}

async function runAutomaticPins(db: SupabaseClient, siteUrl: string | undefined): Promise<AutoPinRun> {
  const settings = await loadSettings(db);
  const envEnabled = process.env.AUTOMATION_ENABLED === "true";
  const off = automaticPinsBlocked(settings, envEnabled);
  if (off) return { status: "skipped", reason: off };
  if (!siteUrl) return { status: "blocked", reason: "SITE_URL is not set, so Pins cannot link to the recipe.", pins: 0 };
  const config = getPinterestConfig(process.env);
  if (!config.ok) return { status: "blocked", reason: `Pinterest is not set up for the worker: ${config.problems.join(" ")} Add the Pinterest secrets to the GitHub automation environment (docs/AUTOMATION.md).`, pins: 0 };
  return publishAutomaticPins(db, settings, envEnabled, {
    pinterest: { config: config.config, client: new PinterestClient(config.config.app) },
    prepare: { siteUrl, store: createPinImageStore(db) },
  });
}

/** Writes the Pinterest part of the run summary. Returns 1 when something needs a look. */
function reportPins(run: AutoPinRun): number {
  if (run.status === "skipped") {
    summary([`## Pinterest: not posting automatically`, "", run.reason]);
    return 0;
  }
  if (run.status === "blocked") {
    summary([`## Pinterest: blocked`, "", run.reason, "", run.pins ? `${run.pins} Pin(s) are waiting and will be posted on the next run once this is fixed.` : ""]);
    return 1;
  }
  if (run.results.length === 0) {
    summary([`## Pinterest: nothing to post`]);
    return 0;
  }
  const label = { published: "posted", waiting: "result unknown, checked again next run", failed: "not posted" } as const;
  summary([
    `## Pinterest`,
    "",
    ...run.results.map((r) => `- ${r.recipeTitle}: ${label[r.outcome]}. ${r.message}${r.pinterestPinId ? ` https://www.pinterest.com/pin/${r.pinterestPinId}/` : ""}`),
  ]);
  return run.results.every((r) => r.outcome === "published") ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    summary([`## Daily recipe: could not start`, "", error instanceof Error ? error.message : String(error)]);
    process.exit(1);
  },
);
