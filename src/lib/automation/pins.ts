// Automatic Pinterest publishing for the daily worker. Runs after the day's
// recipe (whatever its outcome) and posts the Pins of recipes the worker
// published automatically, one at a time:
//
//   check_pin    a Pin left in Publishing (unknown answer, crashed run) is
//                looked up on the board first; it is never posted blindly
//   prepare_pin  a Pin that is pending or failed is drawn again
//   verify_page  the recipe page must answer 200 with its recipe data
//   publish_pin  posted to the selected board (publishReadyPin)
//
// Only Pins of AI recipes that a daily job published in automatic mode, and
// whose recipe is still published, are considered: a recipe that failed its
// checks is never published, so it never has a Pin. Each Pin gets at most
// MAX_PIN_ATTEMPTS tries; after that it waits in Admin → Pinterest. A Pin
// whose link Pinterest blocks (for example as possible spam) is never retried
// automatically, and the run posts no further Pins.
// Every step is logged on the recipe's publishing job.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/services/errors";
import { preparePin, type PinPreparationDeps, type PinterestPost } from "@/lib/services/pinterest";
import { PinLinkBlockedError, PinOutcomeUnknownError, checkPublishingPin, getPinterestConnection, getValidAccessToken, publishReadyPin, type PinterestDeps } from "@/lib/services/pinterest-connection";
import { logEvent } from "./log";
import type { AutomationSettings } from "./pipeline";

/** Tries per Pin (drawing, page check and publishing failures all count). */
export const MAX_PIN_ATTEMPTS = 3;
/** Pins handled per run: today's plus a little catch-up, well inside Pinterest's rate limits. */
export const PINS_PER_RUN = 3;

export interface AutoPinDeps {
  pinterest: PinterestDeps;
  prepare: PinPreparationDeps;
  /** Fetches the public recipe page. Defaults to fetch. */
  fetchPage?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Page check: tries and the wait between them (defaults 4 and 15 seconds). */
  pageAttempts?: number;
  pageDelayMs?: number;
}

export interface AutoPinResult {
  pinId: string;
  jobId: string | null;
  recipeTitle: string;
  outcome: "published" | "waiting" | "failed";
  message: string;
  pinterestPinId?: string;
  /** Pinterest blocked the Pin's link: it is not retried automatically. */
  linkBlocked?: boolean;
}

export type AutoPinRun = { status: "skipped"; reason: string } | { status: "blocked"; reason: string; pins: number } | { status: "done"; results: AutoPinResult[] };

type Candidate = PinterestPost & {
  recipe: { id: string; slug: string; title: string; status: string; source: string; image_source: string | null } | null;
  job: { mode: string | null } | null;
};

/** Why automatic Pins must not run, or null when every switch allows it. */
export function automaticPinsBlocked(settings: Pick<AutomationSettings, "enabled" | "publish_mode" | "pinterest_enabled">, envEnabled: boolean): string | null {
  if (!envEnabled || !settings.enabled) return "Automation is turned off.";
  if (settings.publish_mode !== "auto") return "Publishing mode is Review, so Pins are posted by hand from Admin → Pinterest.";
  if (!settings.pinterest_enabled) return "Automatic Pinterest publishing is turned off (Admin → Automation).";
  return null;
}

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 2000);
}

