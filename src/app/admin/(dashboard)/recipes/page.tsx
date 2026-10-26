import Link from "next/link";
import { EmptyState, FilterTabs, Notice, PageHeader, StatusBadge, Table, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listRecipes, RECIPE_STATUSES } from "@/lib/data/admin";
import type { RecipeStatus } from "@/lib/recipes/types";

export const metadata = { title: "Recipes" };

export default async function AdminRecipesPage({ searchParams }: PageProps<"/admin/recipes">) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const status = RECIPE_STATUSES.includes(params.status as RecipeStatus) ? (params.status as RecipeStatus) : undefined;
  const recipes = await listRecipes(supabase, status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipes"
        description="Drafts are private. Only published recipes appear on the site and in the sitemap."
        actions={
          <Link href="/admin/recipes/new" className="btn btn-primary">
            New recipe
          </Link>
        }
      />
      {params.deleted && <Notice tone="success">Recipe deleted.</Notice>}
      <FilterTabs
        base="/admin/recipes"
        current={status}
        options={[{ label: "All" }, ...RECIPE_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) }))]}
      />
      {recipes.length === 0 ? (
        <EmptyState>No recipes match this filter.</EmptyState>
      ) : (
        <Table head={["Recipe", "Category", "Status", "Tested", "Updated", ""]}>
          {recipes.map((r) => (
            <tr key={r.id} className="align-middle">
              <td className="px-4 py-3">
                <Link href={`/admin/recipes/${r.id}`} className="font-medium text-ink hover:text-sage-dark">
                  {r.title}
                </Link>
                <p className="font-mono text-xs text-ink-faint">/{r.slug}</p>
              </td>
              <td className="px-4 py-3 text-ink-soft">{r.category?.short_name ?? "—"}</td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 text-ink-soft">{r.is_tested ? "Yes" : "No"}</td>
              <td className="px-4 py-3 text-xs text-ink-faint">{formatDateTime(r.updated_at)}</td>
              <td className="px-4 py-3 text-right">
                {r.status === "published" ? (
                  <Link href={`/recipes/${r.slug}`} className="text-xs font-semibold text-sage-dark hover:underline">
                    View ↗
                  </Link>
                ) : (
                  <Link href={`/admin/recipes/${r.id}/preview`} className="text-xs font-semibold text-sage-dark hover:underline">
                    Preview
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
