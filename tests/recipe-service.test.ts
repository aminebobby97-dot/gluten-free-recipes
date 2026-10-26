import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./support/fake-db";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

const { publishRecipe, unpublishRecipe, updateRecipe, deleteRecipe, createRecipeDraft } = await import("@/lib/services/recipes");
const { ServiceError } = await import("@/lib/services/errors");

const complete = {
  id: "r1",
  title: "Rice Bowl",
  slug: "rice-bowl",
  description: "A simple gluten-free rice bowl.",
  introduction: "i".repeat(200),
  category_id: "00000000-0000-4000-8000-000000000001",
  ingredients: [{ amount: "1", unit: "cup", name: "rice" }],
  instructions: [{ text: "Cook the rice." }],
  prep_time: 5,
  cook_time: 20,
  servings: 2,
  yield_description: null,
  nutrition: null,
  tips: [],
  substitutions: [],
  storage_instructions: "Refrigerate.",
  faq: [],
  featured_image: "https://example.test/rice.jpg",
  featured_image_alt: "Rice bowl",
  pinterest_image: null,
  pinterest_image_alt: null,
  seo_title: null,
  seo_description: null,
  focus_keyword: null,
  is_tested: false,
  status: "draft",
  published_at: null,
};

beforeEach(() => revalidateTag.mockClear());

describe("publishRecipe", () => {
  it("publishes a complete draft and refreshes public caches", async () => {
    const { db, data } = createFakeDb({ recipes: [complete] });
    await publishRecipe(db, "r1");
    expect(data.recipes[0].status).toBe("published");
    expect(data.recipes[0].published_at).toEqual(expect.any(String));
    expect(revalidateTag).toHaveBeenCalledWith("recipes", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("recipe:rice-bowl", { expire: 0 });
  });

  it("refuses incomplete recipes and explains why", async () => {
    const { db, data } = createFakeDb({ recipes: [{ ...complete, featured_image: null }] });
    const error = await publishRecipe(db, "r1").catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe("not_ready");
    expect(error.issues.map((i: { field: string }) => i.field)).toContain("featured_image");
    expect(data.recipes[0].status).toBe("draft");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses recipes with gluten ingredients", async () => {
    const { db } = createFakeDb({ recipes: [{ ...complete, ingredients: [{ amount: "2", unit: "cups", name: "all-purpose flour" }] }] });
    await expect(publishRecipe(db, "r1")).rejects.toMatchObject({ code: "not_ready" });
  });

  it("is idempotent and keeps the original publish date", async () => {
    const { db, data, calls } = createFakeDb({ recipes: [{ ...complete, status: "published", published_at: "2026-01-01T00:00:00.000Z" }] });
    await publishRecipe(db, "r1");
    expect(data.recipes[0].published_at).toBe("2026-01-01T00:00:00.000Z");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});

describe("other recipe operations", () => {
  it("creates new recipes as drafts even if a status is supplied", async () => {
    const { db, data } = createFakeDb({ recipes: [] });
    const { id: _id, status: _s, published_at: _p, ...input } = complete;
    await createRecipeDraft(db, { ...input, status: "published" });
    expect(data.recipes[0].status).toBe("draft");
  });

  it("rejects an update that would break a live recipe", async () => {
    const { db } = createFakeDb({ recipes: [{ ...complete, status: "published", published_at: "2026-01-01T00:00:00Z" }] });
    const { id: _id, status: _s, published_at: _p, ...input } = complete;
    await expect(updateRecipe(db, "r1", { ...input, instructions: [] })).rejects.toMatchObject({ code: "not_ready" });
  });

  it("unpublishes and refuses to delete live recipes", async () => {
    const { db, data } = createFakeDb({ recipes: [{ ...complete, status: "published", published_at: "2026-01-01T00:00:00Z" }] });
    await expect(deleteRecipe(db, "r1")).rejects.toMatchObject({ code: "conflict" });
    await unpublishRecipe(db, "r1");
    expect(data.recipes[0].status).toBe("draft");
    await deleteRecipe(db, "r1");
    expect(data.recipes).toHaveLength(0);
  });
});
