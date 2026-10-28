import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { pinterestSaveUrl } from "@/lib/pinterest";
import { PIN_HEIGHT, PIN_WIDTH, renderPinImage } from "@/lib/pins/image";
import { buildPinArtwork, buildPinDescription, buildPinKeywords, buildPinMetadata, buildPinTitle, recipeUrl, type PinRecipe } from "@/lib/pins/metadata";
import { listRecipesWithoutPins, preparePin, toCreatePinRequest, updatePinContent, type PinImageStore, type PinterestPost } from "@/lib/services/pinterest";
import { createFakeDb } from "./support/fake-db";

const SITE = "https://www.glutenfreerecipehub.com";

const recipe: PinRecipe & { status: string } = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "gluten-free-banana-bread",
  title: "Gluten-Free Banana Bread",
  description: "A moist, tender loaf made with ripe bananas and a measure-for-measure gluten-free flour blend.",
  focus_keyword: "gluten free banana bread",
  prep_time: 15,
  cook_time: 55,
  servings: 10,
  yield_description: "1 loaf",
  featured_image: "https://project.supabase.co/storage/v1/object/public/recipe-images/recipes/banana.webp",
  featured_image_alt: "Sliced banana bread on a wooden board",
  pinterest_image: null,
  pinterest_image_alt: null,
  category: { name: "Gluten-Free Baking", short_name: "Baking" },
  status: "published",
};

describe("Pin text", () => {
  it("keeps the title within 100 characters and only adds what is true", () => {
    expect(buildPinTitle(recipe)).toBe("Gluten-Free Banana Bread");
    expect(buildPinTitle({ title: "Lemon Bars", prep_time: 10, cook_time: 20 })).toBe("Lemon Bars (Gluten-Free, Ready in 30 Minutes)");
    expect(buildPinTitle({ title: "Chicken Stir-Fry", prep_time: null, cook_time: null })).toBe("Chicken Stir-Fry (Gluten-Free)");
    const long = buildPinTitle({ title: "x".repeat(150), prep_time: 5, cook_time: 5 });
    expect(long.length).toBeLessThanOrEqual(100);
  });

  it("writes a natural description under 500 characters with the keyword once and no testing claims", () => {
    const d = buildPinDescription(recipe);
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d).toContain("Ready in 1 hour 10 minutes and serves 10.");
    expect(d.toLowerCase().match(/gluten free banana bread/g)).toHaveLength(1);
    expect(d).not.toMatch(/tested/i);
    expect(d).toContain("Gluten Free Recipe Hub");

    const long = buildPinDescription({ ...recipe, description: "This is a sentence about bread. ".repeat(40) });
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long).toMatch(/Save this gluten free banana bread recipe/);
  });

  it("does not repeat the keyword when the description already uses it", () => {
    const d = buildPinDescription({ ...recipe, description: "The best gluten free banana bread for weekend baking." });
    expect(d).toContain("Save this recipe for later");
    expect(d.toLowerCase().match(/gluten free banana bread/g)).toHaveLength(1);
  });

  it("collects a few distinct keywords", () => {
    expect(buildPinKeywords(recipe)).toEqual(["gluten free banana bread", "gluten-free baking", "gluten-free recipes"]);
    expect(buildPinKeywords({ focus_keyword: null, category: null })).toEqual(["gluten-free recipes"]);
  });

  it("links to the recipe on the https site and targets the Gluten-Free Recipes board", () => {
    const meta = buildPinMetadata(recipe, `${SITE}/`);
    expect(meta.destination_url).toBe(`${SITE}/recipes/gluten-free-banana-bread`);
    expect(meta.board_name).toBe("Gluten-Free Recipes");
    expect(meta.image_text).toBe(recipe.title);
    expect(meta.image_alt).toContain("Sliced banana bread on a wooden board");
    expect(() => recipeUrl("http://localhost:3000", "x")).toThrow(/https/);
  });

  it("describes the image with the category, time and servings", () => {
    expect(buildPinArtwork(recipe, "Banana Bread")).toEqual({ title: "Banana Bread", eyebrow: "Gluten-free · Baking", detail: "Ready in 1 hr 10 mins · Serves 10", brand: "Gluten Free Recipe Hub" });
  });
});

