// How a recipe photo should be plated, and how each retry simplifies it.
//
// Image models draw simple, familiar scenes believably and complicated ones
// badly (tall stacks, leaning towers, pieces lifted to show the inside). So:
// - each common dish shape gets a plain, natural plating ("two or three
//   quesadilla wedges"), which wins over the writer's free-text photo brief;
// - every retry asks for a simpler scene than the one before (fewer pieces,
//   no props, no writer brief), instead of resending the same prompt with the
//   checker's complaint tacked on;
// - the checker's complaints are turned into positive instructions ("lay the
//   pieces flat") because naming a mistake ("a stack of tortillas") in an image
//   prompt tends to draw it again.
// The photo checker is never relaxed: it is told which plating was asked for,
// and still rejects anything wrong, unrealistic or not in the recipe.

import type { GeneratedRecipe } from "./types";

/** 0 = first attempt, 1 = simpler, 2 = simplest. Attempts past the third stay at 2. */
export type SimplifyLevel = 0 | 1 | 2;

export function simplifyLevel(attempt: number): SimplifyLevel {
  return attempt <= 1 ? 0 : attempt === 2 ? 1 : 2;
}

export type CameraAngle = "overhead" | "angled";

export interface DishStyle {
  /** Short name, for logs and tests. */
  name: string;
  pattern: RegExp;
  /** The title names a different form of the dish ("taco salad", "burrito bowl"), so this style does not apply. */
  unless?: RegExp;
  /** The natural, simple way to plate it, from the normal shot to the simplest one. */
  plating: [string, string, string];
  angle?: CameraAngle;
  /** True when the dish's normal served shape is folded, cut or halved (a quesadilla wedge, a taco). */
  servedCutOrFolded?: boolean;
}

/** Titles like "taco soup", "burrito bowl" or "cookie skillet" are served in a bowl or dish, not as handheld pieces. */
const OTHER_FORM = /\b(bowls?|salads?|soups?|casseroles?|bakes?|skillets?|dips?|lasagnas?|chili|stews?|pasta|sauces?|seasoning|breads?|dough|mix|cups?|boats?|crusts?)\b/i;

/** "Taco pizza" is a pizza, not tacos. */
const OTHER_FORM_OR_PIZZA = new RegExp(`${OTHER_FORM.source}|\\bpizzas?\\b`, "i");

/**
 * Dish shapes image models often get wrong. First match on the title wins, so
 * more specific dishes come first.
 */
export const DISH_STYLES: DishStyle[] = [
  {
    name: "quesadilla",
    unless: OTHER_FORM,
    pattern: /\bquesadillas?\b/i,
    plating: [
      "Plate it as three wedges cut from one quesadilla, lying flat and slightly overlapping on one plate, with the filling visible at the cut edges. Not a stack of whole tortillas.",
      "Plate it as two or three wedges cut from one quesadilla, lying flat side by side on one plate, filling visible at the cut edges. No whole tortillas and nothing stacked.",
      "Plate it as two wedges cut from one quesadilla, lying flat side by side on one plain plate, filling visible at the cut edges. Nothing else on the plate.",
    ],
    angle: "angled",
    servedCutOrFolded: true,
  },
  {
    name: "tacos",
    unless: OTHER_FORM_OR_PIZZA,
    pattern: /\btacos?\b/i,
    plating: [
      "Plate it as three tacos side by side on one plate, each tortilla folded once around its filling. Nothing stacked.",
      "Plate it as two or three tacos side by side on one plate, each folded once around its filling, lying naturally. Nothing stacked.",
      "Plate it as two tacos side by side on one plain plate, each folded once around its filling. Nothing else on the plate.",
    ],
    angle: "angled",
    servedCutOrFolded: true,
  },
  {
    name: "wrap",
    unless: OTHER_FORM,
    pattern: /\b(burritos?|(?<!lettuce )wraps?|roll[- ]ups?)\b/i,
    plating: [
      "Plate it as one wrap cut in half across the middle, the two halves side by side on one plate with the filling visible at the cut.",
      "Plate it as two wrap halves side by side on one plate, filling visible at the cut. Nothing stacked.",
      "Plate it as two wrap halves side by side on one plain plate. Nothing else on the plate.",
    ],
    angle: "angled",
    servedCutOrFolded: true,
  },
  {
    name: "sandwich",
    unless: OTHER_FORM,
    pattern: /\b(sandwich(es)?|paninis?|melts?|sliders?)\b/i,
    plating: [
      "Plate it as one sandwich cut in half, the halves side by side on one plate with the filling visible at the cut.",
      "Plate it as two sandwich halves side by side on one plate. Nothing stacked.",
      "Plate it as two sandwich halves side by side on one plain plate. Nothing else on the plate.",
    ],
    angle: "angled",
    servedCutOrFolded: true,
  },
  {
    name: "crepes",
    unless: OTHER_FORM,
    pattern: /\bcrepes?\b/i,
    plating: [
      "Plate it as two crepes, each folded into quarters, slightly overlapping on one plate.",
      "Plate it as two crepes folded into quarters, side by side on one plate.",
      "Plate it as one or two crepes folded into quarters on one plain plate. Nothing else on the plate.",
    ],
    angle: "angled",
    servedCutOrFolded: true,
  },
  {
    name: "pancakes",
    unless: OTHER_FORM,
    pattern: /\b(pancakes?|hotcakes?|flapjacks?|waffles?)\b/i,
    plating: [
      "Plate it as a short, level stack of three on one plate, toppings only from the recipe.",
      "Plate it as a short, level stack of two or three on one plate.",
      "Plate it as two lying slightly overlapping on one plain plate, not stacked. Nothing else on the plate.",
    ],
    angle: "angled",
  },
  {
    name: "pieces",
    unless: OTHER_FORM,
    pattern: /\b(cookies?|bars?|brownies?|blondies?|bites|balls|muffins?|cupcakes?|fritters?|patties|nuggets?|tenders?)\b/i,
    plating: [
      "Plate four to six pieces in a loose single layer on one plate or board, not piled up.",
      "Plate three or four pieces in a single layer on one plate, not touching much and not piled up.",
      "Plate two or three pieces side by side on one plain plate. Nothing else on the plate.",
    ],
  },
  {
    name: "flat bake",
    pattern: /\b(pizza|flatbread|focaccia|tart|galette|quiche|pie|frittata)\b/i,
    plating: [
      "Show the whole dish flat on a board or plate, any slices still in place; nothing lifted.",
      "Show the whole dish flat on a plain board or plate, uncut or with slices still in place.",
      "Show the whole dish flat and uncut on a plain board or plate. Nothing else in the frame.",
    ],
    angle: "overhead",
  },
];

