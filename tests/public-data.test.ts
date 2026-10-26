import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Records every filter applied by the public queries.
const filters: Array<[string, string, unknown]> = [];
function fakeQuery(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "range", "neq", "not", "gt"]) q[m] = () => q;
  q.eq = (col: string, val: unknown) => (filters.push(["eq", col, val]), q);
  q.maybeSingle = async () => ({ data: null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null, count: 0 });
  return q;
}
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({ from: () => fakeQuery([{ slug: "published-one", updated_at: "2026-10-01", published_at: "2026-10-01", featured_image: null }]) }),
}));

const data = await import("@/lib/data/public");
const { buildSitemap } = await import("@/lib/seo/sitemap");

describe("public queries", () => {
  it("only ever request published recipes", async () => {
    filters.length = 0;
    await data.getLatestRecipes();
    await data.getPublishedRecipes(1);
    await data.getRecipeBySlug("anything");
    await data.getPublishedRecipeIndex();
    await data.getRelatedRecipes("r1", "c1");
    const statusFilters = filters.filter(([, col]) => col === "status");
    expect(statusFilters.length).toBeGreaterThanOrEqual(5);
    expect(statusFilters.every(([, , val]) => val === "published")).toBe(true);
  });
});

describe("sitemap", () => {
  it("lists static pages, categories and published recipes only", async () => {
    const recipes = await data.getPublishedRecipeIndex();
    const map = buildSitemap({ recipes, categorySlugs: ["gluten-free-breakfast"], toUrl: (p) => `https://x.test${p}` });
    const urls = map.map((e) => e.url);
    expect(urls).toContain("https://x.test/recipes/published-one");
    expect(urls).toContain("https://x.test/categories/gluten-free-breakfast");
    expect(urls).not.toContain("https://x.test/admin");
    expect(urls.filter((u) => u.includes("/recipes/"))).toHaveLength(1);
  });
});
