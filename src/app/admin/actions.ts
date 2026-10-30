"use server";

// Server Actions for the admin dashboard. Every action re-checks that the
// caller is an admin; the database enforces the same rule through RLS.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { recipeFromForm, text, nullableText, intOrNull } from "@/lib/admin/form";
import { categoryInputSchema } from "@/lib/recipes/schema";
import type { ReadinessIssue } from "@/lib/recipes/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, siteConfig } from "@/lib/env";
import { createSessionClient } from "@/lib/supabase/server";
import { ServiceError, dbError } from "@/lib/services/errors";
import { importKeywords, parseKeywordCsv } from "@/lib/services/keywords";
import { createPinImageStore, prepareMissingPins, preparePin, updatePinContent, type PinPreparationDeps } from "@/lib/services/pinterest";
import { PinterestApiError, buildAuthorizeUrl } from "@/lib/services/pinterest-api";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  PINTEREST_CALLBACK_PATH,
  createOAuthState,
  createPinterestDeps,
  checkPublishingPin,
  disconnectPinterest,
  getPinterestConfig,
  publishPin,
  refreshPinterestConnection,
  selectPinterestBoard,
} from "@/lib/services/pinterest-connection";
import { createRecipeDraft, deleteRecipe, publishRecipe, unpublishRecipe, updateRecipe } from "@/lib/services/recipes";
import { revalidateCategories } from "@/lib/services/revalidate";

export interface ActionState {
  ok: boolean;
  message: string;
  issues?: ReadinessIssue[];
}

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { ok: false, message: error.message, issues: error.issues };
  if (error instanceof PinterestApiError) return { ok: false, message: error.message };
  console.error(error);
  return { ok: false, message: "Something went wrong. Check the server logs for details." };
}

function safeNextPath(value: string): string {
  return value.startsWith("/admin") && !value.startsWith("//") ? value : "/admin";
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export async function signInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Supabase is not configured yet. See the setup guide." };
  const email = text(form, "email");
  const password = text(form, "password");
  if (!email || !password) return { ok: false, message: "Enter your email and password." };

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: "Those credentials did not work." };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    return { ok: false, message: "This account does not have admin access." };
  }
  redirect(safeNextPath(text(form, "next")));
}

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createSessionClient();
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export async function saveRecipeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  let savedId: string;
  try {
    const input = recipeFromForm(form);
    const recipe = id ? await updateRecipe(supabase, id, input) : await createRecipeDraft(supabase, input);
    savedId = recipe.id;
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin", "layout");
  if (!id) redirect(`/admin/recipes/${savedId}?created=1`);
  return { ok: true, message: "Recipe saved." };
}

export async function publishRecipeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  try {
    await publishRecipe(supabase, id);
  } catch (error) {
    return failure(error);
  }
  // Prepare the recipe's Pinterest Pin for review. Never posted, never fatal:
  // the recipe is already live whatever happens here.
  const pin = await preparePin(supabase, id, pinDeps(supabase)).catch((err: unknown) => ({ outcome: "failed" as const, message: String(err) }));
  revalidatePath("/admin", "layout");
  const pinNote =
    pin.outcome === "prepared"
      ? " Its Pinterest Pin is ready for review under Pinterest."
      : pin.outcome === "failed"
        ? ` Its Pinterest Pin could not be prepared (${pin.message}). You can retry it under Pinterest.`
        : "";
  return { ok: true, message: `Recipe published. It is now live and in the sitemap.${pinNote}` };
}

