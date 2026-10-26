import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Panel, StatusBadge, Table, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getJobDetail } from "@/lib/data/automation";

export const metadata = { title: "Publishing job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABELS: Record<string, string> = {
  recipe: "Write recipe",
  repair: "Repair recipe",
  review: "Independent review",
  image: "Site photo",
  image_check: "Site photo check",
  pin_image: "Pinterest photo",
  pin_image_check: "Pinterest photo check",
};

export default async function AdminJobPage({ params }: PageProps<"/admin/jobs/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await getJobDetail(supabase, id);
  if (!detail) notFound();
  const { job, events, attempts } = detail;
  const totalCost = attempts?.reduce((sum, a) => sum + a.cost_usd, 0) ?? job.cost_usd ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${job.job_type.replace(/_/g, " ")} · ${job.job_date}`}
        description={job.keyword ? `Keyword: ${job.keyword.keyword}` : undefined}
        actions={
          <>
            {job.run_url && (
              <a href={job.run_url} className="btn btn-secondary" target="_blank" rel="noreferrer">
                GitHub run ↗
              </a>
            )}
            <Link href="/admin/jobs" className="btn btn-secondary">
              All jobs
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Status">
          <StatusBadge status={job.status} />
        </Fact>
        <Fact label="Mode">{job.mode ? job.mode.replace(/_/g, " ") : "—"}</Fact>
        <Fact label="AI cost">${totalCost.toFixed(4)}</Fact>
        <Fact label="Recipe">
          {job.recipe ? (
            <Link href={`/admin/recipes/${job.recipe.id}`} className="text-sage-dark hover:underline">
              {job.recipe.title}
            </Link>
          ) : (
            "—"
          )}
        </Fact>
      </div>

      {job.error_message && <Notice tone="error">{job.error_message}</Notice>}

      <Panel title="Steps">
        {events === null ? (
          <EmptyState>The step log is available after the automation migration is applied.</EmptyState>
        ) : events.length === 0 ? (
          <EmptyState>No steps were logged.</EmptyState>
        ) : (
          <ol className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-36 shrink-0 text-xs text-ink-faint">{formatDateTime(e.created_at)}</span>
                <span className="font-medium text-ink">{e.step.replace(/_/g, " ")}</span>
                <StatusBadge status={e.status} />
                {e.duration_ms !== null && <span className="text-xs text-ink-faint">{(e.duration_ms / 1000).toFixed(1)} s</span>}
                {e.message && <span className="basis-full pl-0 text-xs text-ink-soft sm:pl-39">{e.message}</span>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="AI calls">
        {attempts === null ? (
          <EmptyState>AI call records are available after the automation migration is applied.</EmptyState>
        ) : attempts.length === 0 ? (
          <EmptyState>No AI calls were made.</EmptyState>
        ) : (
          <Table head={["Call", "Model", "Result", "Tokens in / out", "Cost", "Findings"]}>
            {attempts.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                  {KIND_LABELS[a.kind] ?? a.kind} {a.attempt > 1 && <span className="text-ink-faint">#{a.attempt}</span>}
                </td>
                <td className="px-4 py-3 text-xs text-ink-soft">
                  {a.model}
                  <span className="block text-ink-faint">{a.prompt_version}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
                  {a.input_tokens ?? "—"} / {a.output_tokens ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-soft">${a.cost_usd.toFixed(4)}</td>
                <td className="max-w-md px-4 py-3 text-xs">
                  {a.error_message && <p className="text-danger">{a.error_message}</p>}
                  {a.issues.length > 0 && (
                    <ul className="space-y-1">
                      {a.issues.map((i, n) => (
                        <li key={n} className={i.severity === "blocking" ? "text-danger" : "text-honey"}>
                          <code className="rounded bg-cream-deep px-1 text-ink-soft">{i.field}</code> {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <div className="mt-2 text-lg text-ink">{children}</div>
    </div>
  );
}
