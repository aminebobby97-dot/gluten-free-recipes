import { Panel, StatusBadge, Table, formatDateTime } from "@/components/admin/ui";
import type { KeywordQueueOverview, KeywordReplenishment } from "@/lib/data/automation";

/** One line for the latest top-up: "Added 31 on Nov 6, 2026, 2:03 AM UTC". */
export function replenishmentSummary(run: KeywordReplenishment | undefined): string {
  if (!run) return "Not needed yet";
  if (run.status === "succeeded") return `Added ${run.inserted} on ${formatDateTime(run.started_at)}`;
  if (run.status === "running") return `Running since ${formatDateTime(run.started_at)}`;
  return `Failed on ${formatDateTime(run.started_at)}`;
}

/** Usable keyword count, why the other keywords are left out, and the latest automatic top-ups. */
export function KeywordQueuePanel({ overview }: { overview: KeywordQueueOverview }) {
  const { stats, threshold, replenishments } = overview;
  const low = stats.usable < threshold;
  const counts = [
    { label: "Usable now", value: stats.usable, strong: true },
    { label: "Used or assigned", value: stats.used + stats.assigned },
    { label: "Held by a job", value: stats.queued },
    { label: "Rejected", value: stats.rejected },
    { label: "Too hard", value: stats.tooHard },
    { label: "Out of attempts", value: stats.outOfAttempts },
  ];
  return (
    <Panel title="Keyword queue">
      <p className={`mb-4 text-sm ${low ? "text-honey" : "text-ink-soft"}`}>
        {low
          ? `Fewer than ${threshold} usable keywords. The next daily run will first ask Claude for new long-tail keyword ideas (at most 2 tries a day, within the daily AI budget).`
          : `The daily run adds new keyword ideas automatically when fewer than ${threshold} keywords are usable.`}{" "}
        AI-suggested keywords have no search volume or difficulty data.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((c) => (
          <div key={c.label} className="rounded-xl border border-line px-3 py-2">
            <dt className="text-xs text-ink-faint">{c.label}</dt>
            <dd className={`mt-1 font-serif text-2xl ${c.strong && low ? "text-honey" : "text-ink"}`}>{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-faint">
        Usable means status New, no recipe yet, fewer than 3 failed attempts, and a difficulty that is unknown or within the maximum in Admin → Automation.
        A keyword can still be rejected when it is tried if it is too similar to an existing recipe.
      </p>

      <h3 className="mt-6 mb-3 text-sm font-semibold text-ink">Automatic top-ups</h3>
      {replenishments == null ? (
        <p className="text-sm text-ink-soft">Not set up yet: the keyword replenishment database migration has not been applied.</p>
      ) : replenishments.length === 0 ? (
        <p className="text-sm text-ink-soft">None yet.</p>
      ) : (
        <Table head={["Started", "Status", "Usable before", "Ideas", "Added", "Screened out", "Usable after", "Cost", "Details"]}>
          {replenishments.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 text-ink-soft">{formatDateTime(r.started_at)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 text-ink-soft">{r.usable_before}</td>
              <td className="px-4 py-3 text-ink-soft">{r.suggested}</td>
              <td className="px-4 py-3 font-semibold text-ink">{r.inserted}</td>
              <td className="px-4 py-3 text-ink-soft">{r.rejected}</td>
              <td className="px-4 py-3 text-ink-soft">{r.usable_after ?? "—"}</td>
              <td className="px-4 py-3 text-ink-soft">${r.cost_usd.toFixed(2)}</td>
              <td className="px-4 py-3 text-xs text-ink-soft">
                {r.error_message && <p className="mb-1 text-danger">{r.error_message}</p>}
                {r.rejections.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">Screened-out ideas</summary>
                    <ul className="mt-1 space-y-0.5">
                      {r.rejections.map((x, i) => (
                        <li key={i}>
                          {x.keyword}: {x.reason}
                          {x.detail ? ` (${x.detail})` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