export async function unpublishRecipeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  try {
    await unpublishRecipe(supabase, text(form, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Recipe unpublished. It is no longer public." };
}

export async function deleteRecipeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  if (text(form, "confirm") !== "delete") return { ok: false, message: 'Type "delete" to confirm.' };
  try {
    await deleteRecipe(supabase, text(form, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/recipes?deleted=1");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const parsed = categoryInputSchema.safeParse({
    name: text(form, "name"),
    short_name: text(form, "short_name"),
    slug: text(form, "slug"),
    description: text(form, "description"),
    introduction: text(form, "introduction"),
    seo_title: nullableText(form, "seo_title"),
    seo_description: nullableText(form, "seo_description"),
    image_url: nullableText(form, "image_url"),
    image_alt: nullableText(form, "image_alt"),
    sort_order: intOrNull(form, "sort_order") ?? 0,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    };
  }
  const id = text(form, "id");
  const query = id
    ? supabase.from("categories").update(parsed.data).eq("id", id)
    : supabase.from("categories").insert(parsed.data);
  const { error } = await query;
  if (error) return failure(dbError("Save category", error));
  revalidateCategories();
  revalidatePath("/admin/categories");
  return { ok: true, message: id ? "Category saved." : "Category created." };
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export async function importKeywordsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  let csv = text(form, "csv");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { ok: false, message: "CSV files must be under 1 MB." };
    csv = await file.text();
  }
  if (!csv) return { ok: false, message: "Paste keywords or choose a CSV file." };

  const parsed = parseKeywordCsv(csv);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      message: `Nothing was imported. Fix ${parsed.errors.length} problem(s) and try again.`,
      issues: parsed.errors.map((e) => ({ field: `line ${e.line}`, message: e.message })),
    };
  }

  const { data: categories, error } = await supabase.from("categories").select("id,slug");
  if (error) return failure(dbError("Load categories", error));
  try {
    const result = await importKeywords(supabase, parsed.rows, categories ?? []);
    revalidatePath("/admin/keywords");
    const skipped = parsed.rows.length - result.inserted + parsed.duplicates;
    const notes = [
      `${result.inserted} keyword(s) imported`,
      skipped > 0 ? `${skipped} duplicate(s) skipped` : "",
      result.unknownCategories.length ? `unknown categories left blank: ${result.unknownCategories.join(", ")}` : "",
    ].filter(Boolean);
    return { ok: true, message: `${notes.join("; ")}.` };
  } catch (err) {
    return failure(err);
  }
}

export async function updateKeywordStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const status = text(form, "status");
  if (!["new", "rejected"].includes(status)) return { ok: false, message: "Invalid status." };
  const { error } = await supabase.from("keywords").update({ status }).eq("id", text(form, "id"));
  if (error) return failure(dbError("Update keyword", error));
  revalidatePath("/admin/keywords");
  return { ok: true, message: "Keyword updated." };
}

// ---------------------------------------------------------------------------
// Automation settings
// ---------------------------------------------------------------------------

const automationSettingsSchema = z.object({
  enabled: z.boolean(),
  publish_mode: z.enum(["review", "auto"]),
  daily_budget_usd: z.number().min(0.5, "The daily budget must be at least $0.50.").max(100, "The daily budget can be at most $100."),
  max_keyword_difficulty: z.number().min(0).max(100, "Keyword difficulty is between 0 and 100."),
  pinterest_enabled: z.boolean(),
});

export async function saveAutomationSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user } = await requireAdmin();
  const parsed = automationSettingsSchema.safeParse({
    enabled: form.get("enabled") === "on",
    publish_mode: text(form, "publish_mode"),
    daily_budget_usd: Number(text(form, "daily_budget_usd")),
    max_keyword_difficulty: Number(text(form, "max_keyword_difficulty")),
    pinterest_enabled: form.get("pinterest_enabled") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted settings.", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) };
  }
  const { error } = await supabase
    .from("automation_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", true);
  if (error) return failure(dbError("Save automation settings", error));
  revalidatePath("/admin/automation");
  return { ok: true, message: "Automation settings saved." };
}

// ---------------------------------------------------------------------------
// Pinterest Pins: prepared and reviewed here (posting is below)
// ---------------------------------------------------------------------------

function pinDeps(supabase: SupabaseClient): PinPreparationDeps {
  return { siteUrl: siteConfig.url, store: createPinImageStore(supabase) };
}

function pinFromForm(form: FormData) {
  return {
    pin_title: text(form, "pin_title"),
    pin_description: text(form, "pin_description"),
    keywords: text(form, "keywords")
      .split(/[,\n]/)
      .map((k) => k.trim())
      .filter(Boolean),
    board_name: text(form, "board_name"),
    image_text: text(form, "image_text"),
    image_alt: text(form, "image_alt"),
  };
}

export async function savePinAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user } = await requireAdmin();
  let recipeId: string;
  try {
    const { pin } = await updatePinContent(supabase, text(form, "id"), pinFromForm(form), user.id);
    recipeId = pin.recipe_id;
  } catch (error) {
    return failure(error);
  }
  // Redraws the image only if the image text changed (or the Pin had failed).
  const result = await preparePin(supabase, recipeId, pinDeps(supabase));
  revalidatePath("/admin/pinterest", "layout");
  if (result.outcome === "failed") return { ok: false, message: `Your text was saved, but the Pin image could not be updated: ${result.message}` };
  return { ok: true, message: result.outcome === "prepared" ? "Pin saved and its image updated." : "Pin saved." };
}

