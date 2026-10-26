// Publishing job bookkeeping for the future daily automation. Each run is keyed
// by an idempotency key (one daily job per date), so retries or overlapping
// triggers never create a second job or a second publication.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError, ServiceError } from "./errors";

export const MAX_JOB_RETRIES = 3;
/** How long a worker owns a running job. A crashed run's job can be taken over after this. */
export const JOB_LEASE_MINUTES = 30;

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface PublishingJob {
  id: string;
  recipe_id: string | null;
  keyword_id: string | null;
  job_type: string;
  job_date: string;
  idempotency_key: string;
  status: JobStatus;
  current_step: string | null;
  error_message: string | null;
  retry_count: number;
  started_at: string | null;
  created_at: string;
  completed_at: string | null;
  // Phase 2 columns (proposed migration 20261027000001).
  mode?: "dry_run" | "review" | "auto";
  trigger?: "schedule" | "manual";
  checkpoint?: Record<string, unknown>;
  lease_expires_at?: string | null;
  run_url?: string | null;
  cost_usd?: number;
}

/** "2026-10-26" for a Date, using UTC so every server agrees on the day. */
export function toJobDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dailyJobKey(jobDate: string, jobType = "daily_recipe"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jobDate)) throw new ServiceError("invalid_input", "jobDate must be YYYY-MM-DD.");
  return `${jobType}:${jobDate}`;
}

/** Returns the job for a date, creating it if needed. Safe to call repeatedly. */
export async function getOrCreateDailyJob(db: SupabaseClient, jobDate: string, jobType = "daily_recipe"): Promise<PublishingJob> {
  const idempotency_key = dailyJobKey(jobDate, jobType);
  const { error: insertError } = await db
    .from("publishing_jobs")
    .upsert({ job_type: jobType, job_date: jobDate, idempotency_key }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (insertError) throw dbError("Create publishing job", insertError);

  const { data, error } = await db.from("publishing_jobs").select("*").eq("idempotency_key", idempotency_key).single();
  if (error) throw dbError("Load publishing job", error);
  return data as PublishingJob;
}

/**
 * Claims a job for processing. Only pending jobs, failed jobs that still have
 * retries left, or running jobs whose lease has expired (a crashed run) can be
 * claimed; returns null if another worker has it or it already succeeded.
 */
export async function claimJob(db: SupabaseClient, job: PublishingJob, now = new Date()): Promise<PublishingJob | null> {
  if (job.status === "succeeded" || job.status === "cancelled") return null;
  if (job.status === "failed" && job.retry_count >= MAX_JOB_RETRIES) return null;
  const leaseExpired = job.lease_expires_at != null && new Date(job.lease_expires_at) <= now;
  if (job.status === "running" && !leaseExpired) return null;

  const lease_expires_at = new Date(now.getTime() + JOB_LEASE_MINUTES * 60_000).toISOString();
  let query = db
    .from("publishing_jobs")
    .update({ status: "running", started_at: now.toISOString(), error_message: null, lease_expires_at })
    .eq("id", job.id)
    .eq("status", job.status); // optimistic lock: fails if someone else changed it
  if (job.status === "running") query = query.eq("lease_expires_at", job.lease_expires_at);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw dbError("Claim publishing job", error);
  return (data as PublishingJob | null) ?? null;
}

export async function recordJobStep(db: SupabaseClient, jobId: string, step: string, patch: Partial<Pick<PublishingJob, "recipe_id" | "keyword_id">> = {}) {
  const { error } = await db.from("publishing_jobs").update({ current_step: step, ...patch }).eq("id", jobId);
  if (error) throw dbError("Update publishing job", error);
}

export async function completeJob(db: SupabaseClient, jobId: string, recipeId: string) {
  const { error } = await db
    .from("publishing_jobs")
    .update({ status: "succeeded", recipe_id: recipeId, current_step: "done", completed_at: new Date().toISOString(), error_message: null })
    .eq("id", jobId);
  if (error) throw dbError("Complete publishing job", error);
}

export async function failJob(db: SupabaseClient, job: Pick<PublishingJob, "id" | "retry_count">, message: string) {
  const { error } = await db
    .from("publishing_jobs")
    .update({
      status: "failed",
      error_message: message.slice(0, 2000),
      retry_count: job.retry_count + 1,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw dbError("Fail publishing job", error);
}
