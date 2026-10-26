import Link from "next/link";
import { PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getDashboardStats, listRecipes } from "@/lib/data/admin";
import { isAutomationEnabled } from "@/lib/services/automation";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();
  const [stats, recent] = await Promise.all([getDashboardStats(supabase), listRecipes(supabase)]);
  const cards = [
    { label: "Published recipes", value: stats.published, href: "/admin/recipes?status=published" },
    { label: "Drafts", value: stats.draft + stats.inReview, href: "/admin/recipes?status=draft" },
    { label: "Unused keywords", value: stats.keywordsNew, href: "/admin/keywords?status=new" },
    { label: "Errors", value: stats.jobsFailed + stats.pinsFailed, href: "/admin/errors" },
  ];
  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Manage recipes, categories and keywords. Automated publishing is not active in this phase."
        actions={
          <Link href="/admin/recipes/new" className="btn btn-primary">
            New recipe
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-2xl border border-line bg-card p-5 transition-shadow hover:shadow-card">
            <p className="text-sm text-ink-soft">{c.label}</p>
            <p className="mt-2 font-serif text-4xl text-ink">{c.value}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Recently edited">
          <ul className="divide-y divide-line">
            {recent.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <Link href={`/admin/recipes/${r.id}`} className="min-w-0 truncate font-medium text-ink hover:text-sage-dark">
                  {r.title}
                </Link>
                <span className="flex shrink-0 items-center gap-3 text-xs text-ink-faint">
                  {formatDateTime(r.updated_at)} <StatusBadge status={r.status} />
                </span>
              </li>
            ))}
            {recent.length === 0 && <li className="py-3 text-sm text-ink-soft">No recipes yet.</li>}
          </ul>
        </Panel>
        <Panel title="Automation">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Daily publishing</dt>
              <dd className="font-semibold text-ink">{isAutomationEnabled() ? "Enabled by env flag (no scheduler exists)" : "Off"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">AI recipe generation</dt>
              <dd className="font-semibold text-ink">Not built yet</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Pinterest publishing</dt>
              <dd className="font-semibold text-ink">Not built yet</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Pins waiting</dt>
              <dd className="font-semibold text-ink">{stats.pinsPending}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Keywords imported</dt>
              <dd className="font-semibold text-ink">{stats.keywordsTotal}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
