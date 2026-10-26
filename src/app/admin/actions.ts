"use server";

// Server Actions for the admin dashboard. Every action re-checks that the
// caller is an admin; the database enforces the same rule through RLS.

import { redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { recipeFromForm, text, nullableText, intOrNull } from "@/lib/admin/form";
import { categoryInputSchema } from "@/lib/recipes/schema";
import type { ReadinessIssue } from "@/lib/recipes/validation";
import { isSupabaseConfigured } from "@/lib/env";
import { createSessionClient } from "@/lib/supabase/server";
import { ServiceError, dbError } from "@/lib/services/errors";
import { importKeywords, parseKeywordCsv } from "@/lib/services/keywords";
import { createRecipeDraft, deleteRecipe, publishRecipe, unpublishRecipe, updateRecipe } from "@/lib/services/recipes";
import { revalidateCategories } from "@/lib/services/revalidate";

export interface ActionState {
  ok: boolean;
  message: string;
  issues?: ReadinessIssue[];
}

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { ok: false, message: error.message, issues: error.issues };
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
  try {
    await publishRecipe(supabase, text(form, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Recipe published. It is now live and in the sitemap." };
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
});

export async function saveAutomationSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user } = await requireAdmin();
  const parsed = automationSettingsSchema.safeParse({
    enabled: form.get("enabled") === "on",
    publish_mode: text(form, "publish_mode"),
    daily_budget_usd: Number(text(form, "daily_budget_usd")),
    max_keyword_difficulty: Number(text(form, "max_keyword_difficulty")),
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
