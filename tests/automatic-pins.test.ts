import { describe, expect, it } from "vitest";
import { MAX_PIN_ATTEMPTS, automaticPinsBlocked, publishAutomaticPins, verifyRecipePage, type AutoPinDeps } from "@/lib/automation/pins";
import { encryptSecret } from "@/lib/security/secret-box";
import { PINTEREST_SCOPES, PinterestClient, type FetchLike } from "@/lib/services/pinterest-api";
import { checkPublishingPin, getPinterestConfig, sameLink, UNKNOWN_RESULT_WAIT_MINUTES } from "@/lib/services/pinterest-connection";
import { createFakeDb } from "./support/fake-db";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const ENV = { PINTEREST_APP_ID: "1234567", PINTEREST_APP_SECRET: "app-secret-value", PINTEREST_TOKEN_ENCRYPTION_KEY: KEY_B64 };
const NOW = new Date("2026-11-02T02:10:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ACCESS = "pina_ACCESS_TOKEN_1";
const URL_ = "https://www.glutenfreerecipehub.com/recipes/gluten-free-blueberry-muffins";
const RECIPE_HTML = `<html><link rel="canonical" href="${URL_}"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Muffins"}</script></html>`;

function config() {
  const result = getPinterestConfig(ENV);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.config;
}

type Call = { url: string; init?: RequestInit };

function fakePinterest(routes: Record<string, (call: Call) => { status?: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const path = new URL(url).pathname.replace(/^\/v5/, "");
    const route = routes[path];
    if (!route) return new Response(JSON.stringify({ code: 404, message: "not found" }), { status: 404 });
    const out = route(call);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  const created = () => calls.filter((c) => c.url.endsWith("/v5/pins") && c.init?.method === "POST").length;
  return { fetcher, calls, created };
}

function connection(overrides: Record<string, unknown> = {}) {
  const key = config().tokenKey;
  return {
    id: true,
    status: "connected",
    pinterest_username: "glutenfreerecipehub",
    scopes: [...PINTEREST_SCOPES],
    access_token_encrypted: encryptSecret(ACCESS, key, "pinterest:access_token"),
    refresh_token_encrypted: encryptSecret("pinr_REFRESH_1", key, "pinterest:refresh_token"),
    access_token_expires_at: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    refresh_token_expires_at: new Date(NOW.getTime() + 50 * DAY).toISOString(),
    token_version: 1,
    boards: [{ id: "111", name: "Gluten-Free Recipes", privacy: "PUBLIC", pin_count: 3 }],
    selected_board_id: "111",
    selected_board_name: "Gluten-Free Recipes",
    ...overrides,
  };
}

const RECIPE = { id: "r1", slug: "gluten-free-blueberry-muffins", title: "Gluten-Free Blueberry Muffins", status: "published", source: "ai", image_source: "ai" };

function pin(overrides: Record<string, unknown> = {}) {
  return {
    id: "pin-1",
    recipe_id: "r1",
    publishing_job_id: "job-1",
    variant: "primary",
    pin_title: "Gluten-Free Blueberry Muffins",
    pin_description: "Soft and easy.",
    destination_url: URL_,
    image_url: "https://project.supabase.co/storage/v1/object/public/recipe-images/pins/r1/primary-abc.jpg",
    image_alt: "Muffins",
    board_name: "Gluten-Free Recipes",
    board_id: null,
    publication_status: "ready",
    pinterest_pin_id: null,
    error_message: null,
    retry_count: 0,
    publish_started_at: null,
    created_at: "2026-11-02T02:05:00Z",
    recipe: RECIPE,
    job: { mode: "auto" },
    ...overrides,
  };
}

const ON = { enabled: true, publish_mode: "auto" as const, pinterest_enabled: true };

function page(status = 200, html = RECIPE_HTML, url = URL_) {
  const calls: string[] = [];
  const fetchPage = async (u: string) => {
    calls.push(u);
    const response = new Response(html, { status, headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  return { fetchPage, calls };
}

function setup(pins: Array<Record<string, unknown>>, conn: Record<string, unknown> | null = {}) {
  return createFakeDb({ pinterest_posts: pins, pinterest_connection: conn ? [connection(conn)] : [], publishing_job_events: [] });
}

function deps(fetcher: FetchLike, site = page(), now = NOW): AutoPinDeps {
  const cfg = config();
  return {
    pinterest: { config: cfg, client: new PinterestClient(cfg.app, fetcher, () => now), now: () => now },
    prepare: { siteUrl: "https://www.glutenfreerecipehub.com", store: { upload: async () => "unused", remove: async () => undefined } },
    fetchPage: site.fetchPage,
    sleep: async () => undefined,
  };
}

describe("automatic Pins: switches", () => {
  it("needs automation, Automatic mode and automatic Pins all on", () => {
    expect(automaticPinsBlocked(ON, true)).toBeNull();
    expect(automaticPinsBlocked(ON, false)).toMatch(/turned off/);
    expect(automaticPinsBlocked({ ...ON, enabled: false }, true)).toMatch(/turned off/);
    expect(automaticPinsBlocked({ ...ON, publish_mode: "review" }, true)).toMatch(/Review/);
    expect(automaticPinsBlocked({ ...ON, pinterest_enabled: false }, true)).toMatch(/Pinterest publishing is turned off/);
  });

  it("does nothing at all while any switch is off", async () => {
    const p = fakePinterest({});
    const t = setup([pin()]);
    expect(await publishAutomaticPins(t.db, { ...ON, pinterest_enabled: false }, true, deps(p.fetcher))).toMatchObject({ status: "skipped" });
    expect(await publishAutomaticPins(t.db, ON, false, deps(p.fetcher))).toMatchObject({ status: "skipped" });
    expect(p.calls).toHaveLength(0);
    expect(t.data.pinterest_posts[0].publication_status).toBe("ready");
  });
});

describe("automatic Pins: posting", () => {
  it("checks the page is live, then posts the Pin to the selected board with the AI label", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1148558711254978999" } }) });
    const site = page();
    const t = setup([pin()]);
    const run = await publishAutomaticPins(t.db, ON, true, deps(p.fetcher, site));

    expect(run).toEqual({ status: "done", results: [expect.objectContaining({ outcome: "published", pinterestPinId: "1148558711254978999", jobId: "job-1" })] });
    expect(site.calls).toEqual([URL_]);
    const body = JSON.parse(String(p.calls[0].init?.body));
    expect(body).toMatchObject({ board_id: "111", link: URL_, ai_disclosures: { values: ["AI_MODIFIED"] } });
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "published", pinterest_pin_id: "1148558711254978999", published_via: "automation", board_name: "Gluten-Free Recipes" });
    expect(t.data.pinterest_posts[0].published_by).toBeUndefined();
    const steps = t.data.publishing_job_events.filter((e) => e.status === "succeeded").map((e) => e.step);
    expect(steps).toEqual(["verify_page", "publish_pin"]);
    expect(t.data.publishing_job_events.every((e) => e.job_id === "job-1")).toBe(true);
  });

  it("never posts a Pin whose recipe page is not live, and counts the try", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const site = page(404, "Not found");
    const t = setup([pin()]);
    const run = await publishAutomaticPins(t.db, ON, true, { ...deps(p.fetcher, site), pageAttempts: 3 });
    expect(run).toMatchObject({ status: "done", results: [{ outcome: "failed", message: expect.stringMatching(/not publicly available \(HTTP 404 after 3 tries\)/) }] });
    expect(site.calls).toHaveLength(3);
    expect(p.created()).toBe(0);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", retry_count: 1 });
    expect(t.data.publishing_job_events).toContainEqual(expect.objectContaining({ step: "verify_page", status: "failed" }));
  });

  it("only posts Pins of recipes published automatically, still published, with tries left", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const t = setup([
      pin({ id: "manual", publishing_job_id: null, job: null }),
      pin({ id: "review-job", job: { mode: "review" } }),
      pin({ id: "unpublished", recipe: { ...RECIPE, status: "draft" } }),
      pin({ id: "handwritten", recipe: { ...RECIPE, source: "manual" } }),
      pin({ id: "tired", retry_count: MAX_PIN_ATTEMPTS }),
      pin({ id: "done", publication_status: "published", pinterest_pin_id: "9" }),
      pin({ id: "cancelled", publication_status: "cancelled" }),
    ]);
    expect(await publishAutomaticPins(t.db, ON, true, deps(p.fetcher))).toEqual({ status: "done", results: [] });
    expect(p.calls).toHaveLength(0);
  });

  it("posts at most a few Pins per run, oldest first", async () => {
    let n = 0;
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: String(++n) } }) });
    const t = setup([pin({ id: "a" }), pin({ id: "b" }), pin({ id: "c" }), pin({ id: "d" })]);
    const run = await publishAutomaticPins(t.db, ON, true, deps(p.fetcher));
    expect(run.status === "done" && run.results.map((r) => r.pinId)).toEqual(["a", "b", "c"]);
    expect(t.data.pinterest_posts.find((x) => x.id === "d")?.publication_status).toBe("ready");
  });

  it("puts a refused Pin back to Ready with the reason and counts the try", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 400, body: { code: 1, message: "Invalid image" } }) });
    const t = setup([pin()]);
    const run = await publishAutomaticPins(t.db, ON, true, deps(p.fetcher));
    expect(run).toMatchObject({ results: [{ outcome: "failed" }] });
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", retry_count: 1, publish_started_at: null });
    expect(String(t.data.pinterest_posts[0].error_message)).toMatch(/Invalid image/);
  });
});

