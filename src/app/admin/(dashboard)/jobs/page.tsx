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
        Daily runs are not scheduled yet. Jobs appear here when a run is started by hand from GitHub Actions. Settings are under{" "}
        <Link href="/admin/automation" className="font-semibold underline">
          Automation
        </Link>
        .
      </Notice>
      <JobsTable jobs={jobs} empty="No publishing jobs have run." />
    </div>
  );
}