describe("renderPinImage", () => {
  it("draws a 1000 x 1500 JPEG from the recipe photo", async () => {
    const photo = await sharp({ create: { width: 1600, height: 1067, channels: 3, background: "#c98a4b" } }).jpeg().toBuffer();
    const out = await renderPinImage(photo, buildPinArtwork(recipe, recipe.title));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([PIN_WIDTH, PIN_HEIGHT, "jpeg"]);
  }, 30_000);
});

function setup(overrides: { recipe?: Partial<typeof recipe>; pins?: Array<Partial<PinterestPost>> } = {}) {
  const fake = createFakeDb({ recipes: [{ ...recipe, ...overrides.recipe }], pinterest_posts: (overrides.pins ?? []) as Array<Record<string, unknown>> });
  const uploads: string[] = [];
  const removed: string[] = [];
  const store: PinImageStore = {
    upload: vi.fn(async (path: string) => (uploads.push(path), `https://cdn.test/${path}`)),
    remove: vi.fn(async (paths: string[]) => void removed.push(...paths)),
  };
  const fetchPhoto = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const render = vi.fn(async () => Buffer.from("jpeg"));
  return { ...fake, deps: { siteUrl: SITE, store, fetchPhoto, render }, uploads, removed, fetchPhoto, render };
}

describe("preparePin", () => {
  it("prepares a ready Pin with image and text, and does nothing on a retry", async () => {
    const t = setup();
    const first = await preparePin(t.db, recipe.id, t.deps);
    expect(first.outcome).toBe("prepared");
    const pin = t.data.pinterest_posts[0];
    expect(pin).toMatchObject({
      recipe_id: recipe.id,
      variant: "primary",
      publication_status: "ready",
      board_name: "Gluten-Free Recipes",
      destination_url: `${SITE}/recipes/gluten-free-banana-bread`,
      idempotency_key: `pin:${recipe.id}:primary`,
      error_message: null,
    });
    expect(pin.image_url).toMatch(/^https:\/\/cdn\.test\/pins\/11111111-1111-4111-8111-111111111111\/primary-[0-9a-f]{16}\.jpg$/);
    expect(t.fetchPhoto).toHaveBeenCalledWith(recipe.featured_image);

    const second = await preparePin(t.db, recipe.id, t.deps);
    expect(second.outcome).toBe("unchanged");
    expect(t.data.pinterest_posts).toHaveLength(1);
    expect(t.render).toHaveBeenCalledTimes(1);
  });

  it("only prepares Pins for published recipes", async () => {
    const t = setup({ recipe: { status: "in_review" } });
    expect((await preparePin(t.db, recipe.id, t.deps)).outcome).toBe("skipped");
    expect(t.data.pinterest_posts).toHaveLength(0);
  });

  it("never touches a published Pin", async () => {
    const t = setup({ pins: [{ id: "p1", recipe_id: recipe.id, variant: "primary", publication_status: "published", pin_title: "Live", pinterest_pin_id: "123" }] });
    const result = await preparePin(t.db, recipe.id, t.deps, { force: true });
    expect(result.outcome).toBe("skipped");
    expect(t.data.pinterest_posts[0].pin_title).toBe("Live");
    expect(t.render).not.toHaveBeenCalled();
  });

  it("records a failure on the Pin instead of throwing, and a retry recovers", async () => {
    const t = setup();
    t.fetchPhoto.mockRejectedValueOnce(new Error("Could not download the recipe photo (HTTP 404)."));
    const failed = await preparePin(t.db, recipe.id, t.deps);
    expect(failed).toMatchObject({ outcome: "failed", message: expect.stringContaining("HTTP 404") });
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "failed", retry_count: 1 });

    expect((await preparePin(t.db, recipe.id, t.deps)).outcome).toBe("prepared");
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", error_message: null });
  });

  it("fails clearly when the recipe has no photo", async () => {
    const t = setup({ recipe: { featured_image: null, pinterest_image: null } });
    const result = await preparePin(t.db, recipe.id, t.deps);
    expect(result).toMatchObject({ outcome: "failed", message: expect.stringContaining("no photo") });
    expect(t.data.pinterest_posts[0].publication_status).toBe("failed");
  });

  it("keeps an admin's edited text and redraws only when the image text changes", async () => {
    const t = setup();
    await preparePin(t.db, recipe.id, t.deps);
    const pinId = t.data.pinterest_posts[0].id as string;
    const firstImage = t.data.pinterest_posts[0].image_path;

    const edit = { pin_title: "My Banana Bread", pin_description: "Edited.", keywords: ["banana bread"], board_name: "Gluten-Free Recipes", image_text: "Banana Bread", image_alt: "" };
    const { imageTextChanged } = await updatePinContent(t.db, pinId, edit, "admin-1");
    expect(imageTextChanged).toBe(true);
    expect((await preparePin(t.db, recipe.id, t.deps)).outcome).toBe("prepared");
    expect(t.data.pinterest_posts[0]).toMatchObject({ pin_title: "My Banana Bread", image_text: "Banana Bread", edited_by: "admin-1" });
    expect(t.data.pinterest_posts[0].image_path).not.toBe(firstImage);
    expect(t.removed).toEqual([firstImage]);

    // A later automatic run (e.g. republishing) keeps the edits.
    expect((await preparePin(t.db, recipe.id, t.deps)).outcome).toBe("unchanged");
    expect(t.data.pinterest_posts[0].pin_title).toBe("My Banana Bread");

    // "Rebuild text from the recipe" discards them.
    await preparePin(t.db, recipe.id, t.deps, { resetText: true });
    expect(t.data.pinterest_posts[0]).toMatchObject({ pin_title: "Gluten-Free Banana Bread", edited_at: null });
  });

  it("lists published recipes that have no Pin yet", async () => {
    const t = setup();
    expect(await listRecipesWithoutPins(t.db)).toEqual([recipe.id]);
    await preparePin(t.db, recipe.id, t.deps);
    expect(await listRecipesWithoutPins(t.db)).toEqual([]);
  });
});

