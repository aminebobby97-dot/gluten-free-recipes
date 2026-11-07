// Corrects minor pork-free / alcohol-free / condiment problems in code, before
// a recipe is failed or sent to the AI repairer.
//
// Only a few well-understood problems are corrected here, and only where the
// fix is a like-for-like swap that keeps the recipe usable:
//
// - An ordinary flavor extract ("vanilla extract", "pure almond extract",
//   "vanilla bean paste") becomes "alcohol-free vanilla flavoring" in the
//   ingredient list, the steps, substitutions, tips, FAQ and the other prose,
//   in the same amount. Where the ingredient list already uses a compliant
//   vanilla (for example "vanilla powder"), other sections are pointed at that
//   ingredient instead, so every section names the same product.
// - A non-alcoholic product without the "check the label" note gets the note
//   ("choose one labeled alcohol-free").
// - Soy sauce, tamari, coconut aminos and similar condiments without the
//   label note get "choose one labeled gluten-free and alcohol-free".
//
// The label note is always written as an instruction to the reader ("choose
// one labeled ..."), never as a description, so a correction never implies
// that an ordinary, unverified product is gluten-free or alcohol-free.
//
// Everything else is left for the AI repair step: pork, wine, beer, spirits,
// "regular soy sauce", and any mention inside a sentence that talks about
// avoiding or replacing the ingredient ("instead of vanilla extract"), where a
// word swap would produce nonsense. A text swap never changes quantities,
// times or temperatures.
//
// This never decides that a recipe is safe. The pipeline runs every code
// check and the independent AI review again on the corrected recipe, and the
// final pork-free / alcohol-free gate still runs before the photo and publish.

import { CONDIMENTS, findDietaryViolations, hasNonAlcoholicFlavorQualifier, isCompliantCondimentText, LABEL, UNSAFE_PREFIX } from "./dietary";

/** Flavors whose ordinary extract can be swapped for an alcohol-free flavoring 1:1. Rum, brandy, bourbon and amaretto are not: they name a drink. */
const SWAPPABLE_FLAVORS = [
  "vanilla", "almond", "lemon", "orange", "lime", "peppermint", "mint", "spearmint", "coconut", "maple", "anise", "coffee",
  "banana", "cherry", "raspberry", "strawberry", "rose", "hazelnut", "butter", "chocolate", "caramel", "pistachio",
];

const EXTRACT = new RegExp(
  `\\b(?:(?:pure|natural|real|good[- ]quality|homemade)\\s+)?(${SWAPPABLE_FLAVORS.join("|")})(?:\\s+bean)?\\s+(?:extracts?|essences?|flavou?rings?|paste)\\b`,
  "gi",
);

/**
 * Words near a mention that mean the text is about avoiding or replacing it
 * ("instead of vanilla extract", "vanilla extract contains alcohol"). Swapping
 * the name there would make the sentence wrong, so the AI repairer rewrites it.
 */
