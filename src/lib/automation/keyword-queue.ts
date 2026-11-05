// How many keywords the daily worker can still use, and why the others are
// left out. "Usable" mirrors the filters of claim_next_keyword in the Phase 2
// migration: status 'new', no recipe assigned, fewer than 3 attempts, and a
// difficulty that is unknown or at most automation_settings.max_keyword_difficulty.
// (claim_next_keyword also rejects a keyword that turns out too similar to one
// already covered; that is only known when it is tried.)
//
// Shared by the worker (to decide when to top up the queue) and the admin
// dashboard (to show the real number instead of every 'new' keyword).

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/services/errors";

/** The worker suggests new keywords when fewer than this many are usable. */
export const REPLENISH_BELOW = 30;

export interface KeywordQueueStats {
  /** Keywords the next run can pick. */
  usable: number;
  /** Status 'new' but harder than the maximum difficulty in Admin → Automation. */
  tooHard: number;
  /** Status 'new' but already tried 3 times. */
  outOfAttempts: number;
  queued: number;
  assigned: number;
  used: number;
  rejected: number;
  total: number;
}

type Query = PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }>;

export async function loadKeywordQueueStats(db: SupabaseClient, maxDifficulty: number): Promise<KeywordQueueStats> {
  const base = () => db.from("keywords").select("id", { count: "exact", head: true });
  const fresh = () => base().eq("status", "new").is("assigned_recipe_id", null);
  const queries: Record<keyof KeywordQueueStats | "usableUnknown", Query> = {
    // Two counts because a filter on "difficulty unknown OR at most the maximum" needs an or().
    usable: fresh().lt("attempt_count", 3).lte("keyword_difficulty", maxDifficulty),
    usableUnknown: fresh().lt("attempt_count", 3).is("keyword_difficulty", null),
    tooHard: fresh().lt("attempt_count", 3).gt("keyword_difficulty", maxDifficulty),
    outOfAttempts: fresh().gte("attempt_count", 3),
    queued: base().eq("status", "queued"),
    assigned: base().eq("status", "assigned"),
    used: base().eq("status", "used"),
    rejected: base().eq("status", "rejected"),
    total: base(),
  };
  const keys = Object.keys(queries) as Array<keyof typeof queries>;
  const results = await Promise.all(keys.map((k) => queries[k]));
  const counts = {} as Record<keyof typeof queries, number>;
  keys.forEach((k, i) => {
    const { count, error } = results[i];
    if (error) throw dbError("Count keywords", error);
    counts[k] = count ?? 0;
  });
  const { usableUnknown, ...rest } = counts;
  return { ...rest, usable: rest.usable + usableUnknown };
}

/** "0 usable: 12 used, 3 assigned, 8 rejected, 2 too hard, 1 out of attempts." for logs and errors. */
export function describeKeywordQueue(s: KeywordQueueStats): string {
  const parts = [
    s.used && `${s.used} used`,
    s.assigned && `${s.assigned} assigned to a recipe`,
    s.queued && `${s.queued} held by a job`,
    s.rejected && `${s.rejected} rejected`,
    s.tooHard && `${s.tooHard} skipped as harder than the maximum difficulty`,
    s.outOfAttempts && `${s.outOfAttempts} skipped after 3 failed attempts`,
  ].filter(Boolean);
  return `${s.usable} usable of ${s.total} keyword(s)${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}
