import { JobsTable, PinsTable } from "@/components/admin/job-tables";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listJobs, listPins } from "@/lib/data/admin";

export const metadata = { title: "Errors" };

export default async function AdminErrorsPage() {
  const { supabase } = await requireAdmin();
  const [jobs, pins] = await Promise.all([listJobs(supabase, true), listPins(supabase, "failed")]);
  return (
    <div className="space-y-8">
      <PageHeader title="Errors" description="Failed publishing jobs and Pinterest posts, with their error messages." />
      <section className="space-y-3">
        <h2 className="text-xl font-medium text-ink">Failed publishing jobs</h2>
        <JobsTable jobs={jobs} empty="No failed jobs." />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-medium text-ink">Failed Pinterest posts</h2>
        <PinsTable pins={pins ?? []} empty="No failed pins." />
      </section>
    </div>
  );
}
