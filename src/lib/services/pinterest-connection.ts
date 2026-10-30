// Pinterest account connection (OAuth, Pinterest API v5) and one-at-a-time
// Pin publishing.
//
// * Tokens are encrypted (AES-256-GCM, key in PINTEREST_TOKEN_ENCRYPTION_KEY)
//   before they are saved in public.pinterest_connection, which only admins can
//   read (RLS), plus the daily worker's service role (read and refresh only,
//   migration 20261030000001). The encryption key is never in the database.
// * Everything here runs on the server, with the signed-in admin's Supabase
//   client or the worker's service-role client. Nothing returns a token to the caller except getValidAccessToken,
//   which is internal to this module's publishing and board calls.
// * Pins are published one at a time: by an admin's Publish Pin click, or by
//   the daily worker (src/lib/automation/pins.ts) when automatic Pinterest
//   publishing is switched on. Both go through publishReadyPin, which never
//   posts a Pin twice, even after a timeout.

import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_SITE_URL } from "@/lib/env";
import { decryptSecret, deriveKey, encryptSecret, parseEncryptionKey, safeEqual, sign } from "@/lib/security/secret-box";
import { dbError, ServiceError } from "./errors";
import { PinterestApiError, PinterestClient, type FetchLike, type PinterestAppCredentials, type PinterestBoard, type PinterestTokens } from "./pinterest-api";
import { toCreatePinRequest, type PinterestPost } from "./pinterest";

// ---------------------------------------------------------------------------
// Configuration (Vercel environment variables, server only)
// ---------------------------------------------------------------------------

export const PINTEREST_CALLBACK_PATH = "/api/pinterest/callback";
export const DEFAULT_PINTEREST_REDIRECT_URI = `${PRIMARY_SITE_URL}${PINTEREST_CALLBACK_PATH}`;

export interface PinterestConfig {
  app: PinterestAppCredentials;
  /** Encrypts tokens at rest. */
  tokenKey: Buffer;
  /** Signs the short-lived OAuth state cookie. */
  stateKey: Buffer;
}

export type PinterestConfigResult = { ok: true; config: PinterestConfig } | { ok: false; problems: string[] };

export function getPinterestConfig(env: Record<string, string | undefined> = process.env): PinterestConfigResult {
  const problems: string[] = [];
  const appId = env.PINTEREST_APP_ID?.trim() ?? "";
  const appSecret = env.PINTEREST_APP_SECRET?.trim() ?? "";
  const redirectUri = env.PINTEREST_REDIRECT_URI?.trim() || DEFAULT_PINTEREST_REDIRECT_URI;
  const master = parseEncryptionKey(env.PINTEREST_TOKEN_ENCRYPTION_KEY);
  if (!appId) problems.push("PINTEREST_APP_ID is not set.");
  if (!appSecret) problems.push("PINTEREST_APP_SECRET is not set.");
  if (!master) problems.push(env.PINTEREST_TOKEN_ENCRYPTION_KEY?.trim() ? "PINTEREST_TOKEN_ENCRYPTION_KEY must be 32 random bytes (create it with: openssl rand -base64 32)." : "PINTEREST_TOKEN_ENCRYPTION_KEY is not set.");
  let url: URL | null = null;
  try {
    url = new URL(redirectUri);
  } catch {
    problems.push("PINTEREST_REDIRECT_URI is not a valid address.");
  }
  if (url && url.protocol !== "https:" && url.hostname !== "localhost") problems.push("PINTEREST_REDIRECT_URI must start with https://.");
  if (url && url.pathname !== PINTEREST_CALLBACK_PATH) problems.push(`PINTEREST_REDIRECT_URI must end with ${PINTEREST_CALLBACK_PATH}.`);
  if (problems.length > 0 || !master) return { ok: false, problems };
  return {
    ok: true,
    config: {
      app: { appId, appSecret, redirectUri },
      tokenKey: deriveKey(master, "pinterest-oauth-tokens"),
      stateKey: deriveKey(master, "pinterest-oauth-state"),
    },
  };
}

export function requirePinterestConfig(env?: Record<string, string | undefined>): PinterestConfig {
  const result = getPinterestConfig(env);
  if (!result.ok) throw new ServiceError("disabled", `Pinterest is not configured on the server: ${result.problems.join(" ")}`);
  return result.config;
}

// ---------------------------------------------------------------------------
// OAuth state (CSRF protection)
// ---------------------------------------------------------------------------

