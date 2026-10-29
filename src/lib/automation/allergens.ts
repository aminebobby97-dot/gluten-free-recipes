// Allergen detection for generated recipes. Covers the major US food allergens
// that can appear in a gluten-free recipe (the FDA's nine minus wheat). The
// generator declares allergens; these checks make sure the declaration matches
// the ingredient list.

import type { Ingredient } from "@/lib/recipes/types";

export const ALLERGENS = ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "soy", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  milk: "Milk",
  eggs: "Eggs",
  fish: "Fish",
  shellfish: "Shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  soy: "Soy",
  sesame: "Sesame",
};

/** Words that make a dairy- or egg-like ingredient plant-based. */
const PLANT_BASED = /\b(dairy[- ]free|non[- ]dairy|vegan|plant[- ]based|egg[- ]free)\b/i;

/** Plant "milks", "butters" and "creams" that are not dairy. */
const NOT_DAIRY =
  /\b(coconut|almond|oat|soy|rice|cashew|hemp|pea|flax|peanut|sunflower|seed|nut|cocoa|shea|apple|pumpkin) (milk|butter|cream|yogurt|cheese)\b|\bcream of tartar\b|\bbutternut\b|\bbutter beans?\b/i;

const RULES: Array<[Allergen, RegExp, ((text: string) => boolean)?]> = [
  [
    "milk",
    /\b(milk|butter|buttermilk|cream|cheese|yogurt|yoghurt|ghee|whey|casein|parmesan|mozzarella|cheddar|ricotta|feta|mascarpone|half[- ]and[- ]half|cr[eè]me fra[iî]che)\b/i,
    (text) => PLANT_BASED.test(text) || NOT_DAIRY.test(text),
  ],
  ["eggs", /\b(eggs?|egg (whites?|yolks?)|yolks?|mayonnaise|mayo|meringue)\b/i, (text) => PLANT_BASED.test(text) || /\bflax ?eggs?\b|\beggplant\b/i.test(text)],
  ["fish", /\b(fish|salmon|tuna|cod|tilapia|halibut|haddock|trout|sardines?|anchov(y|ies)|mahi[- ]mahi|snapper|mackerel|catfish|pollock|swordfish|worcestershire)\b/i],
  ["shellfish", /\b(shrimp|prawns?|crabs?|crabmeat|lobsters?|scallops?|clams?|mussels?|oysters?|crawfish|crayfish|langoustines?)\b/i],
  [
    "tree_nuts",
    /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?|chestnuts?|praline|marzipan|nutella)\b/i,
  ],
  ["peanuts", /\b(peanuts?|peanut butter|peanut oil)\b/i],
  ["soy", /\b(soy|soya|soybeans?|tofu|tamari|edamame|miso|tempeh)\b/i],
  ["sesame", /\b(sesame|tahini|furikake)\b/i],
];

/** Allergens that appear in one ingredient's name or note. */
export function allergensInIngredient(ingredient: Pick<Ingredient, "name" | "note">): Allergen[] {
  const text = [ingredient.name, ingredient.note].filter(Boolean).join(" ");
  const found: Allergen[] = [];
  for (const [allergen, pattern, exempt] of RULES) {
    if (!pattern.test(text)) continue;
    if (exempt && exempt(text)) continue;
    found.push(allergen);
  }
  return found;
}

/** Allergens found in the ingredient list, in the canonical order. */
export function detectAllergens(ingredients: Array<Pick<Ingredient, "name" | "note">>): Allergen[] {
  const found = new Set(ingredients.flatMap(allergensInIngredient));
  return ALLERGENS.filter((a) => found.has(a));
}

/** Words that tell a reader a suggestion adds an allergen. */
const ALLERGY_NOTE = /\ballerg(y|ies|en|ens|ic)\b|\b(tree[- ]nut|peanut)[- ]free\b|\bnut[- ]free\b/i;

/** Allergens readers can add through optional suggestions. Kept to nuts, where a missed note is most dangerous. */
const OPTIONAL_ALLERGENS: Allergen[] = ["tree_nuts", "peanuts"];

export interface OptionalAllergenText {
  field: string;
  text: string;
}

/**
 * Nuts suggested in the FAQ, tips or substitutions ("add chopped walnuts")
 * that the allergen list does not declare. Each such suggestion must say, in
 * the same item, that it adds an allergen, because the declared list only
 * covers the main ingredients.
 */
export function undeclaredOptionalAllergens(declared: readonly string[], texts: OptionalAllergenText[]): AllergenIssue[] {
  const issues: AllergenIssue[] = [];
  for (const { field, text } of texts) {
    for (const allergen of allergensInIngredient({ name: text, note: "" })) {
      if (!OPTIONAL_ALLERGENS.includes(allergen) || declared.includes(allergen) || ALLERGY_NOTE.test(text)) continue;
      issues.push({
        severity: "blocking",
        allergen,
        message: `${field} suggests ${ALLERGEN_LABELS[allergen].toLowerCase()}, which the allergen list does not include. Say in the same answer that they add a ${ALLERGEN_LABELS[allergen].toLowerCase().replace(/s$/, "")} allergen.`,
      });
    }
  }
  return issues;
}

export interface AllergenIssue {
  severity: "blocking" | "warning";
  allergen: Allergen;
  message: string;
}

/**
 * Compares declared allergens with the ingredient list. Missing a detected
 * allergen blocks publishing; declaring one that was not detected is only a
 * warning, because over-declaring is the safe direction.
 */
export function compareAllergens(declared: readonly string[], ingredients: Array<Pick<Ingredient, "name" | "note">>): AllergenIssue[] {
  const detected = detectAllergens(ingredients);
  const issues: AllergenIssue[] = [];
  for (const allergen of detected) {
    if (!declared.includes(allergen)) {
      const sources = ingredients.filter((i) => allergensInIngredient(i).includes(allergen)).map((i) => i.name);
      issues.push({
        severity: "blocking",
        allergen,
        message: `Contains ${ALLERGEN_LABELS[allergen].toLowerCase()} (${sources.join(", ")}) but it is not declared.`,
      });
    }
  }
  for (const allergen of declared) {
    if (!(ALLERGENS as readonly string[]).includes(allergen)) {
      issues.push({ severity: "blocking", allergen: allergen as Allergen, message: `"${allergen}" is not a recognized allergen.` });
    } else if (!detected.includes(allergen as Allergen)) {
      issues.push({
        severity: "warning",
        allergen: allergen as Allergen,
        message: `${ALLERGEN_LABELS[allergen as Allergen]} is declared but no ingredient appears to contain it.`,
      });
    }
  }
  return issues;
}
