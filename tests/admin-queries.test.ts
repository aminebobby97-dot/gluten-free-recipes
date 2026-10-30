import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { JOB_RECIPE, listJobs } from "@/lib/data/admin";
import { getJobDetail } from "@/lib/data/automation";

/** Records every select() so the embeds can be checked; returns no rows. */
function recordingDb() {
  const selects: Array<{ table: string; columns: string }> = [];
  const from = (table: string) => {
    const builder = {
      select: (columns: string) => (selects.push({ table, columns }), builder),
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: { id: "job-1" }, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, selects };
}

// publishing_jobs.recipe_id -> recipes and recipes.generation_job_id -> publishing_jobs
// are two links between the same tables, so `recipe:recipes(...)` from a job is
// ambiguous and Supabase refuses it (PGRST201), which crashed /admin/jobs,
// /admin/jobs/<id> and /admin/errors.
describe("admin job queries", () => {
  it("name the foreign key to follow from a job to its recipe", () => {
    expect(JOB_RECIPE).toBe("recipes!publishing_jobs_recipe_id_fkey");
  });

  it("the job list (Publishing jobs and Errors) uses it", async () => {
    for (const onlyFailed of [false, true]) {
      const { db, selects } = recordingDb();
      await listJobs(db, onlyFailed);
      const jobQuery = selects.find((s) => s.table === "publishing_jobs")!;
      expect(jobQuery.columns).toContain("recipe:recipes!publishing_jobs_recipe_id_fkey(id,title)");
      expect(jobQuery.columns).not.toMatch(/recipe:recipes\(/);
    }
  });

  it("the job detail page uses it", async () => {
    const { db, selects } = recordingDb();
    await getJobDetail(db, "job-1");
    const jobQuery = selects.find((s) => s.table === "publishing_jobs")!;
    expect(jobQuery.columns).toContain("recipe:recipes!publishing_jobs_recipe_id_fkey(id,title,status)");
    expect(jobQuery.columns).not.toMatch(/recipe:recipes\(/);
  });

  it("matches the constraint created by the schema migration", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("supabase/migrations/20261026000001_schema.sql", "utf8");
    // Unnamed inline reference on publishing_jobs.recipe_id: Postgres names it <table>_<column>_fkey.
    expect(schema).toMatch(/create table public\.publishing_jobs \([\s\S]*?\n  recipe_id uuid references public\.recipes \(id\)/);
    expect(schema).not.toMatch(/constraint \w+ foreign key \(recipe_id\)/);
  });
});
