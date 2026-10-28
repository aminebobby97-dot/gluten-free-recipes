// Pinterest Pin preparation. When a recipe is published, its Pin is prepared
// (image + text) and stored in pinterest_posts as 'ready' for an admin to
// review. Nothing is ever sent to Pinterest: there is no API client, and
// getPinterestPublisher() throws until a later phase adds one.
//
// Shared by the admin dashboard (signed-in admin's client, RLS applies) and the
// automation worker (service-role client). Safe to call any number of times:
// one row per recipe and variant, an unchanged Pin is left alone, a published
// Pin is never touched, and text an admin edited is kept.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { IMAGE_BUCKET } from "@/lib/automation/providers/site";
import {
  PIN_ALT_MAX,
  PIN_DESCRIPTION_MAX,
  PIN_IMAGE_TEXT_MAX,
  PIN_KEYWORDS_MAX,
  PIN_TEMPLATE_VERSION,
  PIN_TITLE_MAX,
  buildPinArtwork,
  buildPinMetadata,
  pinPhotoSource,
  type PinArtwork,
  type PinMetadata,
  type PinRecipe,
} from "@/lib/pins/metadata";
import { analyzeClaimText } from "@/lib/recipes/gluten";
import type { RecipeStatus } from "@/lib/recipes/types";
import { dbError, ServiceError } from "./errors";

export type PinStatus = "pending" | "ready" | "publishing" | "published" | "failed" | "cancelled";

export interface PinterestPost {
  id: string;
  recipe_id: string;
  publishing_job_id: string | null;
  variant: string;
  pin_title: string;
  pin_description: string;
  keywords: string[];
  board_name: string;
  board_id: string | null;
  image_text: string | null;
  image_alt: string | null;
  image_url: string | null;
  image_path: string | null;
  destination_url: string;
  idempotency_key: string;
  publication_status: PinStatus;
  pinterest_pin_id: string | null;
  error_message: string | null;
  retry_count: number;
  prepared_at: string | null;
  edited_at: string | null;
  published_at: string | null;
  created_at: string;
}

/** Pins in these states belong to the (future) publisher and are never re-prepared or edited. */
const LOCKED: PinStatus[] = ["publishing", "published", "cancelled"];
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export interface PinImageStore {
  upload(path: string, data: Buffer, contentType: string): Promise<string>;
  remove(paths: string[]): Promise<void>;
}

/**
 * Pin images live in the public recipe-images bucket under pins/<recipe id>/.
 * The file name contains a hash of everything drawn on it, so a changed Pin
 * gets a new URL (no stale caches) and re-uploading the same Pin is harmless.
 */