export async function preparePinAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const mode = text(form, "mode");
  const result = await preparePin(supabase, text(form, "recipe_id"), pinDeps(supabase), {
    force: mode === "redraw",
    resetText: mode === "reset",
  });
  revalidatePath("/admin/pinterest", "layout");
  if (result.outcome === "failed") return { ok: false, message: result.message };
  return { ok: true, message: result.message };
}

export async function prepareMissingPinsAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  try {
    const { results, remaining } = await prepareMissingPins(supabase, pinDeps(supabase), 10);
    revalidatePath("/admin/pinterest", "layout");
    if (results.length === 0) return { ok: true, message: "Every published recipe already has a Pin." };
    const failed = results.filter((r) => r.result.outcome === "failed").length;
    const notes = [
      `${results.length - failed} Pin(s) prepared`,
      failed ? `${failed} failed (see the error on each Pin)` : "",
      remaining ? `${remaining} more to go: click again to continue` : "",
    ].filter(Boolean);
    return { ok: failed === 0, message: `${notes.join("; ")}.` };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Pinterest account connection (OAuth) and publishing one Pin by hand
// ---------------------------------------------------------------------------

export async function connectPinterestAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { user } = await requireAdmin();
  const config = getPinterestConfig();
  if (!config.ok) return { ok: false, message: `Pinterest is not set up on the server yet. ${config.problems.join(" ")} See docs/PINTEREST.md.` };
  const target = new URL(config.config.app.redirectUri);
  // The state cookie only exists on the address the admin is using, and
  // Pinterest sends the admin back to the registered redirect address.
  const host = (await headers()).get("host");
  if (host && host !== target.host) {
    return { ok: false, message: `Open ${target.origin}/admin/pinterest and click Connect Pinterest there. Pinterest returns you to ${target.host}, so the connection has to start on that address.` };
  }
  const { state, cookie } = createOAuthState(config.config.stateKey, user.id);
  (await cookies()).set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: target.protocol === "https:",
    sameSite: "lax",
    path: PINTEREST_CALLBACK_PATH,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  redirect(buildAuthorizeUrl(config.config.app, state));
}

export async function refreshPinterestAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  try {
    const connection = await refreshPinterestConnection(supabase, createPinterestDeps());
    revalidatePath("/admin/pinterest", "layout");
    return { ok: true, message: `Sign-in refreshed. ${connection.boards.length} board(s) found.` };
  } catch (error) {
    revalidatePath("/admin/pinterest", "layout");
    return failure(error);
  }
}

export async function selectPinterestBoardAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  try {
    const board = await selectPinterestBoard(supabase, text(form, "board_id"));
    revalidatePath("/admin/pinterest", "layout");
    return { ok: true, message: `Pins will be published to “${board.name}”.` };
  } catch (error) {
    return failure(error);
  }
}

export async function disconnectPinterestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  if (text(form, "confirm") !== "yes") return { ok: false, message: "Tick the box to confirm." };
  try {
    await disconnectPinterest(supabase);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin/pinterest", "layout");
  return { ok: true, message: "Pinterest disconnected and the saved sign-in deleted. You can also remove the app under Pinterest settings, Security and logins (Apps)." };
}

/** Publishes exactly one Ready Pin, after the admin confirms. */
export async function publishPinAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user } = await requireAdmin();
  if (text(form, "confirm") !== "yes") return { ok: false, message: "Tick the box to confirm you want to post this Pin to Pinterest." };
  try {
    const result = await publishPin(supabase, text(form, "id"), user.id, { aiModified: text(form, "ai_modified") === "yes" }, createPinterestDeps());
    revalidatePath("/admin/pinterest", "layout");
    return { ok: true, message: `Published to “${result.boardName}” on Pinterest (Pin id ${result.pinterestPinId}).` };
  } catch (error) {
    revalidatePath("/admin/pinterest", "layout");
    return failure(error);
  }
}

/**
 * Settles a Pin whose last publish answer never arrived: finds it on the
 * board (saved as published) or, once Pinterest has had time to show it,
 * puts it back to Ready.
 */
export async function checkPinAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  try {
    const result = await checkPublishingPin(supabase, text(form, "id"), createPinterestDeps());
    revalidatePath("/admin/pinterest", "layout");
    return { ok: result.outcome !== "wait", message: result.message };
  } catch (error) {
    revalidatePath("/admin/pinterest", "layout");
    return failure(error);
  }
}
