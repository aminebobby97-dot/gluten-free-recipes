// Custom destination URL (for example a Bitly link pasted by an admin) and
// publishing a Pin with it from Admin → Pinterest.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getPin, listPins } from "@/lib/data/admin";
import { checkDestinationUrl, isShortenedLink, pinLink } from "@/lib/pins/destination";
import { encryptSecret } from "@/lib/security/secret-box";
import { PINTEREST_SCOPES, PinterestClient, type FetchLike } from "@/lib/services/pinterest-api";
import { preparePin, resetPinDestination, toCreatePinRequest, updatePinContent, type PinImageStore } from "@/lib/services/pinterest";
import { PinLinkBlockedError, checkPublishingPin, getPinterestConfig, publishPin, type PinterestDeps } from "@/lib/services/pinterest-connection";
import { createFakeDb } from "./support/fake-db";

const SITE = "https://www.glutenfreerecipehub.com";
const ORIGINAL = `${SITE}/recipes/gluten-free-banana-bread`;
const BITLY = "https://bit.ly/3AbCdEf";
const NOW = new Date("2026-11-03T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const ACCESS = "pina_ACCESS_TOKEN_1";
const ENV = { PINTEREST_APP_ID: "1234567", PINTEREST_APP_SECRET: "app-secret-value", PINTEREST_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };

function config() {
  const result = getPinterestConfig(ENV);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.config;
}

function connection() {
  const key = config().tokenKey;
  return {
    id: true,
    status: "connected",
    pinterest_username: "glutenfreerecipehub",
    scopes: [...PINTEREST_SCOPES],
    access_token_encrypted: encryptSecret(ACCESS, key, "pinterest:access_token"),
    refresh_token_encrypted: encryptSecret("pinr_REFRESH", key, "pinterest:refresh_token"),
    access_token_expires_at: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    refresh_token_expires_at: new Date(NOW.getTime() + 50 * DAY).toISOString(),
    token_version: 1,
    boards: [{ id: "111", name: "Gluten-Free Recipes", privacy: "PUBLIC", pin_count: 3 }],
    selected_board_id: "111",
    selected_board_name: "Gluten-Free Recipes",
  };
}

type Call = { url: string; init?: RequestInit };

function fakePinterest(routes: Record<string, (call: Call) => { status?: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const path = new URL(url).pathname.replace(/^\/v5/, "");
    const route = Object.entries(routes).find(([p]) => path === p)?.[1];
    if (!route) return new Response(JSON.stringify({ code: 404, message: "not found" }), { status: 404 });
    const out = route(call);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  const created = () => calls.filter((c) => c.url.endsWith("/v5/pins")).map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);
  return { fetcher, calls, created };
}

function deps(fetcher: FetchLike): PinterestDeps {
  const cfg = config();
  return { config: cfg, client: new PinterestClient(cfg.app, fetcher, () => NOW), now: () => NOW };
}

const recipe = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "gluten-free-banana-bread",
  title: "Gluten-Free Banana Bread",
  description: "A moist, tender loaf made with ripe bananas.",
  focus_keyword: "gluten free banana bread",
  prep_time: 15,
  cook_time: 55,
  servings: 10,
  yield_description: "1 loaf",
  featured_image: "https://project.supabase.co/storage/v1/object/public/recipe-images/recipes/banana.webp",
  featured_image_alt: "Sliced banana bread",
  pinterest_image: null,
  pinterest_image_alt: null,
  category: { name: "Gluten-Free Baking", short_name: "Baking" },
  status: "published",
  image_source: "upload",
};