const AVOID_BEFORE = /\b(?:instead of|rather than|in place of|avoid(?:ing)?|don'?t|do not|never|no|not|without|skip|omit|replac(?:e|es|ed|ing)|swap(?:ping|ped)?(?: out)?|switch(?:ing)? from|traditional(?:ly)?|usually|typically|most)\b[^.!?;:]*$/i;
const AVOID_AFTER = /^[^.!?;]*\b(?:contains?|has|have|made with|cooks? off|evaporates?|burns? off)\b[^.!?;]*\balcohol\b/i;

export interface DietaryFix {
  field: string;
  from: string;
  to: string;
  reason: string;
}

export interface DietaryRepairText {
  description: string;
  introduction: string;
  storage_instructions: string;
  yield_description?: string | null;
  image_alt?: string;
  image_brief?: string;
  ingredients: Array<{ name: string; note?: string; group?: string; amount?: string; unit?: string; metric?: string }>;
  instructions: Array<{ text: string; group?: string }>;
  tips: string[];
  faq: Array<{ question: string; answer: string }>;
  substitutions: Array<{ original: string; substitute: string; note?: string }>;
}

const capitalizeLike = (sample: string, text: string) => (/^[A-Z]/.test(sample) ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const UNITS = /^(?:(?:\d+(?:[./]\d+)?|[\u00bc-\u00be\u2150-\u215e])\s*)+(?:(?:tsp|teaspoons?|tbsp|tablespoons?|cups?|oz|ounces?|g|grams?|ml|lbs?|pounds?|pinch(?:es)?|dash(?:es)?)\b\.?\s*)?(?:of\s+)?/i;

/**
 * True when a substitution's original and substitute name the same product,
 * ignoring amounts and label notes: "vanilla powder" and "1/2 teaspoon vanilla
 * powder (labeled gluten-free)" are the same.
 */
export function sameIngredient(a: string, b: string): boolean {
  const plain = (s: string) =>
    s
      .replace(/\s*\((?:choose one )?labell?ed [^)]*\)/gi, "")
      .trim()
      .replace(UNITS, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return plain(a) === plain(b);
}

/** True when the mention at [start, end) sits in a sentence about avoiding or replacing it. */
function inAvoidContext(text: string, start: number, end: number): boolean {
  const sentenceStart = Math.max(text.lastIndexOf(".", start - 1), text.lastIndexOf("!", start - 1), text.lastIndexOf("?", start - 1), text.lastIndexOf(";", start - 1)) + 1;
  return AVOID_BEFORE.test(text.slice(sentenceStart, start)) || AVOID_AFTER.test(text.slice(end));
}

/** Default compliant name for a flavor: "alcohol-free vanilla flavoring". */
const alcoholFreeName = (flavor: string) => `alcohol-free ${flavor.toLowerCase()} flavoring`;

interface SwapResult {
  text: string;
  /** What was replaced, in order. */
  swaps: Array<{ from: string; to: string }>;
  /** A mention was left as it was because the sentence is about avoiding it. */
  skipped: boolean;
}

/** Replaces every unqualified ordinary extract in one text. `nameFor` gives the compliant name for a flavor. */
export function swapExtracts(text: string, nameFor: (flavor: string) => string = alcoholFreeName): SwapResult {
  const swaps: SwapResult["swaps"] = [];
  let skipped = false;
  const out = text.replace(EXTRACT, (match: string, flavor: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 60), offset);
    if (hasNonAlcoholicFlavorQualifier(before)) return match; // already "alcohol-free vanilla extract"
    if (/^[- ]free\b/i.test(text.slice(offset + match.length))) return match;
    if (inAvoidContext(text, offset, offset + match.length)) {
      skipped = true;
      return match;
    }
    const to = capitalizeLike(match, nameFor(flavor));
    swaps.push({ from: match, to });
    return to;
  });
  return { text: out, swaps, skipped };
}

/** Written as an instruction to buy a labeled product, never as a claim about an unverified one. */
export const LABEL_ALCOHOL = "choose one labeled alcohol-free";
export const LABEL_CONDIMENT = "choose one labeled gluten-free and alcohol-free";

/** Adds a label phrase to an ingredient note, keeping what the note already says. */
function withNote(note: string | undefined, label: string): string {
  const current = (note ?? "").trim();
  if (!current) return label;
  return `${current.replace(/[.;,\s]+$/, "")}; ${label}`;
}

/** Inserts " (label)" right after the first occurrence of `phrase`. */
function insertLabelAfter(text: string, phrase: string, label: string): string | null {
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (at === -1) return null;
  const end = at + phrase.length;
  return `${text.slice(0, end)} (${label})${text.slice(end)}`;
}

/** First unsafe-free, unqualified condiment mention in a text, or null. */
function unlabeledCondiment(text: string): { match: string; start: number } | null {
  if (isCompliantCondimentText(text)) return null;
  for (const c of CONDIMENTS) {
    for (const m of text.matchAll(c.pattern)) {
      const start = m.index ?? 0;
      if (/^[- ]free\b/i.test(text.slice(start + m[0].length))) continue;
      return { match: m[0], start };
    }
  }
  return null;
}

/** True when a text names a condiment as "regular soy sauce", "any fish sauce"...: never fixed in code. */
function hasUnsafeCondiment(text: string): boolean {
  for (const c of CONDIMENTS) {
    for (const m of text.matchAll(c.pattern)) {
      const start = m.index ?? 0;
      if (UNSAFE_PREFIX.test(text.slice(Math.max(0, start - 30), start))) return true;
    }
  }
  return false;
}

/**
 * Corrects the minor problems described at the top of this file in every
 * section of a recipe, consistently. Returns the corrected recipe and what
 * changed. A recipe with nothing to correct is returned unchanged.
 */
