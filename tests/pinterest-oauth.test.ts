import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSecret, deriveKey, encryptSecret, parseEncryptionKey } from "@/lib/security/secret-box";
import { PINTEREST_SCOPES, PinterestClient, buildAuthorizeUrl, type FetchLike } from "@/lib/services/pinterest-api";
import {
  DEFAULT_PINTEREST_REDIRECT_URI,
  completePinterestConnection,
  createOAuthState,
  getPinterestConfig,
  getValidAccessToken,
  PinLinkBlockedError,
  publishPin,
  selectPinterestBoard,
  tokenHealth,
  verifyOAuthState,
  type PinterestDeps,
} from "@/lib/services/pinterest-connection";
import { createFakeDb } from "./support/fake-db";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const ENV = { PINTEREST_APP_ID: "1234567", PINTEREST_APP_SECRET: "app-secret-value", PINTEREST_TOKEN_ENCRYPTION_KEY: KEY_B64 };
const NOW = new Date("2026-10-28T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const ACCESS = "pina_ACCESS_TOKEN_1";
const REFRESH = "pinr_REFRESH_TOKEN_1";

function config() {
  const result = getPinterestConfig(ENV);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.config;
}

type Call = { url: string; init?: RequestInit };

/** A fake Pinterest: answers by URL, records every request. */
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
  return { fetcher, calls };
}

const BOARDS = { items: [{ id: "111", name: "Gluten-Free Recipes", privacy: "PUBLIC", pin_count: 3 }, { id: "222", name: "Ideas", privacy: "PROTECTED" }], bookmark: null };

function deps(fetcher: FetchLike): PinterestDeps {
  const cfg = config();
  return { config: cfg, client: new PinterestClient(cfg.app, fetcher, () => NOW), now: () => NOW };
}

function storedConnection(overrides: Record<string, unknown> = {}) {
  const key = config().tokenKey;
  return {
    id: true,
    status: "connected",
    pinterest_username: "glutenfreerecipehub",
    scopes: [...PINTEREST_SCOPES],
    access_token_encrypted: encryptSecret(ACCESS, key, "pinterest:access_token"),
    refresh_token_encrypted: encryptSecret(REFRESH, key, "pinterest:refresh_token"),
    access_token_expires_at: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    refresh_token_expires_at: new Date(NOW.getTime() + 50 * DAY).toISOString(),
    token_version: 1,
    boards: [{ id: "111", name: "Gluten-Free Recipes", privacy: "PUBLIC", pin_count: 3 }],
    selected_board_id: "111",
    selected_board_name: "Gluten-Free Recipes",
    ...overrides,
  };
}

describe("token encryption", () => {
  const key = deriveKey(Buffer.alloc(32, 1), "test");

  it("round-trips and never stores the plain token", () => {
    const sealed = encryptSecret(ACCESS, key, "pinterest:access_token");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(ACCESS);
    expect(decryptSecret(sealed, key, "pinterest:access_token")).toBe(ACCESS);
    expect(encryptSecret(ACCESS, key, "pinterest:access_token")).not.toBe(sealed); // random IV
  });

  it("rejects a wrong key, a wrong purpose or a changed value", () => {
    const sealed = encryptSecret(REFRESH, key, "pinterest:refresh_token");
    expect(() => decryptSecret(sealed, deriveKey(Buffer.alloc(32, 2), "test"), "pinterest:refresh_token")).toThrow();
    expect(() => decryptSecret(sealed, key, "pinterest:access_token")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, "pinterest:refresh_token")).toThrow();
  });

  it("accepts only 32-byte keys", () => {
    expect(parseEncryptionKey(KEY_B64)).toHaveLength(32);
    expect(parseEncryptionKey("ab".repeat(32))).toHaveLength(32);
    expect(parseEncryptionKey("too-short")).toBeNull();
    expect(parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(parseEncryptionKey(undefined)).toBeNull();
  });
});