const DEFAULT_PLATING: DishStyle["plating"] = [
  "Plate one natural serving on one plate or bowl, or the whole dish in the vessel it is cooked or served in, arranged the way a home cook would serve it.",
  "Plate one simple serving on one plate or bowl, arranged naturally, nothing piled high.",
  "Plate one simple serving on one plain plate or bowl. Nothing else on the plate.",
];

export function dishStyle(recipe: Pick<GeneratedRecipe, "title">): DishStyle | undefined {
  return DISH_STYLES.find((s) => s.pattern.test(recipe.title) && !s.unless?.test(recipe.title));
}

/**
 * Plain, positive instructions for the kinds of problems the checker reports.
 * They are added to the next attempt as things to do, not things to avoid.
 */
const CORRECTIONS: Array<{ pattern: RegExp; fix: string }> = [
  {
    pattern: /\b(stack(s|ed|ing)?|tower(s|ing)?|pil(e|es|ed|ing)|heap(ed)?|layered|tall|leaning)\b/i,
    fix: "Lay every piece flat on the plate, side by side or slightly overlapping; no piece rests on more than one other piece.",
  },
  {
    pattern: /\b(fold(ed)?|roll(ed)?|lift(ed)?|tilt(ed)?|underside|propped|balanc(ed|ing))\b/i,
    fix: "Every piece rests flat and still on the plate; nothing lifted, tilted or propped up.",
  },
  {
    pattern: /\b(geometry|impossible|implausible|unrealistic|unnatural|distorted|melted|merged|duplicat\w*|floating|artifacts?|warped)\b/i,
    fix: "Use fewer, simpler pieces, each with clean, natural edges and a believable shape.",
  },
  {
    pattern: /\b(props?|clutter(ed)?|busy|scattered|too many|garnish(es)?)\b/i,
    fix: "Nothing around the plate: no props, no loose ingredients, no extra garnish.",
  },
  {
    pattern: /\b(utensils?|forks?|knives|knife|spoons?|cutters?|spatulas?)\b/i,
    fix: "No utensils anywhere in the frame.",
  },
  {
    pattern: /\b(parchment|paper)\b/i,
    fix: "No parchment or paper anywhere in the frame.",
  },
];

/** The positive fixes that match earlier checker problems, in a fixed order, without repeats. */
export function compositionCorrections(problems: string[]): string[] {
  return CORRECTIONS.filter((c) => problems.some((p) => c.pattern.test(p))).map((c) => c.fix);
}

export interface PhotoPlan {
  level: SimplifyLevel;
  /** The plating asked for on this attempt. The photo checker gets it too. */
  plating: string;
  angle: CameraAngle;
  /** Whether the writer's free-text photo brief is still used (only on the first attempt). */
  useBrief: boolean;
  /** Scene rules for this level, simplest last. */
  scene: string[];
  corrections: string[];
}

/** The composition for one photo attempt. Attempt 1 is the normal shot; each later one is simpler. */
export function photoPlan(recipe: Pick<GeneratedRecipe, "title">, attempt: number, earlierProblems: string[] = [], defaultAngle: CameraAngle = "angled"): PhotoPlan {
  const level = simplifyLevel(attempt);
  const style = dishStyle(recipe);
  const plating = (style?.plating ?? DEFAULT_PLATING)[level];
  const scene = [
    [
      "Keep the scene simple: one plate or dish, at most two plain props, garnish only from the ingredient list.",
    ],
    [
      "Make it simpler than a styled shoot: one plate on a plain light surface, at most one plain prop (a folded linen napkin), no garnish that is not in the ingredient list, no raw ingredients scattered around.",
    ],
    [
      "Make it as simple as possible: only the one plate on a plain light surface, no props, no garnish, no side dishes, no raw ingredients around it.",
    ],
  ][level];
  return {
    level,
    plating,
    angle: style?.angle ?? defaultAngle,
    useBrief: level === 0,
    scene,
    corrections: compositionCorrections(earlierProblems),
  };
}

/** True when the dish's own served shape is folded or cut, so "nothing folded or cut" must not apply to it. */
export function servedCutOrFolded(recipe: Pick<GeneratedRecipe, "title">): boolean {
  return dishStyle(recipe)?.servedCutOrFolded ?? false;
}
