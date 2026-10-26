import { describe, expect, it } from "vitest";
import { parseKeywordCsv, splitCsvLine } from "@/lib/services/keywords";

describe("parseKeywordCsv", () => {
  it("accepts one keyword per line with unknown metrics left null", () => {
    const r = parseKeywordCsv("gluten free waffles\n\ngluten free pizza dough\n");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      expect.objectContaining({ keyword: "gluten free waffles", search_volume: null, keyword_difficulty: null }),
      expect.objectContaining({ keyword: "gluten free pizza dough", search_volume: null, keyword_difficulty: null }),
    ]);
  });

  it("parses CSV with headers and real metrics", () => {
    const r = parseKeywordCsv("keyword,category,search_volume,keyword_difficulty,data_source\n\"gluten free waffles, crispy\",gluten-free-breakfast,\"1,300\",22.5,Ahrefs export 2026-10");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({
      keyword: "gluten free waffles, crispy",
      category_slug: "gluten-free-breakfast",
      search_volume: 1300,
      keyword_difficulty: 22.5,
      data_source: "Ahrefs export 2026-10",
      notes: null,
    });
  });

  it("refuses metrics without a data source", () => {
    const r = parseKeywordCsv("keyword,search_volume\ngluten free bagels,900");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/data_source/);
  });

  it("rejects invalid metrics", () => {
    const r = parseKeywordCsv("keyword,keyword_difficulty,data_source\nx gf,150,Semrush");
    expect(r.errors[0].message).toMatch(/0 to 100/);
  });

  it("de-duplicates keywords case- and whitespace-insensitively", () => {
    const r = parseKeywordCsv("Gluten Free Waffles\ngluten   free waffles");
    expect(r.rows).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it("splits quoted CSV fields", () => {
    expect(splitCsvLine('a,"b, c","d ""e"""')).toEqual(["a", "b, c", 'd "e"']);
  });
});
