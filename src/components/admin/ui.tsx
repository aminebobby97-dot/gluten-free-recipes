import Link from "next/link";
import type { ReadinessIssue } from "@/lib/recipes/validation";

const STATUS_STYLES: Record<string, string> = {
  published: "bg-sage-wash text-sage-dark border-sage-light/60",
  succeeded: "bg-sage-wash text-sage-dark border-sage-light/60",
  used: "bg-sage-wash text-sage-dark border-sage-light/60",
  draft: "bg-cream-deep text-ink-soft border-line-strong",
  new: "bg-cream-deep text-ink-soft border-line-strong",
  pending: "bg-cream-deep text-ink-soft border-line-strong",
  in_review: "bg-honey-wash text-honey border-honey/30",
  queued: "bg-honey-wash text-honey border-honey/30",
  assigned: "bg-honey-wash text-honey border-honey/30",
  running: "bg-honey-wash text-honey border-honey/30",
  publishing: "bg-honey-wash text-honey border-honey/30",
  failed: "bg-danger-wash text-danger border-danger/30",
  rejected: "bg-danger-wash text-danger border-danger/30",
  archived: "bg-cream-deep text-ink-faint border-line",
  cancelled: "bg-cream-deep text-ink-faint border-line",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-medium text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 md:p-6 ${className}`}>
      {title && <h2 className="mb-4 font-sans text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{title}</h2>}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-soft">{children}</p>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-line-strong bg-cream text-ink",
    success: "border-sage-light/60 bg-sage-wash text-sage-dark",
    error: "border-danger/30 bg-danger-wash text-danger",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function IssueList({ issues, tone = "error" }: { issues: ReadinessIssue[]; tone?: "error" | "warning" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={`space-y-1.5 text-sm ${tone === "error" ? "text-danger" : "text-honey"}`}>
      {issues.map((issue, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true">{tone === "error" ? "✕" : "!"}</span>
          <span>
            <code className="rounded bg-cream-deep px-1 py-0.5 text-[0.75rem] text-ink-soft">{issue.field}</code> {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line bg-cream/70 text-xs uppercase tracking-[0.08em] text-ink-faint">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function FilterTabs({ base, current, options }: { base: string; current?: string; options: Array<{ value?: string; label: string }> }) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Filter">
      {options.map((o) => {
        const active = (o.value ?? "") === (current ?? "");
        return (
          <Link
            key={o.label}
            href={o.value ? `${base}?status=${o.value}` : base}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${active ? "bg-ink text-white" : "text-ink-soft hover:bg-cream-deep"}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}
