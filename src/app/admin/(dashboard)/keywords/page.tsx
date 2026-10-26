import { importKeywordsAction, updateKeywordStatusAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { EmptyState, FilterTabs, PageHeader, Panel, StatusBadge, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listKeywords } from "@/lib/data/admin";

export const metadata = { title: "Keywords" };

const STATUSES = ["new", "queued", "assigned", "used", "rejected"];

export default async function AdminKeywordsPage({ searchParams }: PageProps<"/admin/keywords">) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const status = typeof params.status === "string" && STATUSES.includes(params.status) ? params.status : undefined;
  const keywords = await listKeywords(supabase, status);

  return (
    <div className="space-y-6">
      <PageHeader title="Keywords" description="Keyword ideas for future recipes. The automation will pick the oldest unused keyword once it is built." />
      <Panel title="Import keywords">
        <ActionForm action={importKeywordsAction}>
          <p className="mb-3 text-sm text-ink-soft">
            Paste one keyword per line, or CSV with a header row using these columns:{" "}
            <code className="rounded bg-cream-deep px-1 text-xs">keyword,category,search_volume,keyword_difficulty,data_source,notes</code>. Leave
            metrics blank if you do not have them; rows with metrics must name their data source. Category is a category slug.
          </p>
          <textarea
            name="csv"
            rows={6}
            className="field-input font-mono text-sm"
            placeholder={"keyword,category,search_volume,keyword_difficulty,data_source\ngluten free waffles,gluten-free-breakfast,,,"}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm text-ink-soft file:mr-3 file:rounded-full file:border file:border-line-strong file:bg-card file:px-4 file:py-2 file:text-sm file:font-semibold" />
            <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <FilterTabs base="/admin/keywords" current={status} options={[{ label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} />

      {keywords.length === 0 ? (
        <EmptyState>No keywords yet.</EmptyState>
      ) : (
        <Table head={["Keyword", "Category", "Volume", "Difficulty", "Source", "Status", "Recipe", ""]}>
          {keywords.map((k) => (
            <tr key={k.id}>
              <td className="px-4 py-3 font-medium text-ink">{k.keyword}</td>
              <td className="px-4 py-3 text-ink-soft">{k.category?.short_name ?? "—"}</td>
              <td className="px-4 py-3 text-ink-soft">{k.search_volume ?? <span className="text-ink-faint">unknown</span>}</td>
              <td className="px-4 py-3 text-ink-soft">{k.keyword_difficulty ?? <span className="text-ink-faint">unknown</span>}</td>
              <td className="px-4 py-3 text-xs text-ink-faint">{k.data_source ?? "—"}</td>
              <td className="px-4 py-3">
                <StatusBadge status={k.status} />
              </td>
              <td className="px-4 py-3 text-ink-soft">{k.recipe?.title ?? "—"}</td>
              <td className="px-4 py-3 text-right">
                {(k.status === "new" || k.status === "rejected") && (
                  <ActionForm action={updateKeywordStatusAction} hidden={{ id: k.id, status: k.status === "new" ? "rejected" : "new" }}>
                    <SubmitButton className="text-xs font-semibold text-sage-dark hover:underline" pendingLabel="…">
                      {k.status === "new" ? "Reject" : "Restore"}
                    </SubmitButton>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