describe("Pinterest configuration", () => {
  it("lists what is missing without revealing values", () => {
    const result = getPinterestConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/PINTEREST_APP_ID.*PINTEREST_APP_SECRET.*PINTEREST_TOKEN_ENCRYPTION_KEY/);
    const bad = getPinterestConfig({ ...ENV, PINTEREST_TOKEN_ENCRYPTION_KEY: "short" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.join(" ")).not.toContain("short");
  });

  it("uses the registered redirect URI by default", () => {
    expect(DEFAULT_PINTEREST_REDIRECT_URI).toBe("https://www.glutenfreerecipehub.com/api/pinterest/callback");
    expect(config().app.redirectUri).toBe(DEFAULT_PINTEREST_REDIRECT_URI);
    expect(getPinterestConfig({ ...ENV, PINTEREST_REDIRECT_URI: "http://evil.test/api/pinterest/callback" }).ok).toBe(false);
    expect(getPinterestConfig({ ...ENV, PINTEREST_REDIRECT_URI: "https://www.glutenfreerecipehub.com/other" }).ok).toBe(false);
  });

  it("derives separate keys for tokens and the state cookie", () => {
    const cfg = config();
    expect(cfg.tokenKey.equals(cfg.stateKey)).toBe(false);
  });
});

describe("OAuth authorization and state (CSRF)", () => {
  it("builds the official authorization URL with only the needed scopes", () => {
    const url = new URL(buildAuthorizeUrl(config().app, "abc"));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(url.searchParams.get("client_id")).toBe("1234567");
    expect(url.searchParams.get("redirect_uri")).toBe(DEFAULT_PINTEREST_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("boards:read,boards:write,pins:read,pins:write,user_accounts:read");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.toString()).not.toContain("app-secret-value");
  });

  it("accepts the state only for the same admin, unchanged and within 10 minutes", () => {
    const { stateKey } = config();
    const now = NOW.getTime();
    const { state, cookie } = createOAuthState(stateKey, "admin-1", now);
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(verifyOAuthState(stateKey, cookie, state, "admin-1", now + 60_000)).toBe(true);
    expect(verifyOAuthState(stateKey, cookie, state, "admin-2", now)).toBe(false);
    expect(verifyOAuthState(stateKey, cookie, "other-state", "admin-1", now)).toBe(false);
    expect(verifyOAuthState(stateKey, cookie, state, "admin-1", now + 11 * 60_000)).toBe(false);
    expect(verifyOAuthState(stateKey, undefined, state, "admin-1", now)).toBe(false);
    expect(verifyOAuthState(stateKey, cookie, null, "admin-1", now)).toBe(false);
    const forged = cookie.replace("admin-1", "admin-2");
    expect(verifyOAuthState(stateKey, forged, state, "admin-2", now)).toBe(false);
    const other = createOAuthState(stateKey, "admin-1", now);
    expect(verifyOAuthState(stateKey, other.cookie, state, "admin-1", now)).toBe(false);
  });
});

