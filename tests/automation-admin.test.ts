import { describe, expect, it, vi } from "vitest";
import { getAutomationOverview, getJobDetail } from "@/lib/data/automation";
import { createFakeDb } from "./support/fake-db";

vi.mock("server-only", () => ({}));

/** A database without the Phase 2 tables, as production is until the migration is applied. */
function unmigratedDb() {
  const missing = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "maybeSingle"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve(missing);
    return q;
  };
  return { from: query, rpc: query } as never;
}

describe("automation admin data", () => {
  it("reports automation as not installed instead of failing before the migration", async () => {
    expect(await getAutomationOverview(unmigratedDb())).toEqual({ installed: false });
  });

  it("reads settings, today's spend and the review counts", async () => {
    const { db } = createFakeDb(
      {
        automation_settings: [{ id: true, enabled: false, publish_mode: "review", min_reviewed_before_auto: 5, daily_budget_usd: "3.00", similarity_threshold: 0.5 }],
        recipes: [
          { id: "a", source: "ai", status: "published" },
          { id: "b", source: "ai", status: "in_review" },
          { id: "c", source: "manual", status: "published" },
        ],
      },
      { ai_spend: () => "0.4210" },
    );
    expect(await getAutomationOverview(db)).toMatchObject({
      installed: true,
      settings: { enabled: false, daily_budget_usd: 3 },
      spentTodayUsd: 0.421,
      approvedAiRecipes: 1,
      inReviewAiRecipes: 1,
    });
  });

  it("returns a job with its steps and AI calls", async () => {
    const { db } = createFakeDb({
      publishing_jobs: [{ id: "j1", job_type: "daily_recipe", job_date: "2026-11-02", status: "succeeded", retry_count: 0 }],
      publishing_job_events: [{ id: 1, job_id: "j1", step: "select_keyword", status: "succeeded" }],
      generation_attempts: [{ id: "g1", job_id: "j1", kind: "recipe", cost_usd: "0.0440", issues: [] }],
    });
    const detail = await getJobDetail(db, "j1");
    expect(detail?.events).toHaveLength(1);
    expect(detail?.attempts?.[0].cost_usd).toBe(0.044);
    expect(await getJobDetail(db, "missing")).toBeNull();
  });
});