export const OAUTH_STATE_COOKIE = "pinterest_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/**
 * A random `state` for the authorization URL, and a signed cookie that ties it
 * to the admin who started the flow and expires in 10 minutes. The callback
 * only accepts a `state` that matches the cookie, for the same admin.
 */
export function createOAuthState(stateKey: Buffer, userId: string, now = Date.now()): { state: string; cookie: string } {
  const state = randomBytes(32).toString("base64url");
  const payload = `${state}.${userId}.${now + OAUTH_STATE_TTL_SECONDS * 1000}`;
  return { state, cookie: `${payload}.${sign(payload, stateKey, "oauth-state")}` };
}

export function verifyOAuthState(stateKey: Buffer, cookie: string | undefined, state: string | null, userId: string, now = Date.now()): boolean {
  if (!cookie || !state) return false;
  const parts = cookie.split(".");
  if (parts.length !== 4) return false;
  const [expected, owner, expires, signature] = parts;
  if (!safeEqual(signature, sign(`${expected}.${owner}.${expires}`, stateKey, "oauth-state"))) return false;
  if (!(Number(expires) > now)) return false;
  return owner === userId && safeEqual(expected, state);
}

// ---------------------------------------------------------------------------
// Stored connection
// ---------------------------------------------------------------------------

/** Everything except the encrypted tokens. Safe to show an admin. */
export interface PinterestConnection {
  status: "connected" | "needs_reconnect";
  pinterest_username: string | null;
  pinterest_account_type: string | null;
  profile_image: string | null;
  scopes: string[];
  access_token_expires_at: string;
  refresh_token_expires_at: string | null;
  last_refreshed_at: string | null;
  boards: PinterestBoard[];
  boards_fetched_at: string | null;
  selected_board_id: string | null;
  selected_board_name: string | null;
  last_error: string | null;
  connected_at: string;
}

interface StoredConnection extends PinterestConnection {
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_version: number;
}

const PUBLIC_COLUMNS =
  "status,pinterest_username,pinterest_account_type,profile_image,scopes,access_token_expires_at,refresh_token_expires_at,last_refreshed_at,boards,boards_fetched_at,selected_board_id,selected_board_name,last_error,connected_at";

/** Codes for a table that does not exist yet (the migration is not applied). */
const NOT_MIGRATED = new Set(["PGRST205", "42P01"]);

export const PREFERRED_BOARD_NAME = "Gluten-Free Recipes";

/** The connection for the dashboard, without tokens. `installed: false` until the migration is applied. */
export async function getPinterestConnection(db: SupabaseClient): Promise<{ installed: false } | { installed: true; connection: PinterestConnection | null }> {
  const { data, error } = await db.from("pinterest_connection").select(PUBLIC_COLUMNS).eq("id", true).maybeSingle();
  if (error && error.code && NOT_MIGRATED.has(error.code)) return { installed: false };
  if (error) throw dbError("Load Pinterest connection", error);
  return { installed: true, connection: (data as PinterestConnection | null) ?? null };
}

async function loadStored(db: SupabaseClient): Promise<StoredConnection> {
  const { data, error } = await db.from("pinterest_connection").select(`${PUBLIC_COLUMNS},access_token_encrypted,refresh_token_encrypted,token_version`).eq("id", true).maybeSingle();
  if (error) throw dbError("Load Pinterest connection", error);
  if (!data) throw new ServiceError("not_ready", "Pinterest is not connected. Click Connect Pinterest first.");
  return data as StoredConnection;
}

export type TokenHealth = "valid" | "refresh_soon" | "expired_refreshable" | "reconnect";

const REFRESH_MARGIN_MS = 3 * 24 * 3600 * 1000;

/** How the saved sign-in is doing, for the dashboard. */
export function tokenHealth(c: Pick<PinterestConnection, "status" | "access_token_expires_at" | "refresh_token_expires_at">, now = Date.now()): TokenHealth {
  if (c.status === "needs_reconnect") return "reconnect";
  if (c.refresh_token_expires_at && Date.parse(c.refresh_token_expires_at) <= now) return "reconnect";
  const access = Date.parse(c.access_token_expires_at);
  if (access <= now) return "expired_refreshable";
  if (access - now < REFRESH_MARGIN_MS) return "refresh_soon";
  return "valid";
}

/** True when the refresh token expires within two weeks: the admin should refresh before then. */
export function renewalDue(c: Pick<PinterestConnection, "refresh_token_expires_at">, now = Date.now()): boolean {
  if (!c.refresh_token_expires_at) return false;
  return Date.parse(c.refresh_token_expires_at) - now < 14 * 24 * 3600 * 1000;
}

