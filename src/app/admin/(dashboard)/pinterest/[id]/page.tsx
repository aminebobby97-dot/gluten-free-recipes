import Link from "next/link";
import { notFound } from "next/navigation";
import { checkPinAction, preparePinAction, publishPinAction, resetPinDestinationAction, savePinAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { CopyButton } from "@/components/admin/copy-button";
import { SubmitButton } from "@/components/admin/submit-button";
import { Notice, PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getPin, type AdminPinDetail } from "@/lib/data/admin";
import { getPinterestConnection, tokenHealth, type PinterestConnection } from "@/lib/services/pinterest-connection";
import { DESTINATION_URL_MAX, isShortenedLink, pinLink } from "@/lib/pins/destination";
import { PIN_ALT_MAX, PIN_DESCRIPTION_MAX, PIN_IMAGE_TEXT_MAX, PIN_KEYWORDS_MAX, PIN_TITLE_MAX } from "@/lib/pins/metadata";

export const metadata = { title: "Pinterest Pin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPinPage({ params }: PageProps<"/admin/pinterest/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const pin = await getPin(supabase, id);
  if (!pin) notFound();
  const connection = await getPinterestConnection(supabase);
  const locked = ["publishing", "published", "cancelled"].includes(pin.publication_status);
  const recipeId = pin.recipe?.id ?? "";
  const link = pinLink(pin);
  const hasCustomLink = Boolean(pin.custom_destination_url);
  // undefined: the custom destination migration is not applied yet.
  const canEditLink = pin.custom_destination_url !== undefined;

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
        {pin.pinterest_pin_id && (
          <a href={`https://www.pinterest.com/pin/${encodeURIComponent(pin.pinterest_pin_id)}/`} target="_blank" rel="noreferrer" className="font-mono text-xs text-sage-dark hover:underline">
            · View on Pinterest ({pin.pinterest_pin_id})
          </a>
        )}
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
          {pin.publication_status === "ready" && <PublishPanel pin={pin} connection={connection.installed ? connection.connection : null} />}
          {pin.publication_status === "publishing" && (
            <div className="space-y-3 rounded-2xl border border-line bg-card p-4 text-sm">
              <p className="font-medium text-ink">Waiting for Pinterest’s answer</p>
              <p className="text-ink-soft">
                A publish attempt did not get an answer, so the Pin may or may not exist. It is never posted again until it has been looked up on your
                board. The daily run does this automatically; you can also check now.
              </p>
              <ActionForm action={checkPinAction} hidden={{ id: pin.id }}>
                <SubmitButton className="btn btn-secondary w-full" pendingLabel="Checking…">
                  Check Pinterest
                </SubmitButton>
              </ActionForm>
            </div>
          )}
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
              {canEditLink ? (
                <Field
                  label="Destination URL"
                  hint={`Where the Pin takes people. Starts as the recipe’s page; paste your own https:// link (for example a Bitly link you made) to replace it, then click Save Pin. Up to ${DESTINATION_URL_MAX} characters.`}
                >
                  <input name="destination_url" type="url" inputMode="url" defaultValue={link} maxLength={DESTINATION_URL_MAX} required pattern="https://.+" className="field-input" />
                </Field>
              ) : (
                <div>
                  <p className="field-label">Destination URL</p>
                  <p className="break-all text-sm">{pin.destination_url}</p>
                  <p className="field-hint">To use your own link here, apply the custom destination database update first (see docs/PINTEREST.md).</p>
                </div>
              )}
              <SubmitButton>Save Pin</SubmitButton>
            </ActionForm>
          )}
          <DestinationDetails pin={pin} link={link} hasCustomLink={hasCustomLink} />
          {!locked && hasCustomLink && (
            <ActionForm action={resetPinDestinationAction} hidden={{ id: pin.id }} className="mt-4">
              <SubmitButton className="btn btn-secondary" pendingLabel="Resetting…">
                Reset to original recipe URL
              </SubmitButton>
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

function DestinationDetails({ pin, link, hasCustomLink }: { pin: AdminPinDetail; link: string; hasCustomLink: boolean }) {
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
      <div>
        <p className="field-label">{pin.publication_status === "published" ? "The Pin links to" : "The Pin will link to"}</p>
        <p className="break-all">
          {link} <span className="text-xs text-ink-faint">({hasCustomLink ? "your custom link" : "original recipe URL"})</span>
        </p>
        <a href={link} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-sage-dark underline">
          Open destination URL
        </a>
        <span className="field-hint block">Check that it opens the right recipe before you publish.</span>
      </div>
      <div>
        <p className="field-label">Original recipe URL</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all">{pin.destination_url}</span>
          <CopyButton value={pin.destination_url} label="Copy original URL" className="btn btn-secondary px-3 py-1 text-xs" />
        </div>
        <span className="field-hint block">Copy this into Bitly to make a short link, then paste the short link into Destination URL above.</span>
      </div>
      {isShortenedLink(link) && (
        <Notice>
          Pinterest follows short links to the page they lead to and checks that page. A short link does not get around a block: if Pinterest blocks your
          website, it blocks the short link too, and Pinterest’s rules say not to use redirects to reach a site it does not allow. If Publish Pin shows a
          “blocked” error, claim your website in Pinterest and ask Pinterest support to review it (see docs/PINTEREST.md).
        </Notice>
      )}
    </div>
  );
}

function PublishPanel({ pin, connection }: { pin: AdminPinDetail; connection: PinterestConnection | null }) {
  const blocker = !connection
    ? "Connect Pinterest first (Pinterest page, Pinterest account)."
    : tokenHealth(connection) === "reconnect"
      ? "The Pinterest sign-in has expired. Click Reconnect Pinterest on the Pinterest page."
      : !connection.selected_board_id
        ? "Choose the board to publish to first (Pinterest page, Board)."
        : pin.recipe?.status !== "published"
          ? "The recipe is not published."
          : null;

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-4 text-sm">
      <p className="font-medium text-ink">Publish to Pinterest</p>
      {blocker ? (
        <p className="text-ink-soft">
          {blocker}{" "}
          <Link href="/admin/pinterest" className="text-sage-dark underline">
            Open Pinterest settings
          </Link>
        </p>
      ) : (
        <ActionForm action={publishPinAction} hidden={{ id: pin.id, expected_link: pinLink(pin) }} className="space-y-3">
          <p className="text-ink-soft">
            Posts this one Pin, with its image, title, description and alt text, to <strong>“{connection!.selected_board_name}”</strong> as @
            {connection!.pinterest_username ?? "your account"}.
          </p>
          <p className="break-all text-ink-soft">
            Links to: <strong className="text-ink">{pinLink(pin)}</strong>
            <span className="block text-xs">Changed the Destination URL? Click Save Pin first: Publish Pin uses the saved link.</span>
          </p>
          {pin.recipe?.image_source === "ai" ? (
            <label className="flex items-start gap-2">
              {/* Always sent for AI photos; the server adds the label for them anyway. */}
              <input type="hidden" name="ai_modified" value="yes" />
              <input type="checkbox" checked disabled readOnly className="mt-1" />
              <span>Labelled as made with AI (Pinterest’s AI label). This recipe’s photo was generated with AI, so the label is always added.</span>
            </label>
          ) : (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="ai_modified" value="yes" className="mt-1" />
              <span>Label the image as made or changed with AI (Pinterest’s AI label).</span>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
            <span>I checked this Pin and want to post it to Pinterest now.</span>
          </label>
          <SubmitButton className="btn btn-primary w-full" pendingLabel="Publishing…">
            Publish Pin
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