describe("automatic Pins: no duplicates after a timeout", () => {
  it("leaves a timed-out Pin in Publishing, then finds it on the board instead of posting again", async () => {
    const timeout = fakePinterest({ "/pins": () => new Error("socket hang up") });
    const t = setup([pin()]);
    const first = await publishAutomaticPins(t.db, ON, true, deps(timeout.fetcher));
    expect(first).toMatchObject({ results: [{ outcome: "waiting" }] });
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "publishing", publish_started_at: NOW.toISOString(), retry_count: 0 });

    // Next run: Pinterest did create it. It is found by its link and saved, never posted twice.
    const later = new Date(NOW.getTime() + DAY);
    const next = fakePinterest({
      "/boards/111/pins": () => ({ body: { items: [{ id: "other", link: "https://www.glutenfreerecipehub.com/recipes/something-else" }, { id: "777", link: `${URL_}/`, created_at: "2026-11-02T02:10:05" }], bookmark: null } }),
      "/pins": () => ({ status: 201, body: { id: "DUPLICATE" } }),
    });
    const second = await publishAutomaticPins(t.db, ON, true, deps(next.fetcher, page(), later));
    expect(second).toMatchObject({ results: [{ outcome: "published", pinterestPinId: "777" }] });
    expect(next.created()).toBe(0);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "published", pinterest_pin_id: "777" });
  });

  it("waits while Pinterest may still be showing the Pin, then posts it once it is clearly missing", async () => {
    const empty = { "/boards/111/pins": () => ({ body: { items: [], bookmark: null } }) };
    const t = setup([pin({ publication_status: "publishing", publish_started_at: NOW.toISOString(), board_id: "111" })]);

    const soon = fakePinterest({ ...empty, "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const early = new Date(NOW.getTime() + 3 * MINUTE);
    expect(await publishAutomaticPins(t.db, ON, true, deps(soon.fetcher, page(), early))).toMatchObject({ results: [{ outcome: "waiting" }] });
    expect(soon.created()).toBe(0);
    expect(t.data.pinterest_posts[0].publication_status).toBe("publishing");

    const late = new Date(NOW.getTime() + (UNKNOWN_RESULT_WAIT_MINUTES + 1) * MINUTE);
    const after = fakePinterest({ ...empty, "/pins": () => ({ status: 201, body: { id: "42" } }) });
    expect(await publishAutomaticPins(t.db, ON, true, deps(after.fetcher, page(), late))).toMatchObject({ results: [{ outcome: "published", pinterestPinId: "42" }] });
    expect(after.created()).toBe(1);
  });

  it("an admin's Check Pinterest settles a Pin the same way", async () => {
    const t = setup([pin({ publication_status: "publishing", publish_started_at: NOW.toISOString() })]);
    const p = fakePinterest({ "/boards/111/pins": () => ({ body: { items: [{ id: "555", link: URL_ }] } }) });
    expect(await checkPublishingPin(t.db, "pin-1", deps(p.fetcher).pinterest)).toMatchObject({ outcome: "published", pinterestPinId: "555" });
    await expect(checkPublishingPin(t.db, "pin-1", deps(p.fetcher).pinterest)).rejects.toThrow(/published, not waiting/);
  });

  it("compares links the way Pinterest may rewrite them", () => {
    expect(sameLink(URL_, `${URL_}/`)).toBe(true);
    expect(sameLink(URL_, URL_.replace("www.", "WWW."))).toBe(true);
    expect(sameLink(URL_, URL_.replace("www.", ""))).toBe(true);
    expect(sameLink(URL_, `${URL_}-2`)).toBe(false);
    expect(sameLink(URL_, null)).toBe(false);
  });
});