export interface PinterestDeps {
  config: PinterestConfig;
  client: PinterestClient;
  now?: () => Date;
}

export function createPinterestDeps(fetcher?: FetchLike, env?: Record<string, string | undefined>): PinterestDeps {
  const config = requirePinterestConfig(env);
  return { config, client: new PinterestClient(config.app, fetcher) };
}

function tokenColumns(tokens: PinterestTokens, key: Buffer, previousRefresh: string | null) {
  const refreshToken = tokens.refreshToken ?? previousRefresh;
  if (!refreshToken) throw new ServiceError("not_ready", "Pinterest did not return a refresh token.");
  return {
    access_token_encrypted: encryptSecret(tokens.accessToken, key, "pinterest:access_token"),
    refresh_token_encrypted: encryptSecret(refreshToken, key, "pinterest:refresh_token"),
    access_token_expires_at: tokens.accessTokenExpiresAt.toISOString(),
    // Without a new expiry from Pinterest, keep null rather than guess.
    refresh_token_expires_at: tokens.refreshTokenExpiresAt?.toISOString() ?? null,
  };
}

/** Keeps the chosen board if it is still a public board on the account (with its current name). */
function keepBoard(boards: PinterestBoard[], selectedId: string | null) {
  const kept = selectedId ? boards.find((b) => b.id === selectedId && b.privacy === "PUBLIC") : undefined;
  return { selected_board_id: kept?.id ?? null, selected_board_name: kept?.name ?? null };
}

/**
 * Finishes the OAuth flow: trades the code for tokens, reads the account and
 * its boards, and saves everything (tokens encrypted). Replaces any previous
 * connection. The chosen board is kept if it still exists.
 */
export async function completePinterestConnection(db: SupabaseClient, code: string, userId: string, deps: PinterestDeps): Promise<PinterestConnection> {
  const tokens = await deps.client.exchangeCode(code);
  const [account, boards] = await Promise.all([deps.client.getAccount(tokens.accessToken), deps.client.listBoards(tokens.accessToken)]);
  const now = (deps.now?.() ?? new Date()).toISOString();

  const { data: previous } = await db.from("pinterest_connection").select("selected_board_id,token_version").eq("id", true).maybeSingle();
  const prev = previous as { selected_board_id: string | null; token_version: number } | null;

  const { data, error } = await db
    .from("pinterest_connection")
    .upsert(
      {
        id: true,
        status: "connected",
        pinterest_username: account.username,
        pinterest_account_type: account.accountType,
        profile_image: account.profileImage,
        scopes: tokens.scopes,
        ...tokenColumns(tokens, deps.config.tokenKey, null),
        token_version: (prev?.token_version ?? 0) + 1,
        last_refreshed_at: now,
        boards,
        boards_fetched_at: now,
        ...keepBoard(boards, prev?.selected_board_id ?? null),
        last_error: null,
        connected_at: now,
        connected_by: userId,
      },
      { onConflict: "id" },
    )
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) throw dbError("Save Pinterest connection", error);
  return data as PinterestConnection;
}

async function markNeedsReconnect(db: SupabaseClient, message: string) {
  await db.from("pinterest_connection").update({ status: "needs_reconnect", last_error: message.slice(0, 2000) }).eq("id", true);
}

/**
 * Returns a working access token, refreshing it first when it expires within
 * three days (or when `force` is set). Pinterest access tokens last 30 days;
 * the continuous refresh token lasts 60 days and is renewed on each refresh.
 * Two refreshes at once cannot clobber each other: the update only applies to
 * the token version it read, and the loser uses the winner's token.
 */
