import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./support/fake-db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { claimJob, dailyJobKey, failJob, getOrCreateDailyJob, MAX_JOB_RETRIES, toJobDate } = await import("@/lib/services/jobs");
const { isAutomationEnabled } = await import("@/lib/services/automation");

describe("publishing jobs", () => {
  it("uses one idempotency key per day", () => {
    expect(dailyJobKey("2026-10-26")).toBe("daily_recipe:2026-10-26");
    expect(toJobDate(new Date("2026-10-26T23:59:00Z"))).toBe("2026-10-26");
    expect(() => dailyJobKey("26/10/2026")).toThrow();
  });

  it("returns the same job when called twice for the same date", async () => {
    const { db, data } = createFakeDb({ publishing_jobs: [] });
    const a = await getOrCreateDailyJob(db, "2026-10-26");
    const b = await getOrCreateDailyJob(db, "2026-10-26");
    expect(a.id).toBe(b.id);
    expect(data.publishing_jobs).toHaveLength(1);
  });

  it("never re-runs a succeeded job or one out of retries", async () => {
    const { db } = createFakeDb({ publishing_jobs: [] });
    const base = await getOrCreateDailyJob(db, "2026-10-27");
    expect(await claimJob(db, { ...base, status: "succeeded" })).toBeNull();
    expect(await claimJob(db, { ...base, status: "failed", retry_count: MAX_JOB_RETRIES })).toBeNull();
    const claimed = await claimJob(db, base);
    expect(claimed?.status).toBe("running");
    // A second worker holding the stale "pending" copy cannot claim it again.
    expect(await claimJob(db, base)).toBeNull();
  });

  it("lets a new run take over a crashed run only after its lease expires", async () => {
    const { db } = createFakeDb({ publishing_jobs: [] });
    const base = await getOrCreateDailyJob(db, "2026-10-29");
    const running = { ...base, status: "running" as const, lease_expires_at: "2026-10-29T13:30:00Z" };
    expect(await claimJob(db, running, new Date("2026-10-29T13:00:00Z"))).toBeNull();
    const { db: db2, data } = createFakeDb({ publishing_jobs: [running] });
    const taken = await claimJob(db2, running, new Date("2026-10-29T14:00:00Z"));
    expect(taken?.status).toBe("running");
    expect(data.publishing_jobs[0].lease_expires_at).toBe("2026-10-29T14:30:00.000Z");
  });

  it("records failures and increments the retry count", async () => {
    const { db, data } = createFakeDb({ publishing_jobs: [] });
    const job = await getOrCreateDailyJob(db, "2026-10-28");
    await failJob(db, job, "Pinterest timeout");
    expect(data.publishing_jobs[0]).toMatchObject({ status: "failed", retry_count: 1, error_message: "Pinterest timeout" });
  });
});

describe("automation", () => {
  it("is disabled by default", () => {
    expect(isAutomationEnabled()).toBe(false);
  });
});
