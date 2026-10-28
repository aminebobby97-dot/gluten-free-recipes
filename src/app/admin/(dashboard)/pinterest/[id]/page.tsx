import Link from "next/link";
import { notFound } from "next/navigation";
import { preparePinAction, savePinAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { Notice, PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getPin } from "@/lib/data/admin";
import { PIN_ALT_MAX, PIN_DESCRIPTION_MAX, PIN_IMAGE_TEXT_MAX, PIN_KEYWORDS_MAX, PIN_TITLE_MAX } from "@/lib/pins/metadata";

export const metadata = { title: "Pinterest Pin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPinPage({ params }: PageProps<"/admin/pinterest/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const pin = await getPin(supabase, id);
  if (!pin) notFound();
  const locked = ["publishing", "published", "cancelled"].includes(pin.publication_status);
  const recipeId = pin.recipe?.id ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pinterest Pin"
        description={pin.recipe ? `For “${pin.recipe.title}”` : undefined}
        actions={
          <>
            {pin.recipe && (
              <Link href={`/admin/recipes/${pin.recipe.id}`} className="btn btn-secondary">
                Edit recipe
              </Link>
            )}
            <Link href="/admin/pinterest" className="btn btn-secondary">
              All Pins
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
        <StatusBadge status={pin.publication_status} />
        <span>Prepared {formatDateTime(pin.prepared_at)}</span>
        {pin.edited_at && <span>· Edited {formatDateTime(pin.edited_at)}</span>}
        {pin.pinterest_pin_id && <span className="font-mono text-xs">· Pinterest ID {pin.pinterest_pin_id}</span>}
      </div>

      {pin.error_message && <Notice tone="error">{pin.error_message}</Notice>}
      {pin.recipe && pin.recipe.status !== "published" && <Notice tone="error">This recipe is not published, so its Pin should not be posted until it is live again.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-line bg-cream-deep">
            {pin.image_url ? (
              <a href={pin.image_url} target="_blank" rel="noreferrer" title="Open the full-size image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pin.image_url} alt={pin.image_alt ?? pin.pin_title} className="aspect-[2/3] w-full object-cover" />
              </a>
            ) : (
              <p className="flex aspect-[2/3] items-center justify-center px-6 text-center text-sm text-ink-faint">No image yet</p>
            )}
          </div>
          {!locked && recipeId && (
            <div className="space-y-3">
              <ActionForm action={preparePinAction} hidden={{ recipe_id: recipeId, mode: "redraw" }}>
                <SubmitButton className="btn btn-secondary w-full" pendingLabel="Drawing…">
                  {pin.publication_status === "failed" ? "Retry" : "Redraw image"}
                </SubmitButton>
                <p className="field-hint mt-1.5">Uses the recipe’s current photo. Change the photo on the recipe page.</p>
              </ActionForm>
              <ActionForm action={preparePinAction} hidden={{ recipe_id: recipeId, mode: "reset" }}>
                <SubmitButton className="btn btn-secondary w-full" pendingLabel="Rebuilding…">
                  Rebuild text from the recipe
                </SubmitButton>
                <p className="field-hint mt-1.5">Replaces your edits with text generated from the recipe again.</p>
              </ActionForm>
            </div>
          )}
        </div>

        <Panel title="Pin content">
          {locked ? (
            <Notice>This Pin is {pin.publication_status} and can no longer be edited.</Notice>
          ) : (
            <ActionForm action={savePinAction} hidden={{ id: pin.id }} className="space-y-5">
              <Field label="Pin title" hint={`Up to ${PIN_TITLE_MAX} characters. Shown in bold on Pinterest.`}>
                <input name="pin_title" defaultValue={pin.pin_title} maxLength={PIN_TITLE_MAX} required className="field-input" />
              </Field>
              <Field label="Description" hint={`Up to ${PIN_DESCRIPTION_MAX} characters. Write for people first; mention the main keyword once, naturally.`}>
                <textarea name="pin_description" defaultValue={pin.pin_description} maxLength={PIN_DESCRIPTION_MAX} rows={6} className="field-input" />
              </Field>
              <Field label="Keywords" hint={`Up to ${PIN_KEYWORDS_MAX}, separated by commas. For your reference and future scheduling; not added as hashtags.`}>
                <input name="keywords" defaultValue={pin.keywords.join(", ")} className="field-input" />
              </Field>
              <Field label="Text on the image" hint={`Up to ${PIN_IMAGE_TEXT_MAX} characters. Changing it redraws the image.`}>
                <input name="image_text" defaultValue={pin.image_text ?? ""} maxLength={PIN_IMAGE_TEXT_MAX} required className="field-input" />
              </Field>
              <Field label="Image alt text" hint={`Up to ${PIN_ALT_MAX} characters. Describes the image for screen readers.`}>
                <textarea name="image_alt" defaultValue={pin.image_alt ?? ""} maxLength={PIN_ALT_MAX} rows={2} className="field-input" />
              </Field>
              <Field label="Board" hint="The Pinterest board this Pin will go to.">
                <input name="board_name" defaultValue={pin.board_name} maxLength={180} required className="field-input" />
              </Field>
              <div>
                <p className="field-label">Destination URL</p>
                <a href={pin.destination_url} target="_blank" rel="noreferrer" className="break-all text-sm text-sage-dark hover:underline">
                  {pin.destination_url}
                </a>
                <p className="field-hint">Always the recipe’s page on the live site, updated automatically if its address changes.</p>
              </div>
              <SubmitButton>Save Pin</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      <span className="field-hint block">{hint}</span>
    </label>
  );
}
