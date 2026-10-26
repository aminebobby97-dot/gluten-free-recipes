import { PinsTable } from "@/components/admin/job-tables";
import { Notice, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listPins } from "@/lib/data/admin";

export const metadata = { title: "Pinterest" };

export default async function AdminPinterestPage() {
  const { supabase } = await requireAdmin();
  const pins = await listPins(supabase);
  return (
    <div className="space-y-6">
      <PageHeader title="Pinterest" description="Pins prepared for published recipes and their publication status." />
      <Notice>Pinterest API publishing is not connected yet. Readers can still save recipes with the Save button on each recipe page.</Notice>
      <PinsTable pins={pins} empty="No pins have been created." />
    </div>
  );
}
