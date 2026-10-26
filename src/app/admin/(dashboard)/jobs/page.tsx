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
      <PageHeader title="Publishing jobs" description="One row per automated publishing run. Each date can only have one daily job." />
      <Notice>Automated publishing is not active yet, so no jobs are created automatically.</Notice>
      <JobsTable jobs={jobs} empty="No publishing jobs have run." />
    </div>
  );
}