/** Pins the worker may post, oldest first. */
async function loadCandidates(db: SupabaseClient, limit: number): Promise<Candidate[]> {
  const { data, error } = await db
    .from("pinterest_posts")
    .select("*, recipe:recipes(id,slug,title,status,source,image_source), job:publishing_jobs(mode)")
    .eq("variant", "primary")
    .not("publishing_job_id", "is", null)
    .in("publication_status", ["pending", "ready", "failed", "publishing"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw dbError("List Pins to publish", error);
  return ((data ?? []) as Candidate[])
    .filter((c) => c.job?.mode === "auto" && c.recipe?.status === "published" && c.recipe.source === "ai")
    .filter((c) => c.publication_status === "publishing" || c.retry_count < MAX_PIN_ATTEMPTS)
    .slice(0, limit);
}

/**
 * Checks that the recipe page is public: HTTP 200 at its own address (not
 * redirected elsewhere) with the recipe's structured data. Tries a few times
 * so a page that is still being refreshed gets a moment.
 */
export async function verifyRecipePage(
  url: string,
  slug: string,
  options: Pick<AutoPinDeps, "fetchPage" | "sleep" | "pageAttempts" | "pageDelayMs"> = {},
): Promise<void> {
  const fetcher = options.fetchPage ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.pageAttempts ?? 4;
  let problem = "no answer";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(options.pageDelayMs ?? 15_000);
    try {
      const response = await fetcher(url, {
        headers: { accept: "text/html", "cache-control": "no-cache" },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 200) {
        problem = `HTTP ${response.status}`;
        continue;
      }
      if (response.url && new URL(response.url).pathname.replace(/\/+$/, "") !== `/recipes/${slug}`) {
        problem = `redirected to ${response.url}`;
        continue;
      }
      const html = await response.text();
      if (!html.includes('"@type":"Recipe"')) {
        problem = "the page has no recipe data";
        continue;
      }
      return;
    } catch (err) {
      problem = messageOf(err);
    }
  }
  throw new Error(`The recipe page ${url} is not publicly available (${problem} after ${attempts} tries), so its Pin was not posted.`);
}

export async function publishAutomaticPins(
  db: SupabaseClient,
  settings: Pick<AutomationSettings, "enabled" | "publish_mode" | "pinterest_enabled">,
  envEnabled: boolean,
  deps: AutoPinDeps,
  limit = PINS_PER_RUN,
): Promise<AutoPinRun> {
  const off = automaticPinsBlocked(settings, envEnabled);
  if (off) return { status: "skipped", reason: off };

  const candidates = await loadCandidates(db, limit);
  if (candidates.length === 0) return { status: "done", results: [] };

  // Connection problems stop the whole batch without using up any Pin's tries.
  let blocked: string | null = null;
  try {
    const connection = await getPinterestConnection(db);
    if (!connection.installed) blocked = "The Pinterest tables are not installed.";
    else if (!connection.connection) blocked = "Pinterest is not connected. Click Connect Pinterest in Admin → Pinterest.";
    else if (!connection.connection.selected_board_id) blocked = "No Pinterest board is selected. Choose one in Admin → Pinterest.";
    // Refreshes the sign-in when it expires within three days.
    else await getValidAccessToken(db, deps.pinterest);
  } catch (err) {
    blocked = messageOf(err);
  }
  if (blocked) {
    for (const c of candidates) {
      if (c.publishing_job_id) await logEvent(db, c.publishing_job_id, "publish_pin", "skipped", `Pin not posted: ${blocked}`);
    }
    return { status: "blocked", reason: blocked, pins: candidates.length };
  }

  const results: AutoPinResult[] = [];
  for (const [i, candidate] of candidates.entries()) {
    const result = await publishOne(db, candidate, deps);
    results.push(result);
    // A blocked link usually means Pinterest distrusts the site's links for now:
    // more attempts would only add to it. The rest wait, without using any tries.
    if (result.linkBlocked) {
      for (const rest of candidates.slice(i + 1)) {
        if (rest.publishing_job_id) await logEvent(db, rest.publishing_job_id, "publish_pin", "skipped", "Pin not posted: Pinterest blocked another Pin's link in this run.");
      }
      break;
    }
  }
  return { status: "done", results };
}

async function publishOne(db: SupabaseClient, c: Candidate, deps: AutoPinDeps): Promise<AutoPinResult> {
  const jobId = c.publishing_job_id;
  const recipe = c.recipe!;
  const base = { pinId: c.id, jobId, recipeTitle: recipe.title };
  const log = async (step: string, status: "started" | "succeeded" | "failed" | "info", message?: string, detail: Record<string, unknown> = {}) => {
    if (jobId) await logEvent(db, jobId, step, status, message, { pin_id: c.id, ...detail });
  };
  // retryCount defaults to one more try used; a blocked link uses them all up.
  const recordFailure = async (message: string, retryCount = c.retry_count + 1) => {
    await db
      .from("pinterest_posts")
      .update({ error_message: message, retry_count: retryCount })
      .eq("id", c.id)
      .in("publication_status", ["ready", "failed", "pending"]);
  };

  let status = c.publication_status;
  let destination = c.destination_url;

  // 1. A Pin left in Publishing may already be on Pinterest: look before anything else.
  if (status === "publishing") {
    await log("check_pin", "started", "The last publish attempt's result is unknown. Looking for the Pin on the board.");
    try {
      const check = await checkPublishingPin(db, c.id, deps.pinterest);
      await log("check_pin", check.outcome === "wait" ? "info" : "succeeded", check.message);
      if (check.outcome === "published") return { ...base, outcome: "published", message: check.message, pinterestPinId: check.pinterestPinId };
      if (check.outcome === "wait") return { ...base, outcome: "waiting", message: check.message };
      status = "ready";
    } catch (err) {
      const message = messageOf(err);
      await log("check_pin", "failed", message);
      return { ...base, outcome: "waiting", message: `Could not check Pinterest: ${message}` };
    }
  }

  // 2. Draw it (again) if it is not ready.
  if (status === "pending" || status === "failed") {
    await log("prepare_pin", "started");
    const prepared = await preparePin(db, recipe.id, deps.prepare, { jobId });
    if (prepared.outcome === "failed" || prepared.outcome === "skipped" || prepared.pin?.publication_status !== "ready") {
      await log("prepare_pin", "failed", prepared.message);
      return { ...base, outcome: "failed", message: prepared.message };
    }
    await log("prepare_pin", "succeeded", prepared.message);
    destination = prepared.pin.destination_url;
  }

  // 3. The page must be live before anyone can click through to it.
  await log("verify_page", "started", destination);
  try {
    await verifyRecipePage(destination, recipe.slug, deps);
    await log("verify_page", "succeeded", `${destination} is live.`);
  } catch (err) {
    const message = messageOf(err);
    await log("verify_page", "failed", message);
    await recordFailure(message);
    return { ...base, outcome: "failed", message };
  }

  // 4. Post it.
  await log("publish_pin", "started");
  try {
    const published = await publishReadyPin(db, c.id, { via: "automation", publishedBy: null, aiModified: recipe.image_source === "ai" }, deps.pinterest);
    const message = `Posted to “${published.boardName}” (Pin id ${published.pinterestPinId}).`;
    await log("publish_pin", "succeeded", message, { pinterest_pin_id: published.pinterestPinId });
    return { ...base, outcome: "published", message, pinterestPinId: published.pinterestPinId };
  } catch (err) {
    const message = messageOf(err);
    await log("publish_pin", "failed", message);
    if (err instanceof PinOutcomeUnknownError) return { ...base, outcome: "waiting", message };
    if (err instanceof PinLinkBlockedError) {
      await recordFailure(message, Math.max(c.retry_count + 1, MAX_PIN_ATTEMPTS));
      return { ...base, outcome: "failed", message, linkBlocked: true };
    }
    await recordFailure(message);
    return { ...base, outcome: "failed", message };
  }
}
