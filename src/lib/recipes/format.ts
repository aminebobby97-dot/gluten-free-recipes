// Small, pure formatting helpers shared by pages, JSON-LD and the admin.

export function totalMinutes(prep: number | null, cook: number | null): number | null {
  if (prep == null && cook == null) return null;
  return (prep ?? 0) + (cook ?? 0);
}

/** 75 -> "1 hr 15 mins", 30 -> "30 mins", 60 -> "1 hr". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hr${hours === 1 ? "" : "s"}`;
  return rest === 0 ? h : `${h} ${rest} min${rest === 1 ? "" : "s"}`;
}

/** 75 -> "PT1H15M" (ISO 8601 duration used by schema.org). */
export function toIsoDuration(minutes: number | null | undefined): string | undefined {
  if (minutes == null || minutes < 0 || Number.isNaN(minutes)) return undefined;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `PT${rest}M`;
  return rest === 0 ? `PT${hours}H` : `PT${hours}H${rest}M`;
}

/** Turns a title into a URL slug: "Gluten-Free Banana Bread!" -> "gluten-free-banana-bread". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slugs that would collide with static routes under /recipes. */
export const RESERVED_RECIPE_SLUGS = new Set(["page"]);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && slug.length <= 120 && !RESERVED_RECIPE_SLUGS.has(slug);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Trims text to a maximum length on a word boundary, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