export async function getValidAccessToken(db: SupabaseClient, deps: PinterestDeps, options: { force?: boolean } = {}): Promise<string> {
  const stored = await loadStored(db);
  const now = deps.now?.() ?? new Date();
  const health = tokenHealth(stored, now.getTime());
  if (health === "reconnect") {
    if (stored.status !== "needs_reconnect") await markNeedsReconnect(db, "The Pinterest sign-in expired. Click Connect Pinterest again.");
    throw new ServiceError("not_ready", "The Pinterest sign-in has expired. Click Connect Pinterest to connect again.");
  }
  const key = deps.config.tokenKey;
  let refreshToken: string;
  try {
    if (health === "valid" && !options.force) return decryptSecret(stored.access_token_encrypted, key, "pinterest:access_token");
    refreshToken = decryptSecret(stored.refresh_token_encrypted, key, "pinterest:refresh_token");
  } catch {
    throw new ServiceError("not_ready", "The saved Pinterest sign-in cannot be read with the current PINTEREST_TOKEN_ENCRYPTION_KEY (was the key changed?). Click Connect Pinterest again.");
  }

  let tokens: PinterestTokens;
  try {
    tokens = await deps.client.refresh(refreshToken);
  } catch (err) {
    if (err instanceof PinterestApiError && err.needsReconnect) {
      await markNeedsReconnect(db, err.message);
      throw new ServiceError("not_ready", err.message);
    }
    throw err;
  }

  const { data, error } = await db
    .from("pinterest_connection")
    .update({ ...tokenColumns(tokens, key, refreshToken), ...(tokens.refreshTokenExpiresAt ? {} : { refresh_token_expires_at: stored.refresh_token_expires_at }), token_version: stored.token_version + 1, last_refreshed_at: now.toISOString(), status: "connected", last_error: null })
    .eq("id", true)
    .eq("token_version", stored.token_version)
    .select("token_version")
    .maybeSingle();
  if (error) throw dbError("Save refreshed Pinterest sign-in", error);
  if (!data) {
    // Someone else refreshed at the same time; use theirs.
    const latest = await loadStored(db);
    return decryptSecret(latest.access_token_encrypted, key, "pinterest:access_token");
  }
  return tokens.accessToken;
}

/** Refreshes the sign-in now and re-reads the account name and boards. */
export async function refreshPinterestConnection(db: SupabaseClient, deps: PinterestDeps): Promise<PinterestConnection> {
  const token = await getValidAccessToken(db, deps, { force: true });
  return refreshPinterestBoards(db, deps, token);
}

/** Re-reads the account and board list from Pinterest. */
export async function refreshPinterestBoards(db: SupabaseClient, deps: PinterestDeps, accessToken?: string): Promise<PinterestConnection> {
  const token = accessToken ?? (await getValidAccessToken(db, deps));
  const stored = await loadStored(db);
  const [account, boards] = await Promise.all([deps.client.getAccount(token), deps.client.listBoards(token)]);
  const { data, error } = await db
    .from("pinterest_connection")
    .update({
      pinterest_username: account.username,
      pinterest_account_type: account.accountType,
      profile_image: account.profileImage,
      boards,
      boards_fetched_at: (deps.now?.() ?? new Date()).toISOString(),
      ...keepBoard(boards, stored.selected_board_id),
      last_error: null,
    })
    .eq("id", true)
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) throw dbError("Save Pinterest boards", error);
  return data as PinterestConnection;
}

/** Chooses the board Pins are published to. Only a public board from the saved list is accepted. */
export async function selectPinterestBoard(db: SupabaseClient, boardId: string): Promise<PinterestBoard> {
  const { data, error } = await db.from("pinterest_connection").select("boards").eq("id", true).maybeSingle();
  if (error) throw dbError("Load Pinterest boards", error);
  if (!data) throw new ServiceError("not_ready", "Pinterest is not connected.");
  const board = ((data as { boards: PinterestBoard[] }).boards ?? []).find((b) => b.id === boardId);
  if (!board) throw new ServiceError("invalid_input", "That board was not found. Click Refresh boards and try again.");
  if (board.privacy !== "PUBLIC") throw new ServiceError("invalid_input", `“${board.name}” is not a public board. Choose a public board so Pins can be seen.`);
  const { error: saveError } = await db.from("pinterest_connection").update({ selected_board_id: board.id, selected_board_name: board.name }).eq("id", true);
  if (saveError) throw dbError("Save Pinterest board", saveError);
  return board;
}

/** Deletes the saved connection and its tokens from the database. */
export async function disconnectPinterest(db: SupabaseClient): Promise<void> {
  const { error } = await db.from("pinterest_connection").delete().eq("id", true);
  if (error) throw dbError("Disconnect Pinterest", error);
}

// ---------------------------------------------------------------------------
// Publishing one Pin: an admin's click, or the daily worker in automatic mode
// ---------------------------------------------------------------------------

export type PublishedVia = "admin" | "automation";

type PinForPublishing = PinterestPost & {
  recipe: { status: string; image_source: string | null } | null;
};

export interface PublishPinResult {
  pinterestPinId: string;
  boardName: string;
}

/**
 * How long Pinterest gets to show a Pin whose publish answer never arrived
 * before it is treated as not created. Until then the Pin stays Publishing and
 * nothing posts it again.
 */