export function repairMinorDietaryIssues<T extends DietaryRepairText>(recipe: T): { recipe: T; fixes: DietaryFix[] } {
  const fixes: DietaryFix[] = [];
  const log = (field: string, swaps: SwapResult["swaps"]) => {
    for (const s of swaps) fixes.push({ field, from: s.from, to: s.to, reason: "Ordinary extracts are made with alcohol; switched to an alcohol-free flavoring in the same amount." });
  };

  // 1. Ingredient list first, so other sections can point at the listed product.
  const ingredients = recipe.ingredients.map((ing, n) => {
    const field = `ingredients[${n}]`;
    const name = swapExtracts(ing.name);
    let next = { ...ing, name: name.text };
    log(field, name.swaps);
    const joined = [next.name, next.note].filter(Boolean).join(" ");
    // A non-alcoholic product (including one just renamed) without the label note.
    const labelMissing = findDietaryViolations(field, [next.group, joined].filter(Boolean).join(" "), { requireLabel: true });
    if (labelMissing.length > 0 && labelMissing.every((v) => v.labelOnly)) {
      next = { ...next, note: withNote(next.note, LABEL_ALCOHOL) };
      if (name.swaps.length === 0) fixes.push({ field, from: ing.note ?? "", to: next.note ?? "", reason: "Added the label check for a non-alcoholic product." });
    }
    // Soy sauce and similar condiments without the label note.
    const fullText = [next.name, next.note].filter(Boolean).join(" ");
    if (unlabeledCondiment(fullText) && !hasUnsafeCondiment(fullText)) {
      const note = /\blabell?ed gluten[- ]free\b/i.test(next.note ?? "")
        ? (next.note ?? "").replace(/\blabell?ed gluten[- ]free\b/i, LABEL_CONDIMENT)
        : withNote(next.note, LABEL_CONDIMENT);
      fixes.push({ field, from: next.note ?? "", to: note, reason: "Condiments must be labeled both gluten-free and alcohol-free." });
      next = { ...next, note };
    }
    return next;
  });

  // The compliant product the ingredient list uses for each flavor ("vanilla powder",
  // "alcohol-free vanilla flavoring"), so the other sections name the same thing.
  const listedName = (flavor: string): string => {
    const f = flavor.toLowerCase();
    const matches = ingredients
      .map((ing) => ing.name.split(",")[0].trim())
      .filter((name) => new RegExp(`\\b${f}\\b`, "i").test(name) && findDietaryViolations("x", name).length === 0 && !/\b(?:beans?|pods?)\b/i.test(name));
    return matches.length === 1 ? matches[0].toLowerCase() : alcoholFreeName(f);
  };

  /** Swaps ordinary extracts in one text outside the ingredient list. */
  const swap = (field: string, text: string): string => {
    const swapped = swapExtracts(text, listedName);
    log(field, swapped.swaps);
    return swapped.text;
  };

  /**
   * Adds the missing label notes to one checked field made of several parts
   * (a FAQ's question and answer; a substitution's original, substitute and
   * note). `buyParts` are the parts a condiment label belongs in.
   */
  const label = (field: string, parts: string[], buyParts: number[], labelOrder: number[] = parts.map((_, i) => i)): string[] => {
    const out = [...parts];
    const joined = () => out.filter(Boolean).join(" ");
    const labelMissing = findDietaryViolations(field, joined(), { requireLabel: true });
    if (labelMissing.length > 0 && labelMissing.every((v) => v.labelOnly) && !LABEL.test(joined())) {
      const target = labelOrder
        .flatMap((i) => labelMissing.map((v) => ({ i, phrase: v.match })))
        .find(({ i, phrase }) => out[i]?.toLowerCase().includes(phrase.toLowerCase()));
      const inserted = target ? insertLabelAfter(out[target.i], target.phrase, LABEL_ALCOHOL) : null;
      if (target && inserted) {
        out[target.i] = inserted;
        fixes.push({ field, from: target.phrase, to: `${target.phrase} (${LABEL_ALCOHOL})`, reason: "Added the label check for a non-alcoholic product." });
      }
    }
    const buyText = buyParts.map((i) => out[i]).filter(Boolean).join(" ");
    if (unlabeledCondiment(buyText) && !hasUnsafeCondiment(buyText)) {
      for (const i of buyParts) {
        const part = out[i];
        const found = part ? unlabeledCondiment(part) : null;
        if (!found || inAvoidContext(part, found.start, found.start + found.match.length)) continue;
        const inserted = insertLabelAfter(part, found.match, LABEL_CONDIMENT);
        if (!inserted) continue;
        out[i] = inserted;
        fixes.push({ field, from: found.match, to: `${found.match} (${LABEL_CONDIMENT})`, reason: "Condiments must be labeled both gluten-free and alcohol-free." });
        break;
      }
    }
    return out;
  };

  const instructions = recipe.instructions.map((s, n) => ({ ...s, text: swap(`instructions[${n}]`, s.text) }));
  const tips = recipe.tips.map((t, n) => label(`tips[${n}]`, [swap(`tips[${n}]`, t)], [0])[0]);
  const faq = recipe.faq.map((f, n) => {
    const field = `faq[${n}]`;
    const [question, answer] = label(field, [swap(field, f.question), swap(field, f.answer)], [1], [1, 0]);
    return { question, answer };
  });

  // Substitutions: the "original" is the recipe's own ingredient, so it is named
  // the way the (corrected) ingredient list names it. A substitution that ends
  // up swapping an ingredient for itself only explained the old extract: it is
  // dropped when another substitution remains.
  const substitutions: T["substitutions"] = [];
  recipe.substitutions.forEach((s, n) => {
    const field = `substitutions[${n}]`;
    const [original, substitute, note] = label(field, [swap(field, s.original), swap(field, s.substitute), s.note ? swap(field, s.note) : ""], [1, 2], [1, 2, 0]);
    const changed = original !== s.original || substitute !== s.substitute || (note || undefined) !== (s.note || undefined);
    if (changed && sameIngredient(original, substitute)) {
      const othersLeft = substitutions.length > 0 || recipe.substitutions.length - n - 1 > 0;
      if (othersLeft) {
        fixes.push({ field, from: `${s.original} -> ${s.substitute}`, to: "(removed)", reason: "After the correction this substitution swapped an ingredient for itself." });
        return;
      }
    }
    substitutions.push({ ...s, original, substitute, ...(s.note !== undefined || note ? { note } : {}) });
  });

  const top = (field: "description" | "introduction" | "storage_instructions") => swap(field, recipe[field]);
  const next: T = {
    ...recipe,
    description: top("description"),
    introduction: top("introduction"),
    storage_instructions: top("storage_instructions"),
    ...(recipe.yield_description ? { yield_description: swap("yield_description", recipe.yield_description) } : {}),
    ...(recipe.image_alt ? { image_alt: swap("image_alt", recipe.image_alt) } : {}),
    ...(recipe.image_brief ? { image_brief: swap("image_brief", recipe.image_brief) } : {}),
    ingredients,
    instructions,
    tips,
    faq,
    substitutions,
  };
  return { recipe: fixes.length ? next : recipe, fixes };
}