export function createPinImageStore(db: SupabaseClient, bucket = IMAGE_BUCKET): PinImageStore {
  return {
    async upload(path, data, contentType) {
      const { error } = await db.storage.from(bucket).upload(path, data, { contentType, cacheControl: "31536000", upsert: true });
      if (error) throw new Error(`Upload ${path}: ${error.message}`);
      return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
    async remove(paths) {
      const { error } = await db.storage.from(bucket).remove(paths);
      if (error) throw new Error(`Remove Pin images: ${error.message}`);
    },
  };
}

export interface PinPreparationDeps {
  /** The live site's https address; Pins link to <siteUrl>/recipes/<slug>. */
  siteUrl: string;
  store: PinImageStore;
  /** Downloads the recipe photo. Defaults to fetch with a timeout and size limit. */
  fetchPhoto?: (url: string) => Promise<Uint8Array>;
  /** Draws the Pin. Defaults to renderPinImage (next/og + sharp). */
  render?: (photo: Uint8Array, artwork: PinArtwork) => Promise<Buffer>;
}

export interface PreparePinOptions {
  /** Re-render the image even if the Pin is already ready (for example after editing the image text). */
  force?: boolean;
  /** Rebuild the text from the recipe, discarding an admin's edits. */
  resetText?: boolean;
  variant?: string;
  jobId?: string | null;
}

export type PreparePinResult =
  | { outcome: "prepared" | "unchanged"; pin: PinterestPost; message: string }
  | { outcome: "skipped"; pin: PinterestPost | null; message: string }
  | { outcome: "failed"; pin: PinterestPost | null; message: string };

type RecipeForPin = PinRecipe & { status: RecipeStatus };

async function loadRecipe(db: SupabaseClient, recipeId: string): Promise<RecipeForPin> {
  const { data, error } = await db.from("recipes").select("*, category:categories(name, short_name)").eq("id", recipeId).maybeSingle();
  if (error) throw dbError("Load recipe", error);
  if (!data) throw new ServiceError("not_found", "Recipe not found.");
  return data as RecipeForPin;
}

async function loadPin(db: SupabaseClient, recipeId: string, variant: string): Promise<PinterestPost | null> {
  const { data, error } = await db.from("pinterest_posts").select("*").eq("recipe_id", recipeId).eq("variant", variant).maybeSingle();
  if (error) throw dbError("Load Pinterest Pin", error);
  return (data as PinterestPost | null) ?? null;
}

function absolutePhotoUrl(url: string, siteUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function fetchPhoto(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download the recipe photo (HTTP ${response.status}).`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`The recipe photo URL did not return an image (${type || "no content type"}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("The recipe photo is larger than 15 MB.");
  return bytes;
}

async function defaultRender(photo: Uint8Array, artwork: PinArtwork): Promise<Buffer> {
  // Loaded on demand so code that only reads Pins never loads the renderer.
  const { renderPinImage } = await import("@/lib/pins/image");
  return renderPinImage(photo, artwork);
}

/** Everything drawn on the image, hashed: same inputs, same file name. */
export function pinImagePath(recipeId: string, variant: string, photoUrl: string, artwork: PinArtwork): string {
  const hash = createHash("sha256").update(JSON.stringify([PIN_TEMPLATE_VERSION, photoUrl, artwork])).digest("hex").slice(0, 16);
  return `pins/${recipeId}/${variant}-${hash}.jpg`;
}

function textFields(meta: PinMetadata) {
  return {
    pin_title: meta.pin_title,
    pin_description: meta.pin_description,
    keywords: meta.keywords,
    board_name: meta.board_name,
    image_text: meta.image_text,
    image_alt: meta.image_alt,
  };
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 2000);
}

/**
 * Prepares (or refreshes) the Pin for a published recipe: text from the
 * recipe, image drawn from the recipe's own photo, saved as 'ready'.
 * Never throws for preparation problems: they are saved on the Pin as
 * 'failed' with a message, and returned, so publishing a recipe can never be
 * broken by its Pin.
 */
export async function preparePin(db: SupabaseClient, recipeId: string, deps: PinPreparationDeps, options: PreparePinOptions = {}): Promise<PreparePinResult> {
  const variant = options.variant ?? "primary";
  let pin: PinterestPost | null = null;
  try {
    const recipe = await loadRecipe(db, recipeId);
    pin = await loadPin(db, recipeId, variant);

    if (pin && LOCKED.includes(pin.publication_status)) {
      return { outcome: "skipped", pin, message: `The Pin is ${pin.publication_status} and was left unchanged.` };
    }
    if (recipe.status !== "published") {
      return { outcome: "skipped", pin, message: "Only published recipes get a Pinterest Pin." };
    }

    const meta = buildPinMetadata(recipe, deps.siteUrl);
    const keepEdits = Boolean(pin?.edited_at) && !options.resetText;
    const text = keepEdits && pin ? { pin_title: pin.pin_title, pin_description: pin.pin_description, keywords: pin.keywords, board_name: pin.board_name, image_text: pin.image_text ?? meta.image_text, image_alt: pin.image_alt ?? meta.image_alt } : textFields(meta);

    if (!pin) {
      // ignoreDuplicates + reload: two runs at once still end with one row.
      const { error } = await db.from("pinterest_posts").upsert(
        {
          recipe_id: recipeId,
          variant,
          idempotency_key: `pin:${recipeId}:${variant}`,
          publishing_job_id: options.jobId ?? null,
          destination_url: meta.destination_url,
          publication_status: "pending",
          ...text,
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      if (error) throw dbError("Save Pinterest Pin", error);
      pin = await loadPin(db, recipeId, variant);
      if (!pin) throw new ServiceError("database", "The Pinterest Pin was not saved.");
      if (LOCKED.includes(pin.publication_status)) return { outcome: "skipped", pin, message: `The Pin is ${pin.publication_status} and was left unchanged.` };
    }

    const photo = pinPhotoSource(recipe);
    if (!photo) throw new ServiceError("not_ready", "The recipe has no photo. Add a featured image to the recipe, then retry the Pin.");
    const photoUrl = absolutePhotoUrl(photo.url, deps.siteUrl);
    const artwork = buildPinArtwork(recipe, text.image_text);
    const path = pinImagePath(recipeId, variant, photoUrl, artwork);

    const sameImage = pin.image_url && pin.image_path === path;
    const textChanged = (Object.keys(text) as Array<keyof typeof text>).some((k) => JSON.stringify(pin![k]) !== JSON.stringify(text[k])) || pin.destination_url !== meta.destination_url;
    if (pin.publication_status === "ready" && sameImage && !textChanged && !options.force && !options.resetText) {
      return { outcome: "unchanged", pin, message: "The Pin is already prepared." };
    }

    const oldPath = pin.image_path;
    let imageUrl = pin.image_url;
    if (!sameImage || options.force) {
      const bytes = await (deps.fetchPhoto ?? fetchPhoto)(photoUrl);
      const jpeg = await (deps.render ?? defaultRender)(bytes, artwork);
      imageUrl = await deps.store.upload(path, jpeg, "image/jpeg");
    }

    const { data, error } = await db
      .from("pinterest_posts")
      .update({
        ...text,
        destination_url: meta.destination_url,
        image_url: imageUrl,
        image_path: path,
        publication_status: "ready",
        error_message: null,
        prepared_at: new Date().toISOString(),
        ...(options.resetText ? { edited_at: null, edited_by: null } : {}),
      })
      .eq("id", pin.id)
      .in("publication_status", ["pending", "ready", "failed"])
      .select("*")
      .maybeSingle();
    if (error) throw dbError("Save Pinterest Pin", error);
    if (!data) return { outcome: "skipped", pin, message: "The Pin changed status while it was being prepared and was left unchanged." };

    if (oldPath && oldPath !== path) await deps.store.remove([oldPath]).catch(() => undefined);
    return { outcome: "prepared", pin: data as PinterestPost, message: "The Pinterest Pin is ready for review." };
  } catch (err) {
    const message = errorMessage(err);
    if (pin && !LOCKED.includes(pin.publication_status)) {
      const { data } = await db
        .from("pinterest_posts")
        .update({ publication_status: "failed", error_message: message, retry_count: pin.retry_count + 1 })
        .eq("id", pin.id)
        .in("publication_status", ["pending", "ready", "failed"])
        .select("*")
        .maybeSingle();
      pin = (data as PinterestPost | null) ?? pin;
    }
    return { outcome: "failed", pin, message };
  }
}

/** Prepares Pins for published recipes that do not have one yet, a few at a time. */
export async function prepareMissingPins(db: SupabaseClient, deps: PinPreparationDeps, limit = 10) {
  const missing = await listRecipesWithoutPins(db);
  const results: Array<{ recipeId: string; result: PreparePinResult }> = [];
  for (const recipeId of missing.slice(0, limit)) {
    results.push({ recipeId, result: await preparePin(db, recipeId, deps) });
  }
  return { results, remaining: Math.max(0, missing.length - limit) };
}

/** IDs of published recipes with no primary Pin. */
export async function listRecipesWithoutPins(db: SupabaseClient): Promise<string[]> {
  const [recipes, pins] = await Promise.all([
    db.from("recipes").select("id").eq("status", "published").order("published_at", { ascending: false }).limit(1000),
    db.from("pinterest_posts").select("recipe_id").eq("variant", "primary").limit(5000),
  ]);
  if (recipes.error) throw dbError("List published recipes", recipes.error);
  if (pins.error) throw dbError("List Pinterest Pins", pins.error);
  const have = new Set(((pins.data ?? []) as Array<{ recipe_id: string }>).map((p) => p.recipe_id));
  return ((recipes.data ?? []) as Array<{ id: string }>).map((r) => r.id).filter((id) => !have.has(id));
}

// ---------------------------------------------------------------------------
// Admin edits
// ---------------------------------------------------------------------------

export const pinContentSchema = z.object({
  pin_title: z.string().trim().min(1, "Add a Pin title.").max(PIN_TITLE_MAX, `Pinterest titles can be at most ${PIN_TITLE_MAX} characters.`),
  pin_description: z.string().trim().max(PIN_DESCRIPTION_MAX, `Pinterest descriptions can be at most ${PIN_DESCRIPTION_MAX} characters.`),
  keywords: z
    .array(z.string().trim().min(1).max(80, "Keep each keyword under 80 characters."))
    .max(PIN_KEYWORDS_MAX, `Use at most ${PIN_KEYWORDS_MAX} keywords.`),
  board_name: z.string().trim().min(1, "Add a board name.").max(180),
  image_text: z.string().trim().min(1, "Add the text shown on the image.").max(PIN_IMAGE_TEXT_MAX, `Keep the image text under ${PIN_IMAGE_TEXT_MAX} characters so it stays readable.`),
  image_alt: z.string().trim().max(PIN_ALT_MAX, `Alt text can be at most ${PIN_ALT_MAX} characters.`),
});

export type PinContentInput = z.infer<typeof pinContentSchema>;

/**
 * Saves an admin's changes to a Pin's text. Validates Pinterest's limits and
 * the site's claims rules (no "tested", no medical safety claims). Returns
 * whether the image text changed, in which case the image must be redrawn.
 */
export async function updatePinContent(db: SupabaseClient, pinId: string, input: unknown, userId: string | null): Promise<{ pin: PinterestPost; imageTextChanged: boolean }> {
  const parsed = pinContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError("invalid_input", "Please fix the highlighted fields.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  }
  const values = parsed.data;
  const claims = [
    ...analyzeClaimText("pin_title", values.pin_title),
    ...analyzeClaimText("pin_description", values.pin_description),
    ...analyzeClaimText("image_text", values.image_text),
  ];
  if (claims.length > 0) {
    throw new ServiceError("invalid_input", "The Pin text makes a claim the site does not allow.", claims.map((c) => ({ field: c.field, message: `"${c.phrase}": ${c.message}` })));
  }

  const { data: existing, error: loadError } = await db.from("pinterest_posts").select("*").eq("id", pinId).maybeSingle();
  if (loadError) throw dbError("Load Pinterest Pin", loadError);
  if (!existing) throw new ServiceError("not_found", "Pin not found.");
  const pin = existing as PinterestPost;
  if (LOCKED.includes(pin.publication_status)) throw new ServiceError("conflict", `This Pin is ${pin.publication_status} and can no longer be edited.`);
  const previousImageText = pin.image_text ?? "";

  const { data, error } = await db
    .from("pinterest_posts")
    .update({ ...values, image_alt: values.image_alt || null, edited_at: new Date().toISOString(), edited_by: userId })
    .eq("id", pinId)
    .in("publication_status", ["pending", "ready", "failed"])
    .select("*")
    .maybeSingle();
  if (error) throw dbError("Save Pinterest Pin", error);
  if (!data) throw new ServiceError("conflict", "This Pin changed status and can no longer be edited.");
  return { pin: data as PinterestPost, imageTextChanged: values.image_text !== previousImageText };
}

// ---------------------------------------------------------------------------
// Future Pinterest API integration (not active)
// ---------------------------------------------------------------------------

/**
 * The body of the official Pinterest API v5 "Create Pin" request
 * (POST https://api.pinterest.com/v5/pins). Built here so the mapping is
 * tested now; nothing sends it yet.
 */
export interface PinterestCreatePinRequest {
  board_id: string;
  title: string;
  description: string;
  link: string;
  alt_text?: string;
  media_source: { source_type: "image_url"; url: string };
}

export function toCreatePinRequest(pin: Pick<PinterestPost, "pin_title" | "pin_description" | "destination_url" | "image_url" | "image_alt" | "publication_status">, boardId: string): PinterestCreatePinRequest {
  if (pin.publication_status !== "ready") throw new ServiceError("not_ready", "Only Pins that are ready can be published.");
  if (!pin.image_url) throw new ServiceError("not_ready", "The Pin has no image.");
  if (!boardId) throw new ServiceError("invalid_input", "A Pinterest board id is required.");
  return {
    board_id: boardId,
    title: pin.pin_title,
    description: pin.pin_description,
    link: pin.destination_url,
    ...(pin.image_alt ? { alt_text: pin.image_alt } : {}),
    media_source: { source_type: "image_url", url: pin.image_url },
  };
}

/** What a real Pinterest integration must implement in a later phase. */
export interface PinterestPublisher {
  createPin(input: PinterestCreatePinRequest): Promise<{ id: string }>;
}

/**
 * Returns the Pinterest publisher. There deliberately is none yet: calling
 * this throws, so no code path can post to Pinterest until the official API
 * integration is built (OAuth tokens kept server-side) and explicitly turned on.
 */
export function getPinterestPublisher(): PinterestPublisher {
  throw new ServiceError("disabled", "Pinterest publishing is not enabled. It will be added in a later phase.");
}
