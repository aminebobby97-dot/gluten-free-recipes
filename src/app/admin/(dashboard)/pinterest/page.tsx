import Link from "next/link";
import { prepareMissingPinsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { EmptyState, FilterTabs, Notice, PageHeader, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { PIN_STATUSES, countPinsByStatus, listPins, type AdminPinRow } from "@/lib/data/admin";
import { listRecipesWithoutPins } from "@/lib/services/pinterest";
import { getPinterestConnection } from "@/lib/services/pinterest-connection";
import { ConnectResult, PinterestConnectionPanel } from "./connection-panel";

export const metadata = { title: "Pinterest" };

const LABELS: Record<(typeof PIN_STATUSES)[number], string> = { ready: "Ready for review", pending: "Pending", failed: "Failed", published: "Published" };

export default async function AdminPinterestPage({ searchParams }: PageProps<"/admin/pinterest">) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const status = PIN_STATUSES.find((s) => s === params.status);
  const pins = await listPins(supabase, status);

  if (pins === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pinterest" description="Pinterest Pins prepared for published recipes." />
        <Notice tone="error">The Pinterest database update has not been applied yet. Run the Pinterest migration in the Supabase SQL Editor (see docs/PINTEREST.md), then reload this page.</Notice>
      </div>
    );
  }

  const [counts, missing, connection] = await Promise.all([countPinsByStatus(supabase), listRecipesWithoutPins(supabase), getPinterestConnection(supabase)]);
  const connectResult = typeof params.connect === "string" ? params.connect : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Pinterest" description="Each published recipe gets a Pin prepared automatically: a 1000 × 1500 image made from the recipe photo, plus title, description and keywords. Review and edit them here." />
      <ConnectResult code={connectResult} />
      <PinterestConnectionPanel installed={connection.installed} connection={connection.installed ? connection.connection : null} />
      <Notice>
        Automatic Pinterest publishing is <strong>off</strong>. Pins are prepared for review; a Pin is sent to Pinterest only when you open it and click <strong>Publish Pin</strong>, one at a time.
      </Notice>

      {missing.length > 0 && (
        <ActionForm action={prepareMissingPinsAction} className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-soft">
              {missing.length} published recipe{missing.length === 1 ? " has" : "s have"} no Pin yet (for example recipes published before this feature).
            </p>
            <SubmitButton pendingLabel="Preparing…">Prepare missing Pins</SubmitButton>
          </div>
        </ActionForm>
      )}

      <FilterTabs base="/admin/pinterest" current={status} options={[{ label: "All" }, ...PIN_STATUSES.map((s) => ({ value: s, label: `${LABELS[s]} (${counts[s]})` }))]} />

      {pins.length === 0 ? (
        <EmptyState>{status ? "No Pins with this status." : "No Pins yet. They are prepared when a recipe is published."}</EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {pins.map((pin) => (
            <PinCard key={pin.id} pin={pin} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PinCard({ pin }: { pin: AdminPinRow }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <Link href={`/admin/pinterest/${pin.id}`} className="relative block aspect-[2/3] bg-cream-deep">
        {pin.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pin.image_url} alt={pin.image_text ?? pin.pin_title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">No image yet</span>
        )}
        <span className="absolute left-3 top-3">
          <StatusBadge status={pin.publication_status} />
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4 text-sm">
        <Link href={`/admin/pinterest/${pin.id}`} className="font-medium text-ink hover:text-sage-dark">
          {pin.pin_title}
        </Link>
        <p className="line-clamp-4 text-ink-soft">{pin.pin_description}</p>
        {pin.keywords.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {pin.keywords.map((k) => (
              <li key={k} className="rounded-full bg-cream-deep px-2 py-0.5 text-xs text-ink-soft">
                {k}
              </li>
            ))}
          </ul>
        )}
        <a href={pin.destination_url} target="_blank" rel="noreferrer" className="truncate text-xs text-sage-dark hover:underline">
          {pin.destination_url}
        </a>
        <p className="text-xs text-ink-faint">
          Board: {pin.board_name}
          {pin.recipe && pin.recipe.status !== "published" ? " · recipe is not published" : ""}
          {pin.edited_at ? " · edited" : ""}
        </p>
        {pin.error_message && <p className="text-xs text-danger">{pin.error_message}</p>}
        <p className="mt-auto pt-1 text-xs text-ink-faint">{pin.published_at ? `Published ${formatDateTime(pin.published_at)}` : `Prepared ${formatDateTime(pin.prepared_at)}`}</p>
      </div>
    </li>
  );
}