describe("connecting an account", () => {
  const pinterest = () =>
    fakePinterest({
      "/oauth/token": () => ({ body: { access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 2592000, refresh_token_expires_in: 5184000, scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read" } }),
      "/user_account": () => ({ body: { username: "glutenfreerecipehub", account_type: "BUSINESS", profile_image: "https://i.pinimg.com/p.jpg" } }),
      "/boards": () => ({ body: BOARDS }),
    });

  it("exchanges the code server-side and saves only encrypted tokens", async () => {
    const p = pinterest();
    const t = createFakeDb({ pinterest_connection: [] });
    const saved = await completePinterestConnection(t.db, "one-time-code", "admin-1", deps(p.fetcher));

    const tokenCall = p.calls.find((c) => c.url.endsWith("/v5/oauth/token"))!;
    expect(tokenCall.url).toBe("https://api.pinterest.com/v5/oauth/token");
    expect(tokenCall.init?.method).toBe("POST");
    const headers = tokenCall.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("1234567:app-secret-value").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(tokenCall.init?.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("one-time-code");
    expect(form.get("redirect_uri")).toBe(DEFAULT_PINTEREST_REDIRECT_URI);
    expect(String(tokenCall.init?.body)).not.toContain("app-secret-value");

    const row = t.data.pinterest_connection[0];
    expect(JSON.stringify(row)).not.toContain(ACCESS);
    expect(JSON.stringify(row)).not.toContain(REFRESH);
    expect(decryptSecret(String(row.access_token_encrypted), config().tokenKey, "pinterest:access_token")).toBe(ACCESS);
    expect(row.access_token_expires_at).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(row.refresh_token_expires_at).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
    expect(row.connected_by).toBe("admin-1");
    expect(saved.pinterest_username).toBe("glutenfreerecipehub");
    expect(saved.boards).toHaveLength(2);
    expect(saved.selected_board_id).toBeNull(); // the admin chooses the board
  });

  it("explains a 403 (Trial access) without leaking secrets", async () => {
    const p = fakePinterest({ "/oauth/token": () => ({ status: 403, body: { code: 3, message: "Your application consumer type is not supported." } }) });
    const t = createFakeDb({ pinterest_connection: [] });
    const err = await completePinterestConnection(t.db, "code", "admin-1", deps(p.fetcher)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/403[\s\S]*Trial/);
    expect((err as Error).message).not.toContain("app-secret-value");
    expect(t.data.pinterest_connection).toHaveLength(0);
  });

  it("only lets an admin choose a public board from the list", async () => {
    const t = createFakeDb({ pinterest_connection: [storedConnection({ boards: BOARDS.items, selected_board_id: null, selected_board_name: null })] });
    await expect(selectPinterestBoard(t.db, "222")).rejects.toThrow(/not a public board/);
    await expect(selectPinterestBoard(t.db, "999")).rejects.toThrow(/not found/);
    await selectPinterestBoard(t.db, "111");
    expect(t.data.pinterest_connection[0]).toMatchObject({ selected_board_id: "111", selected_board_name: "Gluten-Free Recipes" });
  });
});

describe("token refresh", () => {
  it("uses the saved token while it is valid, without calling Pinterest", async () => {
    const p = fakePinterest({});
    const t = createFakeDb({ pinterest_connection: [storedConnection()] });
    expect(await getValidAccessToken(t.db, deps(p.fetcher))).toBe(ACCESS);
    expect(p.calls).toHaveLength(0);
  });

  it("refreshes a token that expires within three days and stores the new one encrypted", async () => {
    const p = fakePinterest({ "/oauth/token": () => ({ body: { access_token: "pina_NEW", refresh_token: "pinr_NEW", expires_in: 2592000, refresh_token_expires_at: Math.floor((NOW.getTime() + 60 * DAY) / 1000) } }) });
    const t = createFakeDb({ pinterest_connection: [storedConnection({ access_token_expires_at: new Date(NOW.getTime() + DAY).toISOString() })] });
    expect(await getValidAccessToken(t.db, deps(p.fetcher))).toBe("pina_NEW");
    const form = new URLSearchParams(String(p.calls[0].init?.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(REFRESH);
    const row = t.data.pinterest_connection[0];
    expect(row.token_version).toBe(2);
    expect(decryptSecret(String(row.refresh_token_encrypted), config().tokenKey, "pinterest:refresh_token")).toBe("pinr_NEW");
    expect(row.refresh_token_expires_at).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
    expect(JSON.stringify(row)).not.toContain("pina_NEW");
  });

  it("keeps the old refresh token when Pinterest does not send a new one", async () => {
    const p = fakePinterest({ "/oauth/token": () => ({ body: { access_token: "pina_NEW", expires_in: 2592000 } }) });
    const t = createFakeDb({ pinterest_connection: [storedConnection({ access_token_expires_at: new Date(NOW.getTime() - DAY).toISOString() })] });
    await getValidAccessToken(t.db, deps(p.fetcher));
    const row = t.data.pinterest_connection[0];
    expect(decryptSecret(String(row.refresh_token_encrypted), config().tokenKey, "pinterest:refresh_token")).toBe(REFRESH);
    expect(row.refresh_token_expires_at).toBe(new Date(NOW.getTime() + 50 * DAY).toISOString());
  });

  it("asks to reconnect when Pinterest rejects the refresh token or it expired", async () => {
    const p = fakePinterest({ "/oauth/token": () => ({ status: 400, body: { code: 1, message: "invalid_grant" } }) });
    const t = createFakeDb({ pinterest_connection: [storedConnection({ access_token_expires_at: new Date(NOW.getTime() - DAY).toISOString() })] });
    await expect(getValidAccessToken(t.db, deps(p.fetcher))).rejects.toThrow(/Connect Pinterest again/);
    expect(t.data.pinterest_connection[0].status).toBe("needs_reconnect");

    const expired = createFakeDb({ pinterest_connection: [storedConnection({ refresh_token_expires_at: new Date(NOW.getTime() - DAY).toISOString() })] });
    await expect(getValidAccessToken(expired.db, deps(p.fetcher))).rejects.toThrow(/expired/);
    expect(expired.data.pinterest_connection[0].status).toBe("needs_reconnect");
  });

  it("reports token health for the dashboard", () => {
    const now = NOW.getTime();
    const base = { status: "connected" as const, refresh_token_expires_at: new Date(now + 50 * DAY).toISOString() };
    expect(tokenHealth({ ...base, access_token_expires_at: new Date(now + 20 * DAY).toISOString() }, now)).toBe("valid");
    expect(tokenHealth({ ...base, access_token_expires_at: new Date(now + DAY).toISOString() }, now)).toBe("refresh_soon");
    expect(tokenHealth({ ...base, access_token_expires_at: new Date(now - DAY).toISOString() }, now)).toBe("expired_refreshable");
    expect(tokenHealth({ ...base, status: "needs_reconnect", access_token_expires_at: new Date(now + 20 * DAY).toISOString() }, now)).toBe("reconnect");
  });
});

describe("manual publishing of one Pin", () => {
  const readyPin = {
    id: "pin-1",
    recipe_id: "r1",
    variant: "primary",
    pin_title: "Gluten-Free Banana Bread",
    pin_description: "Soft and easy.",
    destination_url: "https://www.glutenfreerecipehub.com/recipes/gluten-free-banana-bread",
    image_url: "https://project.supabase.co/storage/v1/object/public/recipe-images/pins/r1/primary-abc.jpg",
    image_alt: "Banana bread",
    board_name: "Gluten-Free Recipes",
    publication_status: "ready",
    pinterest_pin_id: null,
    error_message: null,
    retry_count: 0,
    recipe: { status: "published", image_source: "upload" },
  };

  function setup(pin: Record<string, unknown> = {}, connection: Record<string, unknown> = {}) {
    return createFakeDb({ pinterest_posts: [{ ...readyPin, ...pin }], pinterest_connection: [storedConnection(connection)] });
  }

  it("posts the Pin to the chosen board with the official Create Pin request", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "987654321" } }) });
    const t = setup();
    const result = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher));
    expect(result).toEqual({ pinterestPinId: "987654321", boardName: "Gluten-Free Recipes" });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].url).toBe("https://api.pinterest.com/v5/pins");
    expect((p.calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(String(p.calls[0].init?.body))).toEqual({
      board_id: "111",
      title: readyPin.pin_title,
      description: readyPin.pin_description,
      link: readyPin.destination_url,
      alt_text: "Banana bread",
      media_source: { source_type: "image_url", url: readyPin.image_url },
    });
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "published", pinterest_pin_id: "987654321", published_by: "admin-1", board_id: "111", published_at: NOW.toISOString() });
  });

  it("adds Pinterest's AI label when asked", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    await publishPin(setup().db, "pin-1", "admin-1", { aiModified: true }, deps(p.fetcher));
    expect(JSON.parse(String(p.calls[0].init?.body)).ai_disclosures).toEqual({ values: ["AI_MODIFIED"] });
  });

  it("never publishes a Pin twice or one that is not ready", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 201, body: { id: "1" } }) });
    await expect(publishPin(setup({ publication_status: "published", pinterest_pin_id: "1" }).db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/already published/);
    await expect(publishPin(setup({ publication_status: "publishing" }).db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/already being published/);
    await expect(publishPin(setup({ publication_status: "failed" }).db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/Only Ready Pins/);
    await expect(publishPin(setup({ recipe: { status: "draft", image_source: null } }).db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/not published/);
    expect(p.calls).toHaveLength(0);
  });

  it("requires a connection and a chosen board", async () => {
    const p = fakePinterest({});
    await expect(publishPin(setup({}, { selected_board_id: null, selected_board_name: null }).db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/board/);
    const none = createFakeDb({ pinterest_posts: [{ ...readyPin }], pinterest_connection: [] });
    await expect(publishPin(none.db, "pin-1", "a", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/not connected/);
    expect(p.calls).toHaveLength(0);
  });

  it("puts the Pin back to Ready with the reason when Pinterest refuses (Trial access, 403)", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 403, body: { code: 29, message: "You are not permitted to access that resource." } }) });
    const t = setup();
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/403[\s\S]*Trial/);
    expect(t.data.pinterest_posts[0].publication_status).toBe("ready");
    expect(String(t.data.pinterest_posts[0].error_message)).toMatch(/not permitted/);
    expect(String(t.data.pinterest_posts[0].error_message)).not.toContain(ACCESS);
    expect(p.calls).toHaveLength(1); // no automatic retry
  });

  it("tells a blocked link apart from a rate limit, with Pinterest's message and code", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 429, body: { code: 8, message: "Sorry! We blocked this link because it may lead to spam." } }) });
    const t = setup();
    const error = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PinLinkBlockedError);
    expect(String((error as Error).message)).toMatch(/blocked the Pin's link as possible spam \(HTTP 429, Pinterest code 8\)\. This is not a rate limit/);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "ready", publish_started_at: null });
    expect(p.calls).toHaveLength(1);
  });

  it("reports a genuine rate limit as one, with the HTTP status and code", async () => {
    const p = fakePinterest({ "/pins": () => ({ status: 429, body: { code: 8, message: "Too many requests" } }) });
    const t = setup();
    const error = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher)).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(PinLinkBlockedError);
    expect(String((error as Error).message)).toMatch(/rate limit was reached \(HTTP 429, Pinterest code 8\)\. Try again later\. Pinterest said: "Too many requests"/);
    expect(t.data.pinterest_posts[0].publication_status).toBe("ready");
  });

  it("keeps a timed-out Pin in Publishing, so it cannot be posted twice", async () => {
    const p = fakePinterest({ "/pins": () => new Error("socket hang up") });
    const t = setup();
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/may or may not have been created/);
    expect(t.data.pinterest_posts[0]).toMatchObject({ publication_status: "publishing", publish_started_at: NOW.toISOString(), published_via: "admin" });
    // A second click is refused without calling Pinterest.
    await expect(publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher))).rejects.toThrow(/already being published/);
    expect(p.calls).toHaveLength(1);
  });

  it("refreshes once and retries when Pinterest rejects the access token (401)", async () => {
    let attempts = 0;
    const p = fakePinterest({
      "/pins": () => (++attempts === 1 ? { status: 401, body: { code: 2, message: "Authentication failed." } } : { status: 201, body: { id: "55" } }),
      "/oauth/token": () => ({ body: { access_token: "pina_NEW", refresh_token: "pinr_NEW", expires_in: 2592000 } }),
    });
    const t = setup();
    const result = await publishPin(t.db, "pin-1", "admin-1", { aiModified: false }, deps(p.fetcher));
    expect(result.pinterestPinId).toBe("55");
    expect((p.calls[2].init?.headers as Record<string, string>).Authorization).toBe("Bearer pina_NEW");
  });
});

