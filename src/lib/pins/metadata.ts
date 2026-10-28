// Pinterest Pin text, built from the recipe itself. Pure and free: no AI call,
// no network. The wording only restates what the recipe page says (title,
// description, time, servings), so it never claims a recipe was tested and
// never invents facts. Pinterest limits: title 100, description 500, alt 500.

import { formatMinutes, totalMinutes, truncate } from "@/lib/recipes/format";
import type { Category, Recipe } from "@/lib/recipes/types";

export const PINTEREST_BOARD_NAME = "Gluten-Free Recipes";
export const PIN_BRAND_NAME = "Gluten Free Recipe Hub";
export const PIN_TITLE_MAX = 100;
export const PIN_DESCRIPTION_MAX = 500;
export const PIN_ALT_MAX = 500;
export const PIN_IMAGE_TEXT_MAX = 90;
export const PIN_KEYWORDS_MAX = 6;
/** Change when the image layout changes, so existing Pins get a new image path. */
export const PIN_TEMPLATE_VERSION = "pin-v1";

export interface PinArtwork {
  /** Large text, normally the recipe title. */
  title: string;
  /** Small label on the photo edge, e.g. "Gluten-free · Breakfast". */
  eyebrow: string;
  /** Facts line under the title, e.g. "Ready in 45 mins · Serves 8". May be empty. */
  detail: string;
  /** Brand line at the bottom. */
  brand: string;
}

export type PinRecipe = Pick<
  Recipe,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "focus_keyword"
  | "prep_time"
  | "cook_time"
  | "servings"
  | "yield_description"
  | "featured_image"
  | "featured_image_alt"
  | "pinterest_image"
  | "pinterest_image_alt"
> & { category?: Pick<Category, "name" | "short_name"> | null };

export interface PinMetadata {
  pin_title: string;
  pin_description: string;
  keywords: string[];
  destination_url: string;
  board_name: string;
  image_text: string;
  image_alt: string;
}

const GLUTEN_FREE = /\bgluten[- ]free\b/i;

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function sentence(text: string): string {
  const t = clean(text);
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** 45 -> "45 minutes", 70 -> "1 hour 10 minutes". */
function minutesInWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hours, mins].filter(Boolean).join(" ");
}

/** Shortens text to whole sentences when possible, otherwise to whole words. */
function fitSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end > max * 0.4) return cut.slice(0, end + 1);
  return truncate(text, max);
}

/** The https address of the recipe page on the live site. */
export function recipeUrl(siteUrl: string, slug: string): string {
  const base = siteUrl.trim().replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error("Pins must link to an https:// site URL. Set NEXT_PUBLIC_SITE_URL (or SITE_URL for the worker).");
  return `${base}/recipes/${slug}`;
}

/** The photo a Pin is made from: the site photo first (it is the checked, published image), then the Pinterest photo. */
export function pinPhotoSource(recipe: Pick<PinRecipe, "featured_image" | "pinterest_image" | "featured_image_alt" | "pinterest_image_alt">): { url: string; alt: string } | null {
  if (recipe.featured_image) return { url: recipe.featured_image, alt: clean(recipe.featured_image_alt) };
  if (recipe.pinterest_image) return { url: recipe.pinterest_image, alt: clean(recipe.pinterest_image_alt) };
  return null;
}

export function buildPinTitle(recipe: Pick<PinRecipe, "title" | "prep_time" | "cook_time">): string {
  const title = clean(recipe.title);
  const total = totalMinutes(recipe.prep_time, recipe.cook_time);
  const extras = [
    GLUTEN_FREE.test(title) ? "" : "Gluten-Free",
    total != null && total > 0 && total <= 45 ? `Ready in ${total} Minutes` : "",
  ].filter(Boolean);
  // Drop the least important extra until it fits.
  for (let n = extras.length; n > 0; n--) {
    const candidate = `${title} (${extras.slice(0, n).join(", ")})`;
    if (candidate.length <= PIN_TITLE_MAX) return candidate;
  }
  return truncate(title, PIN_TITLE_MAX);
}