// --- Guidance for the AI repairer --------------------------------------------
//
// Problems that need more than a word swap (pork, wine, beer, "regular soy
// sauce"...) go to the AI repair step. Each one carries a suggested compliant
// replacement, so the repairer makes the same safe choice every time and
// updates the whole recipe around it.

const HINTS: Array<[RegExp, string]> = [
  [/alcohol-based extract/, 'Use "alcohol-free vanilla flavoring" (note: "choose one labeled alcohol-free") in the same amount, or pure vanilla powder or a vanilla bean. Name it the same way in every section.'],
  [/^(?:wine|sherry|champagne|rice wine|sake)$/, "Use broth labeled gluten-free that suits the dish (chicken or vegetable), or water, plus 1 teaspoon lemon juice or vinegar per 1/2 cup for acidity. Rewrite the deglazing or simmering step to match."],
  [/^(?:beer|hard cider)$/, "Use broth labeled gluten-free, sparkling water, or apple juice, depending on the dish. Rewrite the steps to match."],
  [/^(?:rum|vodka|brandy|whiskey|bourbon|scotch|spirits|liqueur|bitters|alcohol|flambé)$/, "Leave it out, or use fruit juice, citrus zest or an alcohol-free flavoring labeled alcohol-free. Remove any flambé or cook-off step."],
  [/^bacon$/, 'Use "turkey bacon, labeled gluten-free" (pork-free). Turkey bacon renders little fat: add 1 to 2 teaspoons oil where the steps cook in bacon fat, and cook it to 165°F.'],
  [/^ham$/, 'Use "smoked turkey" or "turkey ham", labeled gluten-free; poultry is cooked to 165°F.'],
  [/^(?:pork sausage|chorizo|pepperoni|salami)$/, "Use a chicken, turkey or beef version named as such and labeled gluten-free; poultry is cooked to 165°F, ground beef to 160°F."],
  [/^(?:pork|cured pork|pancetta|prosciutto|guanciale|pork ribs)$/, "Use chicken, turkey, beef or lamb, or a vegetable, and update cooking times and the safe internal temperature (poultry 165°F, ground meat 160°F, whole cuts of beef or lamb 145°F)."],
  [/^(?:lard|pork fat)$/, "Use butter, ghee, vegetable shortening or a neutral oil in the same amount."],
  [/gelatin/, 'Use beef gelatin, fish gelatin or agar-agar named as such, or vegan marshmallows.'],
  [/XO sauce/, "Leave it out; it contains ham."],
];

/** A suggested compliant replacement for a dietary problem, for the repair prompt. */
export function repairHint(category: "pork" | "alcohol" | "condiment", term: string): string {
  if (category === "condiment") {
    return 'Use tamari or coconut aminos and tell the reader to choose one labeled both gluten-free and alcohol-free, for example "tamari (choose one labeled gluten-free and alcohol-free)", in the ingredient list and in every suggestion. Never write "regular soy sauce" and never imply an unlabeled sauce is safe.';
  }
  for (const [pattern, hint] of HINTS) if (pattern.test(term)) return hint;
  return category === "pork" ? "Replace it with a pork-free ingredient named as such." : "Replace it with an alcohol-free ingredient, or leave it out.";
}