describe("automatic Pins: the Pinterest sign-in", () => {
  it("refreshes a token that expires within three days before posting", async () => {
    const p = fakePinterest({
      "/oauth/token": () => ({ body: { access_token: "pina_NEW", refresh_token: "pinr_NEW", expires_in: 2592000 } }),
      "/pins": () => ({ status: 201, body: { id: "1" } }),
    });
    const t = setup([pin()], { access_token_expires_at: new Date(NOW.getTime() + DAY).toISOString() });
    expect(await publishAutomaticPins(t.db, ON, true, deps(p.fetcher))).toMatchObject({ results: [{ outcome: "published" }] });
    const create = p.calls.find((c) => c.url.endsWith("/v5/pins"));
    expect((create?.init?.headers as Record<string, string>).Authorization).toBe("Bearer pina_NEW");
    expect(t.data.pinterest_connection[0].token_version).toBe(2);
    expect(String(t.data.pinterest_connection[0].access_token_encrypted)).not.toContain("pina_NEW");
  });

  it("stops without using up any Pin's tries when Pinterest must be reconnected", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    const t = setup([pin()], { status: "needs_reconnect" });
    const run = await publishAutomaticPins(t.db, ON, true, deps(p.fetcher));
    expect(run).toMatchObject({ status: "blocked", pins: 1, reason: expect.stringMatching(/Connect Pinterest/) });
    expect(p.calls).toHaveLength(0);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", retry_count: 0 });
    expect(t.data.publishing_job_events).toContainEqual(expect.objectContaining({ job_id: "job-1", step: "publish_pin", status: "skipped" }));
  });

  it("stops when no board is selected or Pinterest is not connected", async () => {
    const p = fakePinterest({});
    expect(await publishAutomaticPins(setup([pin()], { selected_board_id: null }).db, ON, true, deps(p.fetcher))).toMatchObject({ status: "blocked", reason: expect.stringMatching(/board/) });
    expect(await publishAutomaticPins(setup([pin()], null).db, ON, true, deps(p.fetcher))).toMatchObject({ status: "blocked", reason: expect.stringMatching(/not connected/) });
    expect(p.calls).toHaveLength(0);
  });
});

describe("verifyRecipePage", () => {
  const opts = (site: ReturnType<typeof page>) => ({ fetchPage: site.fetchPage, sleep: async () => undefined, pageAttempts: 2 });

  it("accepts the live recipe page", async () => {
    await expect(verifyRecipePage(URL_, RECIPE.slug, opts(page()))).resolves.toBeUndefined();
  });

  it("refuses a page that redirects elsewhere or has no recipe data", async () => {
    await expect(verifyRecipePage(URL_, RECIPE.slug, opts(page(200, RECIPE_HTML, "https://www.glutenfreerecipehub.com/")))).rejects.toThrow(/redirected/);
    await expect(verifyRecipePage(URL_, RECIPE.slug, opts(page(200, "<html>Recipe not found</html>")))).rejects.toThrow(/no recipe data/);
  });

  it("tries again while the page is being refreshed", async () => {
    let n = 0;
    const fetchPage = async () => {
      const ok = ++n > 1;
      return new Response(ok ? RECIPE_HTML : "", { status: ok ? 200 : 404 });
    };
    await expect(verifyRecipePage(URL_, RECIPE.slug, { fetchPage, sleep: async () => undefined, pageAttempts: 3 })).resolves.toBeUndefined();
    expect(n).toBe(2);
  });
});
