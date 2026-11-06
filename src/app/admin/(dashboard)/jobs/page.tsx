import Link from "next/link";
import { JobsTable } from "@/components/admin/job-tables";
import { Notice, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listJobs } from "@/lib/data/admin";

export const metadata = { title: "Publishing jobs" };

export default async function AdminJobsPage() {
  const { supabase } = await requireAdmin();
  const jobs = await listJobs(supabase);
  return (
    <div className="space-y-6">
      <PageHeader title="Publishing jobs" description="One row per automated run. Each date has at most one daily job; test runs are listed as dry runs. Open a date to see every step, AI call and cost." />
      <Notice>
        Daily recipe publishing is scheduled for 02:00 UTC (09:00 Bangkok time). Actual start times may vary due to GitHub Actions scheduling delays. You can also trigger a run manually from GitHub Actions. Settings are under{" "}
        <Link href="/admin/automation" className="font-semibold underline">
          Automation
        </Link>
        .
      </Notice>
      <JobsTable jobs={jobs} empty="No publishing jobs have run." />
    </div>
  );
}
