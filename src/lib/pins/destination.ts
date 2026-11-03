// The link a Pinterest Pin opens. By default it is the recipe's page on the
// live site (pinterest_posts.destination_url, kept up to date by Pin
// preparation). An admin may replace it with their own link, for example a
// Bitly link they made by hand (pinterest_posts.custom_destination_url). The
// custom link is only ever written by an admin's Save Pin or Reset click:
// preparation and the daily worker never touch it.
//
// Pure: no network calls. Nothing here creates short links or checks them
// with Pinterest; Pinterest itself decides whether it accepts a link.

export const DESTINATION_URL_MAX = 2048;

export type DestinationCheck = { ok: true; url: string } | { ok: false; message: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Checks a destination link typed by an admin. Runs on the server before
 * saving and again before publishing. Accepts any public https:// address,
 * including bit.ly links. Returns the address in its normal form.
 */
export function checkDestinationUrl(input: unknown): DestinationCheck {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { ok: false, message: "Add a destination URL (or click Reset to original recipe URL)." };
  if (value.length > DESTINATION_URL_MAX) return { ok: false, message: `The destination URL can be at most ${DESTINATION_URL_MAX} characters.` };
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, message: "The destination URL cannot contain spaces or line breaks." };
  if (!/^https:\/\//i.test(value)) return { ok: false, message: "The destination URL must start with https:// (for example https://bit.ly/abc123)." };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "That is not a valid web address." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "The destination URL must start with https://." };
  if (url.username || url.password) return { ok: false, message: "The destination URL cannot contain a user name or password." };
  if (url.port && url.port !== "443") return { ok: false, message: "The destination URL cannot use a custom port." };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || IPV4.test(host) || host.startsWith("[")) {
    return { ok: false, message: "The destination URL must be a public website address (a domain name such as bit.ly)." };
  }
  if (url.href.length > DESTINATION_URL_MAX) return { ok: false, message: `The destination URL can be at most ${DESTINATION_URL_MAX} characters.` };
  return { ok: true, url: url.href };
}

/** The link the Pin opens on Pinterest: the admin's custom link if saved, otherwise the recipe page. */
export function pinLink(pin: { destination_url: string; custom_destination_url?: string | null }): string {
  return pin.custom_destination_url || pin.destination_url;
}

/** True when the link goes through a well-known link shortener. Used only to show a note. */
export function isShortenedLink(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    return ["bit.ly", "bitly.com", "j.mp", "tinyurl.com", "t.co", "ow.ly", "buff.ly", "rebrand.ly", "is.gd", "cutt.ly", "shorturl.at"].includes(host);
  } catch {
    return false;
  }
}
