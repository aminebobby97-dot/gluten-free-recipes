// Minimal client for the official Pinterest API v5: OAuth (authorization code
// and refresh), the signed-in account, its boards, and Create Pin. Server only:
// it handles the app secret and access tokens, which must never reach the
// browser. Errors never include a token or the secret.
//
// Docs: https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/

import "server-only";
import type { PinterestCreatePinRequest } from "./pinterest";

export const PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";

/**
 * Only what the site needs. Pinterest's API reference lists all four
 * boards/pins scopes as required for Create Pin (POST /v5/pins), so
 * boards:write is requested even though the site never creates, edits or
 * deletes boards. user_accounts:read shows which account is connected.
 */
export const PINTEREST_SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"] as const;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PinterestAppCredentials {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface PinterestTokens {
  accessToken: string;
  /** Pinterest may or may not send a new refresh token on refresh; null keeps the old one. */
  refreshToken: string | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}

export interface PinterestAccount {
  username: string | null;
  accountType: string | null;
  profileImage: string | null;
}

export interface PinterestBoard {
  id: string;
  name: string;
  privacy: string;
  pin_count: number | null;
}

export interface PinterestBoardPin {
  id: string;
  link: string | null;
  created_at: string | null;
}

/** A failed Pinterest request. `message` is safe to show an admin. */
export class PinterestApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly pinterestCode: number | null = null,
    /** True when the request may have reached Pinterest (timeout or server error). */
    public readonly uncertain = false,
  ) {
    super(message);
    this.name = "PinterestApiError";
  }

  /** The token is invalid or revoked: the admin must connect again. */
  get needsReconnect(): boolean {
    return this.status === 401;
  }
}

export function buildAuthorizeUrl(app: Pick<PinterestAppCredentials, "appId" | "redirectUri">, state: string): string {
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: PINTEREST_SCOPES.join(","),
    state,
  });
  return `${PINTEREST_AUTHORIZE_URL}?${params.toString()}`;
}

const TIMEOUT_MS = 20_000;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function describe(status: number, body: Record<string, unknown>, action: string): PinterestApiError {
  const code = typeof body.code === "number" ? body.code : null;
  const detail = typeof body.message === "string" ? body.message.slice(0, 300) : typeof body.error_description === "string" ? body.error_description.slice(0, 300) : "";
  const said = detail ? ` Pinterest said: "${detail}"` : "";
  if (status === 401) return new PinterestApiError(`${action}: Pinterest no longer accepts the saved sign-in. Click Connect Pinterest again.${said}`, status, code);
  if (status === 403)
    return new PinterestApiError(
      `${action}: Pinterest refused permission (403).${said} Your app has Trial access, which Pinterest limits; some requests need Standard access. Also check that you connected the Pinterest account that owns the board.`,
      status,
      code,
    );
  if (status === 429) return new PinterestApiError(`${action}: Pinterest's rate limit was reached (Trial apps have a small daily limit). Try again later.${said}`, status, code);
  if (status >= 500) return new PinterestApiError(`${action}: Pinterest had a server error (${status}). Try again later.${said}`, status, code, true);
  return new PinterestApiError(`${action}: Pinterest returned an error (${status}).${said}`, status, code);
}

export class PinterestClient {
  constructor(
    private readonly app: PinterestAppCredentials,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async send(url: string, init: RequestInit, action: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PinterestApiError(`${action}: Pinterest did not respond (network error or timeout).`, null, null, true);
    }
    const body = await readJson(response);
    if (!response.ok) throw describe(response.status, body, action);
    return body;
  }

