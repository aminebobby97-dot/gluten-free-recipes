// Keyword import. Search volume and difficulty are optional and are stored only
// when the import provides them from a named data source; nothing is estimated.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "./errors";

export interface KeywordImportRow {
  keyword: string;
  category_slug: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
  data_source: string | null;
  notes: string | null;
}

export interface KeywordParseResult {
  rows: KeywordImportRow[];
  errors: Array<{ line: number; message: string }>;
  duplicates: number;
}

const KNOWN_COLUMNS = ["keyword", "category", "search_volume", "keyword_difficulty", "data_source", "notes"] as const;

/** Splits one CSV line, honoring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Parses pasted CSV. Either a header row using the known column names, or one
 * keyword per line. Blank metric cells become null.
 */
export function parseKeywordCsv(text: string): KeywordParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.map((l, i) => ({ line: i + 1, text: l })).filter((l) => l.text && !l.text.startsWith("#"));
  const result: KeywordParseResult = { rows: [], errors: [], duplicates: 0 };
  if (nonEmpty.length === 0) return result;

  const firstCells = splitCsvLine(nonEmpty[0].text).map((c) => c.toLowerCase());
  const hasHeader = firstCells.includes("keyword");
  const columns = hasHeader ? firstCells : ["keyword"];
  const unknown = columns.filter((c) => !(KNOWN_COLUMNS as readonly string[]).includes(c));
  if (hasHeader && unknown.length) {
    result.errors.push({ line: nonEmpty[0].line, message: `Unknown column(s): ${unknown.join(", ")}` });
  }

  const seen = new Set<string>();
  for (const { line, text: raw } of hasHeader ? nonEmpty.slice(1) : nonEmpty) {
    const cells = hasHeader ? splitCsvLine(raw) : [raw];
    const get = (name: string) => {
      const idx = columns.indexOf(name);
      const v = idx >= 0 ? cells[idx]?.trim() : "";
      return v ? v : null;
    };

    const keyword = get("keyword");
    if (!keyword || keyword.length < 2 || keyword.length > 200) {
      result.errors.push({ line, message: "Keyword must be 2 to 200 characters." });
      continue;
    }

    const volumeRaw = get("search_volume");
    const difficultyRaw = get("keyword_difficulty");
    const volume = volumeRaw == null ? null : Number(volumeRaw.replace(/,/g, ""));
    const difficulty = difficultyRaw == null ? null : Number(difficultyRaw);
    if (volume != null && (!Number.isInteger(volume) || volume < 0)) {
      result.errors.push({ line, message: `search_volume "${volumeRaw}" must be a whole number or blank.` });
      continue;
    }
    if (difficulty != null && (Number.isNaN(difficulty) || difficulty < 0 || difficulty > 100)) {
      result.errors.push({ line, message: `keyword_difficulty "${difficultyRaw}" must be 0 to 100 or blank.` });
      continue;
    }
    const dataSource = get("data_source");
    if ((volume != null || difficulty != null) && !dataSource) {
      result.errors.push({ line, message: "Rows with search_volume or keyword_difficulty need a data_source." });
      continue;
    }

    const normalized = normalizeKeyword(keyword);
    if (seen.has(normalized)) {
      result.duplicates++;
      continue;
    }
    seen.add(normalized);
    result.rows.push({
      keyword: keyword.replace(/\s+/g, " "),
      category_slug: get("category"),
      search_volume: volume,
      keyword_difficulty: difficulty,
      data_source: dataSource,
      notes: get("notes"),
    });
  }
  return result;
}

/** Inserts keywords, skipping any that already exist. Returns how many were added. */
export async function importKeywords(
  db: SupabaseClient,
  rows: KeywordImportRow[],
  categories: Array<{ id: string; slug: string }>,
): Promise<{ inserted: number; unknownCategories: string[] }> {
  if (rows.length === 0) return { inserted: 0, unknownCategories: [] };
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const unknownCategories = new Set<string>();

  const payload = rows.map((r) => {
    const categoryId = r.category_slug ? bySlug.get(r.category_slug) ?? null : null;
    if (r.category_slug && !categoryId) unknownCategories.add(r.category_slug);
    return {
      keyword: r.keyword,
      category_id: categoryId,
      search_volume: r.search_volume,
      keyword_difficulty: r.keyword_difficulty,
      data_source: r.data_source,
      notes: r.notes,
    };
  });

  const { data, error } = await db
    .from("keywords")
    .upsert(payload, { onConflict: "normalized_keyword", ignoreDuplicates: true })
    .select("id");
  if (error) throw dbError("Import keywords", error);
  return { inserted: data?.length ?? 0, unknownCategories: [...unknownCategories] };
}
