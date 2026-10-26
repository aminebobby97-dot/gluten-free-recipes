// Job event log, AI attempt log and the daily spending guard. All writes use
// the worker's service-role client; admins read the same tables in /admin.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/services/errors";
import { assertWithinBudget } from "./cost";
import type { AiResult, Issue } from "./types";

export type EventStatus = "started" | "succeeded" | "failed" | "retrying" | "skipped" | "info";

export async function logEvent(
  db: SupabaseClient,
  jobId: string,
  step: string,
  status: EventStatus,
  message?: string,
  detail: Record<string, unknown> = {},
  durationMs?: number,
) {
  const { error } = await db.from("publishing_job_events").insert({
    job_id: jobId,
    step,
    status,
    message: message?.slice(0, 2000) ?? null,
    detail,
    duration_ms: durationMs ?? null,
  });
  // The log must never hide the real outcome, so a failed log write is only reported.
  if (error) console.error(`Could not log ${step}/${status}: ${error.message}`);
}

export type AttemptKind = "recipe" | "review" | "repair" | "image" | "image_check" | "pin_image" | "pin_image_check";

export interface AttemptRecord {
  jobId: string;
  keywordId: string | null;
  kind: AttemptKind;
  attempt: number;
  status: "succeeded" | "rejected" | "error";
  result?: Omit<AiResult<unknown>, "output">;
  output?: unknown;
  issues?: Issue[];
  errorMessage?: string;
  durationMs: number;
}

/** Stores one AI call and adds its cost to the job. Returns the attempt id. */
export async function recordAttempt(db: SupabaseClient, record: AttemptRecord, provider: string, model: string): Promise<string> {
  const cost = record.result?.costUsd ?? 0;
  const { data, error } = await db
    .from("generation_attempts")
    .insert({
      job_id: record.jobId,
      keyword_id: record.keywordId,
      kind: record.kind,
      attempt: record.attempt,
      provider: record.result?.provider ?? provider,
      model: record.result?.model ?? model,
      prompt_version: record.result?.promptVersion ?? "unknown",
      status: record.status,
      output: record.output ?? null,
      issues: record.issues ?? [],
      error_message: record.errorMessage?.slice(0, 2000) ?? null,
      input_tokens: record.result?.inputTokens ?? null,
      output_tokens: record.result?.outputTokens ?? null,
      cost_usd: cost,
      duration_ms: record.durationMs,
    })
    .select("id")
    .single();
  if (error) throw dbError("Record generation attempt", error);

  if (cost > 0) {
    const { data: job } = await db.from("publishing_jobs").select("cost_usd").eq("id", record.jobId).maybeSingle();
    const total = Math.round((Number(job?.cost_usd ?? 0) + cost) * 10_000) / 10_000;
    await db.from("publishing_jobs").update({ cost_usd: total }).eq("id", record.jobId);
  }
  return (data as { id: string }).id;
}

export async function markAttempt(db: SupabaseClient, attemptId: string, status: "succeeded" | "rejected", issues: Issue[]) {
  const { error } = await db.from("generation_attempts").update({ status, issues }).eq("id", attemptId);
  if (error) throw dbError("Update generation attempt", error);
}

/** AI spend since the start of the current UTC day, in USD. */
export async function spentToday(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("ai_spend");
  if (error) throw dbError("Read AI spend", error);
  return Number(data ?? 0);
}

/** Throws BudgetExceededError if a call costing up to `estimateUsd` could break the daily limit. */
export async function checkBudget(db: SupabaseClient, estimateUsd: number, limitUsd: number) {
  assertWithinBudget(await spentToday(db), estimateUsd, limitUsd);
}
