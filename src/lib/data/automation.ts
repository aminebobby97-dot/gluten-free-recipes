// Admin queries for the Phase 2 automation: settings, spend, and the step log
// and AI attempts of one job. Until the automation migration is applied these
// tables do not exist, so every reader reports `installed: false` instead of
// failing and the rest of the dashboard keeps working.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/services/errors";
import { JOB_RECIPE } from "./admin";

/** PostgREST / Postgres codes for a table, column or function that does not exist. */
const MISSING = new Set(["PGRST205", "PGRST202", "PGRST204", "42P01", "42703", "42883"]);

function isMissing(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING.has(error.code));
}

export interface AutomationSettings {
  enabled: boolean;
  publish_mode: "review" | "auto";
  max_recipes_per_day: number;
  min_reviewed_before_auto: number;
  daily_budget_usd: number;
  max_keyword_difficulty: number | null;
  similarity_threshold: number;
  pinterest_enabled: boolean;
  updated_at: string;
}

export type AutomationOverview =
  | { installed: false }
  | { installed: true; settings: AutomationSettings; spentTodayUsd: number; approvedAiRecipes: number; inReviewAiRecipes: number };

export async function getAutomationOverview(db: SupabaseClient): Promise<AutomationOverview> {
  const { data: settings, error } = await db.from("automation_settings").select("*").eq("id", true).maybeSingle();
  if (isMissing(error)) return { installed: false };
  if (error) throw dbError("Load automation settings", error);
  if (!settings) return { installed: false };

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [spend, approved, inReview] = await Promise.all([
    db.rpc("ai_spend", { p_since: startOfDay.toISOString() }),
    db.from("recipes").select("id", { count: "exact", head: true }).eq("source", "ai").not("approved_at", "is", null),
    db.from("recipes").select("id", { count: "exact", head: true }).eq("source", "ai").eq("status", "in_review"),
  ]);
  if (spend.error) throw dbError("Read AI spend", spend.error);
  if (approved.error) throw dbError("Count AI recipes", approved.error);
  if (inReview.error) throw dbError("Count AI recipes", inReview.error);

  return {
    installed: true,
    settings: { ...(settings as AutomationSettings), daily_budget_usd: Number(settings.daily_budget_usd), similarity_threshold: Number(settings.similarity_threshold) },
    spentTodayUsd: Number(spend.data ?? 0),
    approvedAiRecipes: approved.count ?? 0,
    inReviewAiRecipes: inReview.count ?? 0,
  };
}

export interface JobEvent {
  id: number;
  step: string;
  status: "started" | "succeeded" | "failed" | "retrying" | "skipped" | "info";
  message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface GenerationAttempt {
  id: string;
  kind: string;
  attempt: number;
  provider: string;
  model: string;
  prompt_version: string;
  status: "succeeded" | "rejected" | "error";
  issues: Array<{ severity: string; field: string; message: string; source?: string }>;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  duration_ms: number | null;
  created_at: string;
}

export interface JobDetail {
  job: {
    id: string;
    job_type: string;
    job_date: string;
    status: string;
    mode: string | null;
    trigger: string | null;
    current_step: string | null;
    error_message: string | null;
    retry_count: number;
    cost_usd: number | null;
    run_url: string | null;
    created_at: string;
    completed_at: string | null;
    recipe: { id: string; title: string; status: string } | null;
    keyword: { keyword: string } | null;
  };
  events: JobEvent[] | null;
  attempts: GenerationAttempt[] | null;
}

export async function getJobDetail(db: SupabaseClient, id: string): Promise<JobDetail | null> {
  const { data: job, error } = await db
    .from("publishing_jobs")
    .select(`*, recipe:${JOB_RECIPE}(id,title,status), keyword:keywords(keyword)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw dbError("Load publishing job", error);
  if (!job) return null;

  const [events, attempts] = await Promise.all([
    db.from("publishing_job_events").select("id,step,status,message,duration_ms,created_at").eq("job_id", id).order("id"),
    db
      .from("generation_attempts")
      .select("id,kind,attempt,provider,model,prompt_version,status,issues,error_message,input_tokens,output_tokens,cost_usd,duration_ms,created_at")
      .eq("job_id", id)
      .order("created_at"),
  ]);
  for (const r of [events, attempts]) if (r.error && !isMissing(r.error)) throw dbError("Load job log", r.error);

  return {
    job: { mode: null, trigger: null, cost_usd: null, run_url: null, ...job } as JobDetail["job"],
    events: events.error ? null : ((events.data ?? []) as JobEvent[]),
    attempts: attempts.error ? null : ((attempts.data ?? []).map((a) => ({ ...a, cost_usd: Number(a.cost_usd) })) as GenerationAttempt[]),
  };
}
