// Entry point for the daily recipe worker. Runs in GitHub Actions
// (.github/workflows/daily-recipe.yml), never in the web app:
//
//   npm run automation:run
//
// Settings come from environment variables (GitHub Actions secrets and
// variables). Nothing here prints a secret. Exits 1 when the run fails, so the
// workflow shows red; a skipped run (automation off, already ran today) exits 0.

import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runDailyRecipe, type RunMode } from "@/lib/automation/pipeline";
import { createAnthropicProviders } from "@/lib/automation/providers/anthropic";
import { createOpenAiPhotographer } from "@/lib/automation/providers/openai-images";
import { createSiteRefresher, createSupabaseImageStore } from "@/lib/automation/providers/site";
import { createPinImageStore, preparePin } from "@/lib/services/pinterest";

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
    // Pinterest Pins are only prepared for review (no AI cost, nothing posted).
    preparePin: siteUrl
      ? async (recipeId, jobId) => {
          const result = await preparePin(db, recipeId, { siteUrl, store: createPinImageStore(db) }, { jobId });
          if (result.outcome === "failed") throw new Error(result.message);
        }
      : undefined,
  });

  switch (result.status) {
    case "skipped":
      summary([`## Daily recipe: skipped`, "", result.reason]);
      return 0;
    case "failed":
      summary([`## Daily recipe: failed (${result.mode})`, "", `Job \`${result.jobId}\``, "", `Error: ${result.error}`]);
      return 1;
    case "succeeded":
      summary([
        `## Daily recipe: ${result.published ? "published" : result.mode === "dry_run" ? "dry run complete" : "saved for review"}`,
        "",
        `- Recipe: \`${result.slug}\``,
        `- Photo: ${result.imageUrl}`,
        `- Job: \`${result.jobId}\``,
        result.mode === "review" ? "- Next: approve or edit it in the admin dashboard under Recipes → In review." : "",
      ]);
      return 0;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    summary([`## Daily recipe: could not start`, "", error instanceof Error ? error.message : String(error)]);
    process.exit(1);
  },
);