const readyPin = {
  id: "pin-1",
  recipe_id: recipe.id,
  variant: "primary",
  pin_title: "Gluten-Free Banana Bread",
  pin_description: "Soft and easy.",
  keywords: ["gluten free banana bread"],
  board_name: "Gluten-Free Recipes",
  image_text: "Gluten-Free Banana Bread",
  image_alt: "Banana bread",
  destination_url: ORIGINAL,
  custom_destination_url: null,
  image_url: "https://project.supabase.co/storage/v1/object/public/recipe-images/pins/r1/primary-abc.jpg",
  image_path: "pins/r1/primary-abc.jpg",
  publication_status: "ready",
  pinterest_pin_id: null,
  error_message: null,
  retry_count: 0,
  recipe: { status: "published", image_source: "upload" },
};

function setup(pin: Record<string, unknown> = {}) {
  return createFakeDb({ recipes: [{ ...recipe }], pinterest_posts: [{ ...readyPin, ...pin }], pinterest_connection: [connection()] });
}

/** The Save Pin form's fields, as the admin page sends them. */
function form(destination: string) {
  return {
    pin_title: readyPin.pin_title,
    pin_description: readyPin.pin_description,
    keywords: readyPin.keywords,
    board_name: readyPin.board_name,
    image_text: readyPin.image_text,
    image_alt: readyPin.image_alt,
    destination_url: destination,
  };
}

