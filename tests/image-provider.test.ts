import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createOpenAiPhotographer, imagePrompt, type ImageClient } from "@/lib/automation/providers/openai-images";
import { createSiteRefresher, createSupabaseImageStore } from "@/lib/automation/providers/site";
import { AiCallError } from "@/lib/automation/types";
import { goodRecipe } from "./support/automation-fixtures";

async function pngBase64(width: number, height: number) {
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
  return png.toString("base64");
}

function fakeImageClient(response: Awaited<ReturnType<ImageClient["images"]["generate"]>>) {
  const requests: Array<Parameters<ImageClient["images"]["generate"]>[0]> = [];
  const client: ImageClient = { images: { generate: async (params) => (requests.push(params), response) } };
  return { client, requests };
}

describe("OpenAI photographer", () => {
  it("generates a landscape photo and saves it as a 1536x1024 WebP, priced from usage", async () => {
    const usage = { input_tokens: 300, output_tokens: 6000, input_tokens_details: { text_tokens: 300, image_tokens: 0 } };
    const { client, requests } = fakeImageClient({ data: [{ b64_json: await pngBase64(1536, 1024) }], usage });
    const photographer = createOpenAiPhotographer({ client });
    const result = await photographer.run({ recipe: goodRecipe(), orientation: "landscape" });

    expect(requests[0]).toMatchObject({ model: "gpt-image-2", size: "1536x1024", quality: "high", n: 1 });
    expect(result.output.mimeType).toBe("image/webp");
    const meta = await sharp(result.output.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1536, 1024]);
    // 300 text tokens at $2.50/M + 6,000 output tokens at $15/M
    expect(result.costUsd).toBeCloseTo(0.0908, 6);
    expect(result).toMatchObject({ provider: "openai", promptVersion: "photo-v2" });
  });

  it("makes the Pinterest image a 1000x1500 portrait", async () => {
    const { client, requests } = fakeImageClient({ data: [{ b64_json: await pngBase64(1024, 1536) }] });
    const result = await createOpenAiPhotographer({ client }).run({ recipe: goodRecipe(), orientation: "portrait" });
    expect(requests[0].size).toBe("1024x1536");
    const meta = await sharp(result.output.data).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 1500]);
    // No usage reported: charged at the ceiling so the budget is not under-counted.
    expect(result.costUsd).toBeGreaterThanOrEqual(0.18);
  });

  it("describes only the recipe's foods and forbids text, people and gluten foods", () => {
    const prompt = imagePrompt({ recipe: goodRecipe(), orientation: "portrait" });
    expect(prompt).toContain("Gluten-Free Blueberry Muffins");
    expect(prompt).toContain("fresh blueberries");
    expect(prompt).toContain("Vertical 2:3");
    expect(prompt).toMatch(/No people, no hands, no text/);
  });

  it("reports a billed error when no image comes back", async () => {
    const { client } = fakeImageClient({ data: [], usage: { input_tokens: 100, output_tokens: 0 } });
    const error = await createOpenAiPhotographer({ client }).run({ recipe: goodRecipe(), orientation: "landscape" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiCallError);
    expect((error as AiCallError).provider).toBe("openai");
  });

  it("estimates a ceiling of at least $0.18 per image", () => {
    const { client } = fakeImageClient({});
    expect(createOpenAiPhotographer({ client }).estimateUsd({ recipe: goodRecipe(), orientation: "landscape" })).toBeGreaterThanOrEqual(0.18);
  });
});