export function buildPinDescription(recipe: Pick<PinRecipe, "title" | "description" | "focus_keyword" | "prep_time" | "cook_time" | "servings" | "yield_description">): string {
  const total = totalMinutes(recipe.prep_time, recipe.cook_time);
  const serves = recipe.servings ? `serves ${recipe.servings}` : clean(recipe.yield_description) ? `makes ${clean(recipe.yield_description)}` : "";
  const facts = [total ? `Ready in ${minutesInWords(total)}` : "", serves].filter(Boolean).join(" and ");
  const factsSentence = facts ? sentence(facts.charAt(0).toUpperCase() + facts.slice(1)) : "";

  const keyword = clean(recipe.focus_keyword).toLowerCase();
  const body = sentence(recipe.description);
  const mentionsKeyword = keyword && `${recipe.title} ${body}`.toLowerCase().includes(keyword);
  const what = keyword && !mentionsKeyword ? `this ${/\brecipes?$/.test(keyword) ? keyword : `${keyword} recipe`}` : "this recipe";
  const cta = `Save ${what} for later and find the full ingredient list and step-by-step instructions on ${PIN_BRAND_NAME}.`;

  const tail = [factsSentence, cta].filter(Boolean).join(" ");
  const room = PIN_DESCRIPTION_MAX - tail.length - 1;
  const lead = room > 40 ? fitSentences(body, room) : "";
  return truncate([lead, tail].filter(Boolean).join(" "), PIN_DESCRIPTION_MAX);
}

/** A few search phrases for the Pin, without repeats ("gluten free" and "gluten-free" count as one). */
export function buildPinKeywords(recipe: Pick<PinRecipe, "focus_keyword" | "category">): string[] {
  const candidates = [
    clean(recipe.focus_keyword).toLowerCase(),
    recipe.category ? `gluten-free ${clean(recipe.category.short_name).toLowerCase()}` : "",
    recipe.category && recipe.category.name !== recipe.category.short_name ? clean(recipe.category.name).toLowerCase() : "",
    "gluten-free recipes",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of candidates) {
    const key = k.replace(/gluten[- ]free/g, "gluten-free").replace(/[^a-z0-9 -]/g, "").trim();
    if (!key || key.length > 80 || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out.slice(0, PIN_KEYWORDS_MAX);
}

export function buildPinMetadata(recipe: PinRecipe, siteUrl: string): PinMetadata {
  const imageText = truncate(clean(recipe.title), PIN_IMAGE_TEXT_MAX);
  const photo = pinPhotoSource(recipe);
  return {
    pin_title: buildPinTitle(recipe),
    pin_description: buildPinDescription(recipe),
    keywords: buildPinKeywords(recipe),
    destination_url: recipeUrl(siteUrl, recipe.slug),
    board_name: PINTEREST_BOARD_NAME,
    image_text: imageText,
    image_alt: truncate(photo?.alt ? `${sentence(photo.alt)} Text: ${imageText}` : imageText, PIN_ALT_MAX),
  };
}

/** The words drawn on the Pin image. */
export function buildPinArtwork(recipe: Pick<PinRecipe, "prep_time" | "cook_time" | "servings" | "yield_description" | "category">, imageText: string): PinArtwork {
  const total = totalMinutes(recipe.prep_time, recipe.cook_time);
  const serves = recipe.servings ? `Serves ${recipe.servings}` : clean(recipe.yield_description) ? `Makes ${clean(recipe.yield_description)}` : "";
  return {
    title: imageText,
    eyebrow: recipe.category ? `Gluten-free · ${clean(recipe.category.short_name)}` : "Gluten-free recipe",
    detail: [total ? `Ready in ${formatMinutes(total)}` : "", serves].filter(Boolean).join(" · "),
    brand: PIN_BRAND_NAME,
  };
}
