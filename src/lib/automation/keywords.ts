// Keyword choice helpers that mirror the database functions in the Phase 2
// migration (keyword_core, opportunity_score), so the admin can preview how a
// keyword will be ranked and whether it competes with an existing article.

const FILLER = new Set(
  "gluten free gf celiac recipe recipes easy best simple quick homemade ultimate perfect the a an and with how to make for".split(" "),
);

/** What a keyword is about: "Easy Gluten-Free Zucchini Bread Recipe" -> "zucchini bread". */
export function keywordCore(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
}

/**
 * Search demand per unit of difficulty. Null when the volume is unknown.
 * Unknown difficulty counts as 50 so it never outranks a known easy keyword.
 */
export function opportunityScore(searchVolume: number | null, keywordDifficulty: number | null): number | null {
  if (searchVolume == null) return null;
  return Math.round((searchVolume / (10 + (keywordDifficulty ?? 50))) * 1000) / 1000;
}

function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.split(" ").filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Trigram similarity of the keyword cores, matching Postgres pg_trgm similarity(). */
export function keywordSimilarity(a: string, b: string): number {
  const ta = trigrams(keywordCore(a));
  const tb = trigrams(keywordCore(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