export const UNKNOWN_RESULT_WAIT_MINUTES = 10;

/**
 * The publish request may have reached Pinterest, but no answer came back
 * (timeout, network error, Pinterest server error). The Pin stays Publishing
 * so nothing posts it twice; checkPublishingPin settles it.
 */
export class PinOutcomeUnknownError extends ServiceError {
  constructor(message: string) {
    super("conflict", message);
    this.name = "PinOutcomeUnknownError";
  }
}

/** Compares Pin links the way Pinterest may rewrite them (host case, trailing slash, fragment). */
export function sameLink(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (value: string) => {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return value.trim().replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

/**
 * Publishes one Ready Pin through the manual Publish Pin button. Never retried
 * automatically.
 */
export async function publishPin(db: SupabaseClient, pinId: string, userId: string, options: { aiModified: boolean }, deps: PinterestDeps): Promise<PublishPinResult> {
  return publishReadyPin(db, pinId, { via: "admin", publishedBy: userId, aiModified: options.aiModified }, deps);
}

/**
 * Publishes one Ready Pin to the chosen board through the official Create Pin
 * endpoint. Shared by the admin button and the daily worker.
 *
 * Duplicate protection:
 * * The Pin is first claimed (ready → publishing) so two clicks or two runs
 *   cannot post it twice.
 * * A clear refusal from Pinterest puts it back to Ready with the reason.
 * * When the answer is unknown (timeout, network or server error) the Pin
 *   STAYS Publishing: it may exist on Pinterest. checkPublishingPin looks for
 *   it on the board before it can ever be posted again.
 */
export async function publishReadyPin(
  db: SupabaseClient,
  pinId: string,
  options: { via: PublishedVia; publishedBy: string | null; aiModified: boolean },
  deps: PinterestDeps,
): Promise<PublishPinResult> {
  const { data: pinData, error: pinError } = await db.from("pinterest_posts").select("*, recipe:recipes(status, image_source)").eq("id", pinId).maybeSingle();
  if (pinError) throw dbError("Load Pinterest Pin", pinError);
  const pin = pinData as PinForPublishing | null;
  if (!pin) throw new ServiceError("not_found", "Pin not found.");
  if (pin.publication_status === "published") throw new ServiceError("conflict", "This Pin is already published.");
  if (pin.publication_status === "publishing") {
    throw new ServiceError("conflict", "This Pin is already being published, or the last attempt's result is unknown. Use Check Pinterest on the Pin's page.");
  }
  if (pin.publication_status !== "ready") throw new ServiceError("not_ready", `Only Ready Pins can be published (this one is ${pin.publication_status}).`);
  if (pin.recipe?.status !== "published") throw new ServiceError("not_ready", "The recipe is not published, so its Pin would link to a missing page.");

  const connection = await getPinterestConnection(db);
  if (!connection.installed || !connection.connection) throw new ServiceError("not_ready", "Pinterest is not connected. Click Connect Pinterest first.");
  const { selected_board_id: boardId, selected_board_name: boardName } = connection.connection;
  if (!boardId || !boardName) throw new ServiceError("not_ready", "Choose the Pinterest board to publish to first (Pinterest page, Board).");

  const request = toCreatePinRequest(pin, boardId, { aiModified: options.aiModified });
  // Fails early (before claiming the Pin) if the sign-in is unusable.
  let token = await getValidAccessToken(db, deps);
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  const { data: claimed, error: claimError } = await db
    .from("pinterest_posts")
    .update({ publication_status: "publishing", board_id: boardId, error_message: null, publish_started_at: now(), published_via: options.via })
    .eq("id", pin.id)
    .eq("publication_status", "ready")
    .select("id")
    .maybeSingle();
  if (claimError) throw dbError("Start publishing the Pin", claimError);
  if (!claimed) throw new ServiceError("conflict", "This Pin is already being published or has changed. Reload the page.");

  let created: { id: string };
  try {
    try {
      created = await deps.client.createPin(token, request);
    } catch (err) {
      // A token can be revoked before it expires: refresh once and try again.
      if (!(err instanceof PinterestApiError && err.status === 401)) throw err;
      token = await getValidAccessToken(db, deps, { force: true });
      created = await deps.client.createPin(token, request);
    }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1500);
    if (err instanceof PinterestApiError && err.uncertain) {
      const unknown = `${message} The Pin may or may not have been created, so it was not posted again. It is checked against your board before any new attempt (Check Pinterest on the Pin's page, or the next daily run).`;
      await db.from("pinterest_posts").update({ error_message: unknown.slice(0, 2000) }).eq("id", pin.id).eq("publication_status", "publishing");
      throw new PinOutcomeUnknownError(unknown);
    }
    await db
      .from("pinterest_posts")
      .update({ publication_status: "ready", error_message: message, publish_started_at: null })
      .eq("id", pin.id)
      .eq("publication_status", "publishing");
    if (err instanceof PinterestApiError && err.needsReconnect) await markNeedsReconnect(db, err.message);
    throw new ServiceError("not_ready", message);
  }

  await markPinPublished(db, pin.id, created.id, boardName, options.publishedBy, now());
  return { pinterestPinId: created.id, boardName };
}

async function markPinPublished(db: SupabaseClient, pinId: string, pinterestPinId: string, boardName: string, publishedBy: string | null, at: string) {
  const { error } = await db
    .from("pinterest_posts")
    .update({ publication_status: "published", pinterest_pin_id: pinterestPinId, published_at: at, ...(publishedBy ? { published_by: publishedBy } : {}), board_name: boardName, error_message: null })
    .eq("id", pinId);
  if (error) throw new ServiceError("database", `The Pin was published on Pinterest (id ${pinterestPinId}) but could not be marked as published here: ${error.message}. Do not publish it again.`);
}

export type CheckPinResult =
  | { outcome: "published"; pinterestPinId: string; message: string }
  | { outcome: "released"; message: string }
  | { outcome: "wait"; message: string };

/**
 * Settles a Pin left in Publishing (unknown answer, or a run that crashed):
 * looks for a Pin linking to the recipe on the board. Found: saved as
 * published with Pinterest's id. Not found once Pinterest has had
 * UNKNOWN_RESULT_WAIT_MINUTES to show it: back to Ready, safe to post. Not
 * found sooner: left as it is.
 */
export async function checkPublishingPin(db: SupabaseClient, pinId: string, deps: PinterestDeps): Promise<CheckPinResult> {
  const { data, error } = await db.from("pinterest_posts").select("*").eq("id", pinId).maybeSingle();
  if (error) throw dbError("Load Pinterest Pin", error);
  const pin = data as PinForPublishing | null;
  if (!pin) throw new ServiceError("not_found", "Pin not found.");
  if (pin.publication_status !== "publishing") throw new ServiceError("conflict", `This Pin is ${pin.publication_status}, not waiting for a result.`);

  const connection = await getPinterestConnection(db);
  if (!connection.installed || !connection.connection) throw new ServiceError("not_ready", "Pinterest is not connected. Click Connect Pinterest first.");
  const boardId = pin.board_id ?? connection.connection.selected_board_id;
  const boardName = connection.connection.boards.find((b) => b.id === boardId)?.name ?? pin.board_name;
  if (!boardId) throw new ServiceError("not_ready", "Choose the Pinterest board first (Pinterest page, Board).");

  const token = await getValidAccessToken(db, deps);
  const pins = await deps.client.listBoardPins(token, boardId);
  const match = pins.find((p) => sameLink(p.link, pin.destination_url));
  const now = deps.now?.() ?? new Date();
  if (match) {
    await markPinPublished(db, pin.id, match.id, boardName, null, match.created_at ?? now.toISOString());
    return { outcome: "published", pinterestPinId: match.id, message: `Found on Pinterest (Pin id ${match.id}); saved as published.` };
  }

  const started = pin.publish_started_at ? Date.parse(pin.publish_started_at) : 0;
  const waitedMs = now.getTime() - started;
  if (waitedMs < UNKNOWN_RESULT_WAIT_MINUTES * 60_000) {
    const minutes = Math.ceil((UNKNOWN_RESULT_WAIT_MINUTES * 60_000 - waitedMs) / 60_000);
    return { outcome: "wait", message: `Not on your board yet. Check again in about ${minutes} minute(s) before publishing again.` };
  }
  const { error: releaseError } = await db
    .from("pinterest_posts")
    .update({ publication_status: "ready", publish_started_at: null, error_message: "The last publish attempt did not create a Pin (checked on your board). It is safe to publish again." })
    .eq("id", pin.id)
    .eq("publication_status", "publishing");
  if (releaseError) throw dbError("Update Pinterest Pin", releaseError);
  return { outcome: "released", message: "No Pin for this recipe is on your board, so the last attempt did not create one. The Pin is Ready again." };
}