  private tokenRequest(params: Record<string, string>, action: string) {
    const basic = Buffer.from(`${this.app.appId}:${this.app.appSecret}`).toString("base64");
    return this.send(
      `${PINTEREST_API_BASE}/oauth/token`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(params).toString(),
      },
      action,
    );
  }

  private parseTokens(body: Record<string, unknown>, action: string): PinterestTokens {
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (!accessToken) throw new PinterestApiError(`${action}: Pinterest did not return an access token.`, null);
    const now = this.now().getTime();
    const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    const expiresIn = seconds(body.expires_in) ?? 30 * 24 * 3600;
    // Prefer Pinterest's absolute expiry when it sends one (continuous refresh tokens).
    const refreshAt = seconds(body.refresh_token_expires_at);
    const refreshIn = seconds(body.refresh_token_expires_in);
    return {
      accessToken,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
      accessTokenExpiresAt: new Date(now + expiresIn * 1000),
      refreshTokenExpiresAt: refreshAt ? new Date(refreshAt * 1000) : refreshIn ? new Date(now + refreshIn * 1000) : null,
      scopes: typeof body.scope === "string" ? body.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  }

  /** Step 3 of the OAuth flow: trade the one-time code for tokens. */
  async exchangeCode(code: string): Promise<PinterestTokens> {
    const action = "Connecting Pinterest";
    // continuous_refresh only matters for apps created before 25 Sept 2025;
    // newer apps always get a continuous (60-day, renewable) refresh token.
    const body = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.app.redirectUri, continuous_refresh: "true" }, action);
    const tokens = this.parseTokens(body, action);
    if (!tokens.refreshToken) throw new PinterestApiError(`${action}: Pinterest did not return a refresh token.`, null);
    return tokens;
  }

  async refresh(refreshToken: string): Promise<PinterestTokens> {
    const action = "Refreshing the Pinterest sign-in";
    try {
      return this.parseTokens(await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, action), action);
    } catch (err) {
      // A rejected refresh token (400 invalid_grant or 401) means connecting again.
      if (err instanceof PinterestApiError && (err.status === 400 || err.status === 401)) {
        throw new PinterestApiError(`${action}: Pinterest no longer accepts the saved sign-in. Click Connect Pinterest again.`, 401, err.pinterestCode);
      }
      throw err;
    }
  }

  private get(path: string, accessToken: string, action: string) {
    return this.send(`${PINTEREST_API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }, action);
  }

  async getAccount(accessToken: string): Promise<PinterestAccount> {
    const body = await this.get("/user_account", accessToken, "Reading the Pinterest account");
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return { username: str(body.username), accountType: str(body.account_type), profileImage: str(body.profile_image) };
  }

  /** All boards the account can see (public and protected; secret boards need extra scopes we do not request). */
  async listBoards(accessToken: string, maxPages = 10): Promise<PinterestBoard[]> {
    const boards: PinterestBoard[] = [];
    let bookmark: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const query = new URLSearchParams({ page_size: "100" });
      if (bookmark) query.set("bookmark", bookmark);
      const body = await this.get(`/boards?${query.toString()}`, accessToken, "Reading your Pinterest boards");
      for (const item of Array.isArray(body.items) ? body.items : []) {
        const b = item as Record<string, unknown>;
        if (typeof b.id !== "string" || typeof b.name !== "string") continue;
        boards.push({ id: b.id, name: b.name, privacy: typeof b.privacy === "string" ? b.privacy : "PUBLIC", pin_count: typeof b.pin_count === "number" ? b.pin_count : null });
      }
      bookmark = typeof body.bookmark === "string" && body.bookmark ? body.bookmark : null;
      if (!bookmark) break;
    }
    return boards;
  }

  /**
   * The newest Pins on a board (up to maxPages × 100), with their links. Used
   * to find out whether a publish whose answer never arrived created the Pin.
   */
  async listBoardPins(accessToken: string, boardId: string, maxPages = 3): Promise<PinterestBoardPin[]> {
    const pins: PinterestBoardPin[] = [];
    let bookmark: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const query = new URLSearchParams({ page_size: "100" });
      if (bookmark) query.set("bookmark", bookmark);
      const body = await this.get(`/boards/${encodeURIComponent(boardId)}/pins?${query.toString()}`, accessToken, "Reading the Pins on your board");
      for (const item of Array.isArray(body.items) ? body.items : []) {
        const p = item as Record<string, unknown>;
        if (typeof p.id !== "string") continue;
        pins.push({ id: p.id, link: typeof p.link === "string" ? p.link : null, created_at: typeof p.created_at === "string" ? p.created_at : null });
      }
      bookmark = typeof body.bookmark === "string" && body.bookmark ? body.bookmark : null;
      if (!bookmark) break;
    }
    return pins;
  }

  async createPin(accessToken: string, request: PinterestCreatePinRequest): Promise<{ id: string }> {
    const body = await this.send(
      `${PINTEREST_API_BASE}/pins`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) },
      "Publishing the Pin",
    );
    if (typeof body.id !== "string" || !body.id) throw new PinterestApiError("Publishing the Pin: Pinterest did not return the new Pin's id.", null, null, true);
    return { id: body.id };
  }
}