describe("Supabase image store", () => {
  it("uploads with a content type and long cache, and returns the public URL", async () => {
    const calls: unknown[] = [];
    const bucket = {
      upload: async (...args: unknown[]) => (calls.push(["upload", ...args]), { error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/recipe-images/${path}` } }),
      remove: async (paths: string[]) => (calls.push(["remove", paths]), { error: null }),
    };
    const db = { storage: { from: (name: string) => (calls.push(["from", name]), bucket) } };
    const store = createSupabaseImageStore(db as never);
    const url = await store.upload("recipes/2026/a.webp", { data: new Uint8Array([1]), mimeType: "image/webp" });
    expect(url).toBe("https://x.supabase.co/storage/v1/object/public/recipe-images/recipes/2026/a.webp");
    expect(calls).toContainEqual(["from", "recipe-images"]);
    expect(calls).toContainEqual(["upload", "recipes/2026/a.webp", new Uint8Array([1]), { contentType: "image/webp", cacheControl: "31536000", upsert: false }]);
    await store.remove(["recipes/2026/a.webp"]);
    expect(calls).toContainEqual(["remove", ["recipes/2026/a.webp"]]);
  });
});

describe("site refresher", () => {
  it("calls the revalidate route with the secret and throws on an error status", async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    let status = 200;
    const fakeFetch = (async (url: string, init?: RequestInit) => (seen.push([url, init]), new Response(null, { status }))) as typeof fetch;
    const site = createSiteRefresher("https://example.com", "s".repeat(40), fakeFetch);

    await site.revalidate("gluten-free-blueberry-muffins");
    expect(seen[0][0]).toBe("https://example.com/api/internal/revalidate");
    expect(seen[0][1]).toMatchObject({ method: "POST", redirect: "manual", body: JSON.stringify({ slug: "gluten-free-blueberry-muffins" }) });
    expect((seen[0][1]!.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(40)}`);

    status = 401;
    await expect(site.revalidate("x")).rejects.toThrow(/HTTP 401/);
  });

  it("refuses to follow a redirect, which would drop the secret", async () => {
    const fakeFetch = (async () => new Response(null, { status: 308, headers: { location: "https://www.glutenfreerecipehub.com/api/internal/revalidate" } })) as typeof fetch;
    const site = createSiteRefresher("https://gluten-free-recipes.vercel.app", "s".repeat(40), fakeFetch);
    await expect(site.revalidate("x")).rejects.toThrow(/redirected \(HTTP 308 to https:\/\/www\.glutenfreerecipehub\.com/);
  });
});

describe("imagePrompt: simple, believable compositions", () => {
  const pizza = () => goodRecipe({ title: "Gluten-Free Pizza Crust", image_brief: "A golden pizza crust on folded parchment, one edge lifted to show the browned underside, with a pizza cutter." });

  it("shoots flat dishes like a pizza crust from directly overhead", () => {
    const prompt = imagePrompt({ recipe: pizza(), orientation: "landscape" });
    expect(prompt).toMatch(/directly overhead/);
    expect(imagePrompt({ recipe: goodRecipe(), orientation: "landscape" })).toMatch(/30 to 45 degree angle/);
  });

  it("rules out the compositions image models get wrong, over whatever the brief asked for", () => {
    const prompt = imagePrompt({ recipe: pizza(), orientation: "landscape" });
    expect(prompt).toMatch(/nothing folded, rolled, lifted, cut away or tilted to show an underside/);
    expect(prompt).toMatch(/No parchment or paper shapes, no utensils touching, cutting or lying on the food/);
    expect(prompt).toMatch(/golden brown with a realistic dry, matte surface; no melted cheese/);
    expect(prompt).toMatch(/conflicts with these composition rules, follow these rules/);
    // The rules come after the brief, so they have the last word.
    expect(prompt.indexOf("follow these rules")).toBeGreaterThan(prompt.indexOf("folded parchment"));
  });

  it("names the earlier rejection reasons, once each, only on a retry", () => {
    expect(imagePrompt({ recipe: pizza(), orientation: "landscape" })).not.toMatch(/rejected/);
    const prompt = imagePrompt({ recipe: pizza(), orientation: "landscape", avoid: ["Impossible parchment geometry.", "Distorted pizza cutter.", "Impossible parchment geometry."] });
    expect(prompt).toContain("An earlier photo of this dish was rejected for these problems; make sure none of them appears: Impossible parchment geometry. Distorted pizza cutter.");
    expect(prompt.match(/Impossible parchment geometry/g)).toHaveLength(1);
  });

  it("caps how many earlier problems it repeats", () => {
    const avoid = Array.from({ length: 10 }, (_, i) => `Problem ${i + 1}.`);
    const prompt = imagePrompt({ recipe: pizza(), orientation: "landscape", avoid });
    expect(prompt).toContain("Problem 10.");
    expect(prompt).not.toContain("Problem 4.");
  });
});