describe("where Pins can be posted from", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }
  const sources = () => files("src").filter((f) => /\.(ts|tsx)$/.test(f));

  it("only the shared publisher calls Pinterest's Create Pin", () => {
    const callers = sources().filter((f) => /\.createPin\(/.test(readFileSync(f, "utf8")));
    expect(callers).toEqual([join("src", "lib", "services", "pinterest-connection.ts")]);
  });

  it("the admin button and the daily worker are the only callers of the publisher", () => {
    expect(sources().filter((f) => /\bpublishPin\(/.test(readFileSync(f, "utf8"))).sort()).toEqual([join("src", "app", "admin", "actions.ts"), join("src", "lib", "services", "pinterest-connection.ts")].sort());
    expect(sources().filter((f) => /\bpublishReadyPin\(/.test(readFileSync(f, "utf8"))).sort()).toEqual([join("src", "lib", "automation", "pins.ts"), join("src", "lib", "services", "pinterest-connection.ts")].sort());
  });

  it("the daily schedule runs once a day at 02:00 UTC in automatic mode, and can still be started by hand", () => {
    const workflow = readFileSync(".github/workflows/daily-recipe.yml", "utf8");
    expect(workflow).toMatch(/^\s*schedule:\s*$/m);
    expect(workflow.match(/^\s*- cron:/gm)).toHaveLength(1);
    expect(workflow).toMatch(/^\s*- cron: "0 2 \* \* \*"/m);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    expect(workflow).toContain("RUN_MODE: ${{ github.event_name == 'schedule' && 'auto' || inputs.mode }}");
    expect(workflow).toContain("RUN_TRIGGER: ${{ github.event_name == 'schedule' && 'schedule' || 'manual' }}");
    expect(workflow).toMatch(/^\s*group: daily-recipe$/m);
  });
});