describe("updatePinContent", () => {
  const base = { pin_title: "Banana Bread", pin_description: "Soft and easy.", keywords: [], board_name: "Gluten-Free Recipes", image_text: "Banana Bread", image_alt: "" };

  it("enforces Pinterest limits", async () => {
    const t = setup({ pins: [{ id: "p1", recipe_id: recipe.id, variant: "primary", publication_status: "ready" }] });
    await expect(updatePinContent(t.db, "p1", { ...base, pin_title: "x".repeat(101) }, null)).rejects.toThrow(/fix the highlighted/);
    await expect(updatePinContent(t.db, "p1", { ...base, pin_description: "x".repeat(501) }, null)).rejects.toThrow(/fix the highlighted/);
  });

  it("refuses claims the site does not allow", async () => {
    const t = setup({ pins: [{ id: "p1", recipe_id: recipe.id, variant: "primary", publication_status: "ready" }] });
    await expect(updatePinContent(t.db, "p1", { ...base, pin_description: "We tested this bread and it is 100% safe for celiacs." }, null)).rejects.toThrow(/claim/);
  });

  it("refuses to edit a published Pin", async () => {
    const t = setup({ pins: [{ id: "p1", recipe_id: recipe.id, variant: "primary", publication_status: "published" }] });
    await expect(updatePinContent(t.db, "p1", base, null)).rejects.toThrow(/can no longer be edited/);
  });
});

describe("Pinterest publishing", () => {
  it("maps a ready Pin to the official Create Pin request", () => {
    const pin = { pin_title: "T", pin_description: "D", destination_url: `${SITE}/recipes/x`, image_url: "https://cdn.test/pin.jpg", image_alt: "Alt", publication_status: "ready" as const };
    expect(toCreatePinRequest(pin, "board-1")).toEqual({
      board_id: "board-1",
      title: "T",
      description: "D",
      link: `${SITE}/recipes/x`,
      alt_text: "Alt",
      media_source: { source_type: "image_url", url: "https://cdn.test/pin.jpg" },
    });
    expect(() => toCreatePinRequest({ ...pin, publication_status: "failed" }, "board-1")).toThrow(/ready/);
    expect(toCreatePinRequest(pin, "board-1", { aiModified: true }).ai_disclosures).toEqual({ values: ["AI_MODIFIED"] });
  });

  it("builds a Save link without posting anything", () => {
    const url = new URL(pinterestSaveUrl({ url: "https://x.test/r", media: "https://x.test/i.jpg", description: "Brownies & more" }));
    expect(url.hostname).toBe("www.pinterest.com");
    expect(url.searchParams.get("description")).toBe("Brownies & more");
  });
});