describe("checking a destination URL on the server", () => {
  it("accepts https links, including bit.ly", () => {
    expect(checkDestinationUrl(BITLY)).toEqual({ ok: true, url: BITLY });
    expect(checkDestinationUrl("  https://bit.ly/abc  ")).toEqual({ ok: true, url: "https://bit.ly/abc" });
    expect(checkDestinationUrl(ORIGINAL)).toEqual({ ok: true, url: ORIGINAL });
    expect(checkDestinationUrl("HTTPS://Bit.ly/AbC?x=1")).toEqual({ ok: true, url: "https://bit.ly/AbC?x=1" });
  });

  it.each([
    ["", /Add a destination URL/],
    ["http://bit.ly/abc", /https:\/\//],
    ["bit.ly/abc", /https:\/\//],
    ["javascript:alert(1)", /https:\/\//],
    ["data:text/html,hi", /https:\/\//],
    ["https://bit.ly/a b", /spaces/],
    ["https://bit.ly/a\nb", /spaces or line breaks/],
    ["https://", /valid web address/],
    ["https://user:pass@bit.ly/abc", /user name or password/],
    ["https://bit.ly:8080/abc", /port/],
    ["https://localhost/abc", /public website/],
    ["https://192.168.1.10/abc", /public website/],
    ["https://intranet/abc", /public website/],
    [`https://bit.ly/${"a".repeat(2100)}`, /at most 2048/],
  ])("rejects %j", (value, message) => {
    const result = checkDestinationUrl(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("rejects anything that is not text", () => {
    expect(checkDestinationUrl(undefined).ok).toBe(false);
    expect(checkDestinationUrl(42).ok).toBe(false);
  });

  it("knows which link the Pin opens and which links are shortened", () => {
    expect(pinLink({ destination_url: ORIGINAL })).toBe(ORIGINAL);
    expect(pinLink({ destination_url: ORIGINAL, custom_destination_url: null })).toBe(ORIGINAL);
    expect(pinLink({ destination_url: ORIGINAL, custom_destination_url: BITLY })).toBe(BITLY);
    expect(isShortenedLink(BITLY)).toBe(true);
    expect(isShortenedLink(ORIGINAL)).toBe(false);
  });
});

describe("saving a custom destination URL", () => {
  it("saves a Bitly link on the Pin and shows it again after a reload", async () => {
    const t = setup();
    const { pin } = await updatePinContent(t.db, "pin-1", form(BITLY), "admin-1");
    expect(pin).toMatchObject({ custom_destination_url: BITLY, custom_destination_set_by: "admin-1", destination_url: ORIGINAL });
    expect(pin.custom_destination_set_at).toEqual(expect.any(String));

    // What the admin pages load after a refresh.
    const reloaded = await getPin(t.db, "pin-1");
    expect(reloaded?.custom_destination_url).toBe(BITLY);
    expect(pinLink(reloaded!)).toBe(BITLY);
    const list = await listPins(t.db);
    expect(list?.map((p) => pinLink(p))).toEqual([BITLY]);
  });

  it("rejects an invalid link on the server and changes nothing", async () => {
    const t = setup();
    await expect(updatePinContent(t.db, "pin-1", { ...form("http://bit.ly/abc"), pin_title: "Changed" }, "admin-1")).rejects.toMatchObject({
      code: "invalid_input",
      issues: [{ field: "destination_url", message: expect.stringMatching(/https:\/\//) }],
    });
    await expect(updatePinContent(t.db, "pin-1", form("javascript:alert(1)"), "admin-1")).rejects.toThrow(/destination URL/);
    expect(t.data.pinterest_posts[0]).toMatchObject({ custom_destination_url: null, pin_title: readyPin.pin_title });
  });

  it("stores no custom link when the recipe's own URL is kept", async () => {
    const t = setup();
    const { pin } = await updatePinContent(t.db, "pin-1", form(ORIGINAL), "admin-1");
    expect(pin.custom_destination_url).toBeNull();
  });

  it("leaves the link alone when the form does not send one", async () => {
    const t = setup({ custom_destination_url: BITLY });
    const { destination_url: _omit, ...withoutLink } = form("");
    const { pin } = await updatePinContent(t.db, "pin-1", withoutLink, "admin-1");
    expect(pin.custom_destination_url).toBe(BITLY);
  });

  it("resets to the original recipe URL", async () => {
    const t = setup({ custom_destination_url: BITLY, custom_destination_set_at: NOW.toISOString(), custom_destination_set_by: "admin-1" });
    const pin = await resetPinDestination(t.db, "pin-1");
    expect(pin).toMatchObject({ custom_destination_url: null, custom_destination_set_at: null, custom_destination_set_by: null, destination_url: ORIGINAL });
    expect(pinLink(pin)).toBe(ORIGINAL);
  });

  it("never changes the link of a published or publishing Pin", async () => {
    for (const status of ["published", "publishing", "cancelled"]) {
      const t = setup({ publication_status: status, pinterest_pin_id: status === "published" ? "1" : null });
      await expect(updatePinContent(t.db, "pin-1", form(BITLY), "admin-1")).rejects.toThrow(/can no longer be edited/);
      await expect(resetPinDestination(t.db, "pin-1")).rejects.toThrow(/can no longer be edited/);
      expect(t.data.pinterest_posts[0].custom_destination_url).toBeNull();
    }
  });

  it("is not overwritten when the Pin is prepared again, even after the recipe's address changes", async () => {
    const t = setup({ custom_destination_url: BITLY, edited_at: NOW.toISOString() });
    t.data.recipes[0].slug = "best-gluten-free-banana-bread";
    const store: PinImageStore = { upload: vi.fn(async (path: string) => `https://cdn.test/${path}`), remove: vi.fn(async () => undefined) };
    const result = await preparePin(t.db, recipe.id, { siteUrl: SITE, store, fetchPhoto: async () => new Uint8Array([1]), render: async () => Buffer.from("jpeg") }, { force: true });
    expect(result.outcome).toBe("prepared");
    expect(t.data.pinterest_posts[0]).toMatchObject({ destination_url: `${SITE}/recipes/best-gluten-free-banana-bread`, custom_destination_url: BITLY });
  });

  it("no background code writes the custom link", () => {
    for (const file of ["src/lib/automation/pins.ts", "src/lib/automation/pipeline.ts", "src/lib/services/pinterest-connection.ts", "scripts/automation/run-daily.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/custom_destination_(url|set_at|set_by)\s*:/);
    }
  });
});

describe("publishing with the custom destination URL", () => {
  it("sends the saved Bitly link as the Pin's link, with the existing image, text, board and alt text", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "987" } }) });
    const t = setup({ custom_destination_url: BITLY });
    const result = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher));
    expect(result).toEqual({ pinterestPinId: "987", boardName: "Gluten-Free Recipes" });
    expect(p.created()).toEqual([
      {
        board_id: "111",
        title: readyPin.pin_title,
        description: readyPin.pin_description,
        link: BITLY,
        alt_text: readyPin.image_alt,
        media_source: { source_type: "image_url", url: readyPin.image_url },
      },
    ]);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "published", pinterest_pin_id: "987", custom_destination_url: BITLY });
  });

  it("uses the recipe URL when no custom link is saved", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    await publishPin(setup().db, "pin-1", "admin-1", { aiModified: false, expectedLink: ORIGINAL }, deps(p.fetcher));
    expect(p.created()[0].link).toBe(ORIGINAL);
  });

  it("posts nothing when the saved link is not the one shown on the page", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const t = setup({ custom_destination_url: BITLY });
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: ORIGINAL }, deps(p.fetcher))).rejects.toThrow(/Reload the page/);
    expect(p.calls).toHaveLength(0);
    expect(t.data.pinterest_posts[0].publication_status).toBe("ready");
  });

  it("re-checks the saved link on the server before sending it", () => {
    expect(() => toCreatePinRequest({ ...readyPin, publication_status: "ready", custom_destination_url: "http://bit.ly/x" } as never, "111")).toThrow(/destination URL is not valid/);
  });

  it("never publishes the same Pin twice, even with two quick clicks", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "555" } }) });
    const t = setup({ custom_destination_url: BITLY });
    const results = await Promise.allSettled([
      publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher)),
      publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(p.created()).toHaveLength(1);
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher))).rejects.toThrow(/already published/);
    expect(p.created()).toHaveLength(1);
  });

  it("always keeps Pinterest's AI label on AI photos", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const t = setup({ custom_destination_url: BITLY, recipe: { status: "published", image_source: "ai" } });
    await publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher));
    expect(p.created()[0].ai_disclosures).toEqual({ values: ["AI_MODIFIED"] });
    expect(p.created()[0].link).toBe(BITLY);
  });

  it("does not add the AI label to an uploaded photo unless asked", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    await publishPin(setup().db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher));
    expect(p.created()[0].ai_disclosures).toBeUndefined();
  });

  it("shows Pinterest's real error when it blocks the short link, and keeps the Pin and link for later", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 429, body: { code: 8, message: "Sorry! We blocked this link because it may lead to spam." } }) });
    const t = setup({ custom_destination_url: BITLY });
    const error = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PinLinkBlockedError);
    expect(String((error as Error).message)).toContain('Pinterest said: "Sorry! We blocked this link because it may lead to spam."');
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", pinterest_pin_id: null, custom_destination_url: BITLY });
    expect(String(t.data.pinterest_posts[0].error_message)).toMatch(/blocked/);
    expect(p.created()).toHaveLength(1); // not retried
  });

  it("shows other Pinterest errors as they are, and never reports success", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 400, body: { code: 1, message: "Invalid parameters." } }) });
    const t = setup({ custom_destination_url: BITLY });
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false, expectedLink: BITLY }, deps(p.fetcher))).rejects.toThrow(/HTTP 400, Pinterest code 1[\s\S]*Invalid parameters/);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", pinterest_pin_id: null });
  });

  it("finds a Pin whose publish answer was lost, whether Pinterest kept the short link or the page it leads to", async () => {
    for (const stored of [BITLY, ORIGINAL]) {
      const p = fakePinterest({ "/boards/111/pins": () => ({ body: { items: [{ id: "777", link: stored, created_at: NOW.toISOString() }], bookmark: null } }) });
      const t = setup({ custom_destination_url: BITLY, publication_status: "publishing", board_id: "111", publish_started_at: NOW.toISOString() });
      const result = await checkPublishingPin(t.db, "pin-1", deps(p.fetcher));
      expect(result.outcome).toBe("published");
      expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "published", pinterest_pin_id: "777" });
    }
  });
});
