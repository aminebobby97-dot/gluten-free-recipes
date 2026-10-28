import Link from "next/link";
import type { AdminJobRow, AdminPinRow } from "@/lib/data/admin";
import { EmptyState, StatusBadge, Table, formatDateTime } from "./ui";

export function JobsTable({ jobs, empty }: { jobs: AdminJobRow[]; empty: string }) {
  if (jobs.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <Table head={["Date", "Type", "Status", "Step", "Keyword", "Recipe", "Retries", "Error"]}>
      {jobs.map((j) => (
        <tr key={j.id} className="align-top">
          <td className="whitespace-nowrap px-4 py-3 font-medium">
            <Link href={`/admin/jobs/${j.id}`} className="text-sage-dark hover:underline">
              {j.job_date}
            </Link>
          </td>
          <td className="px-4 py-3 text-ink-soft">{j.job_type}</td>
          <td className="px-4 py-3">
            <StatusBadge status={j.status} />
          </td>
          <td className="px-4 py-3 text-xs text-ink-soft">{j.current_step ?? "—"}</td>
          <td className="px-4 py-3 text-ink-soft">{j.keyword?.keyword ?? "—"}</td>
          <td className="px-4 py-3">
            {j.recipe ? (
              <Link href={`/admin/recipes/${j.recipe.id}`} className="text-sage-dark hover:underline">
                {j.recipe.title}
              </Link>
            ) : (
              "—"
            )}
          </td>
          <td className="px-4 py-3 text-ink-soft">{j.retry_count}</td>
          <td className="max-w-xs px-4 py-3 text-xs text-danger">{j.error_message ?? ""}</td>
        </tr>
      ))}
    </Table>
  );
}

export function PinsTable({ pins, empty }: { pins: AdminPinRow[]; empty: string }) {
  if (pins.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <Table head={["Pin", "Recipe", "Status", "Pinterest ID", "Published", "Retries", "Error"]}>
      {pins.map((p) => (
        <tr key={p.id} className="align-top">
          <td className="px-4 py-3">
            <Link href={`/admin/pinterest/${p.id}`} className="font-medium text-sage-dark hover:underline">
              {p.pin_title}
            </Link>
            <p className="max-w-[16rem] truncate text-xs text-ink-faint">{p.destination_url}</p>
          </td>
          <td className="px-4 py-3">
            {p.recipe ? (
              <Link href={`/admin/recipes/${p.recipe.id}`} className="text-sage-dark hover:underline">
                {p.recipe.title}
              </Link>
            ) : (
              "—"
            )}
          </td>
          <td className="px-4 py-3">
            <StatusBadge status={p.publication_status} />
          </td>
          <td className="px-4 py-3 font-mono text-xs text-ink-soft">{p.pinterest_pin_id ?? "—"}</td>
          <td className="px-4 py-3 text-xs text-ink-faint">{formatDateTime(p.published_at)}</td>
          <td className="px-4 py-3 text-ink-soft">{p.retry_count}</td>
          <td className="max-w-xs px-4 py-3 text-xs text-danger">{p.error_message ?? ""}</td>
        </tr>
      ))}
    </Table>
  );
}
