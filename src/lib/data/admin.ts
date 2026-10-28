// Admin dashboard queries. Always called with the signed-in admin's session
// client, so Row Level Security applies. Never cached.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, RecipeStatus } from "@/lib/recipes/types";
import { dbError } from "@/lib/services/errors";

export interface AdminRecipeRow {
  id: string;
  title: string;
  slug: string;
  status: RecipeStatus;
  is_tested: boolean;
  featured_image: string | null;
  updated_at: string;
  published_at: string | null;
  category: { short_name: string } | null;
}

export const RECIPE_STATUSES: RecipeStatus[] = ["draft", "in_review", "published", "archived"];

export async function listRecipes(db: SupabaseClient, status?: RecipeStatus): Promise<AdminRecipeRow[]> {
  let query = db
    .from("recipes")
    .select("id,title,slug,status,is_tested,featured_image,updated_at,published_at,category:categories(short_name)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw dbError("List recipes", error);
  return (data ?? []) as unknown as AdminRecipeRow[];
}

async function count(db: SupabaseClient, table: string, filter?: [string, string]): Promise<number> {
  let query = db.from(table).select("id", { count: "exact", head: true });
  if (filter) query = query.eq(filter[0], filter[1]);
  const { count: c, error } = await query;
  if (error) throw dbError(`Count ${table}`, error);
  return c ?? 0;
}

export async function getDashboardStats(db: SupabaseClient) {
  const [published, draft, inReview, keywordsNew, keywordsTotal, jobsFailed, pins] = await Promise.all([
    count(db, "recipes", ["status", "published"]),
    count(db, "recipes", ["status", "draft"]),
    count(db, "recipes", ["status", "in_review"]),
    count(db, "keywords", ["status", "new"]),
    count(db, "keywords"),
    count(db, "publishing_jobs", ["status", "failed"]),
    countPinsByStatus(db),
  ]);
  return { published, draft, inReview, keywordsNew, keywordsTotal, jobsFailed, pinsFailed: pins.failed, pinsReady: pins.ready };
}

export async function listCategories(db: SupabaseClient): Promise<Category[]> {
  const { data, error } = await db.from("categories").select("*").order("sort_order");
  if (error) throw dbError("List categories", error);
  return (data ?? []) as Category[];
}

export interface AdminKeywordRow {
  id: string;
  keyword: string;
  status: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
  data_source: string | null;
  created_at: string;
  category: { short_name: string } | null;
  recipe: { title: string; id: string } | null;
}

export async function listKeywords(db: SupabaseClient, status?: string): Promise<AdminKeywordRow[]> {
  let query = db
    .from("keywords")
    .select("id,keyword,status,search_volume,keyword_difficulty,data_source,created_at,category:categories(short_name),recipe:recipes(id,title)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw dbError("List keywords", error);
  return (data ?? []) as unknown as AdminKeywordRow[];
}

export interface AdminJobRow {
  id: string;
  job_type: string;
  job_date: string;
  status: string;
  current_step: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
  recipe: { id: string; title: string } | null;
  keyword: { keyword: string } | null;
}

export async function listJobs(db: SupabaseClient, onlyFailed = false): Promise<AdminJobRow[]> {
  let query = db
    .from("publishing_jobs")
    .select("id,job_type,job_date,status,current_step,error_message,retry_count,created_at,completed_at,recipe:recipes(id,title),keyword:keywords(keyword)")
    .order("job_date", { ascending: false })
    .limit(200);
  if (onlyFailed) query = query.eq("status", "failed");
  const { data, error } = await query;
  if (error) throw dbError("List publishing jobs", error);
  return (data ?? []) as unknown as AdminJobRow[];
}

export interface AdminPinRow {
  id: string;
  pin_title: string;
  pin_description: string;
  keywords: string[];
  board_name: string;
  image_text: string | null;
  destination_url: string;
  image_url: string | null;
  publication_status: string;
  pinterest_pin_id: string | null;
  error_message: string | null;
  retry_count: number;
  prepared_at: string | null;
  edited_at: string | null;
  published_at: string | null;
  created_at: string;
  recipe: { id: string; title: string; slug: string; status: RecipeStatus } | null;
}

export const PIN_STATUSES = ["ready", "pending", "failed", "published"] as const;

/** Codes for a column, table or enum value that does not exist yet (the Pinterest migration is not applied). */
const NOT_MIGRATED = new Set(["PGRST204", "PGRST205", "42P01", "42703", "22P02"]);

function notMigrated(error: { code?: string } | null): boolean {
  return Boolean(error?.code && NOT_MIGRATED.has(error.code));
}

const PIN_COLUMNS =
  "id,pin_title,pin_description,keywords,board_name,image_text,destination_url,image_url,publication_status,pinterest_pin_id,error_message,retry_count,prepared_at,edited_at,published_at,created_at,recipe:recipes(id,title,slug,status)";

/** Pins, newest first. Returns null until the Pinterest migration is applied. */
export async function listPins(db: SupabaseClient, status?: string): Promise<AdminPinRow[] | null> {
  let query = db.from("pinterest_posts").select(PIN_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("publication_status", status);
  const { data, error } = await query;
  if (notMigrated(error)) return null;
  if (error) throw dbError("List Pinterest Pins", error);
  return (data ?? []) as unknown as AdminPinRow[];
}

export interface AdminPinDetail extends AdminPinRow {
  image_alt: string | null;
  image_path: string | null;
  board_id: string | null;
  recipe: { id: string; title: string; slug: string; status: RecipeStatus; featured_image: string | null; pinterest_image: string | null } | null;
}

export async function getPin(db: SupabaseClient, id: string): Promise<AdminPinDetail | null> {
  const { data, error } = await db
    .from("pinterest_posts")
    .select(`${PIN_COLUMNS.replace(/,recipe:.*$/, "")},image_alt,image_path,board_id,recipe:recipes(id,title,slug,status,featured_image,pinterest_image)`)
    .eq("id", id)
    .maybeSingle();
  if (notMigrated(error)) return null;
  if (error) throw dbError("Load Pinterest Pin", error);
  return (data as unknown as AdminPinDetail | null) ?? null;
}

/** Pin counts by status, all zero until the Pinterest migration is applied. */
export async function countPinsByStatus(db: SupabaseClient): Promise<Record<(typeof PIN_STATUSES)[number], number>> {
  const counts = await Promise.all(
    PIN_STATUSES.map(async (status) => {
      const { count: c, error } = await db.from("pinterest_posts").select("id", { count: "exact", head: true }).eq("publication_status", status);
      if (notMigrated(error)) return 0;
      if (error) throw dbError("Count Pinterest Pins", error);
      return c ?? 0;
    }),
  );
  return Object.fromEntries(PIN_STATUSES.map((s, i) => [s, counts[i]])) as Record<(typeof PIN_STATUSES)[number], number>;
}
