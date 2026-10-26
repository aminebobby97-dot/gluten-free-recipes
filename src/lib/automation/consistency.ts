// Internal-consistency checks for generated recipes: the ingredient list, the
// steps, the times and the temperatures must agree with each other. These run
// in addition to getPublishReadiness() (completeness, gluten, claims). They are
// heuristics tuned to catch generator mistakes, not a substitute for cooking.

import type { Ingredient, InstructionStep, Recipe } from "@/lib/recipes/types";

export interface ConsistencyIssue {
  severity: "blocking" | "warning";
  field: string;
  message: string;
}

export type ConsistencyInput = Pick<Recipe, "ingredients" | "instructions" | "prep_time" | "cook_time" | "servings">;

/** Words that describe an ingredient rather than name it. */
const DESCRIPTORS = new Set(
  (
    "gluten free gf certified labeled large medium small extra fresh freshly dried ground whole chopped diced minced sliced " +
    "grated shredded melted softened cold warm hot room temperature unsalted salted kosher fine coarse sea light dark packed " +
    "granulated pure plain unsweetened sweetened low sodium reduced fat full boneless skinless ripe frozen thawed canned drained " +
    "rinsed optional finely roughly thinly divided plus more for serving garnish to taste about cup cups tablespoon tablespoons " +
    "teaspoon teaspoons ounce ounces pound pounds gram grams can cans package packages pinch dash all purpose blend mix of and or"
  ).split(" "),
);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("oes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** The words that identify an ingredient, e.g. "baking soda" for "1 tsp baking soda". */
export function ingredientKeywords(ingredient: Pick<Ingredient, "name">): string[] {
  return words(ingredient.name)
    .filter((w) => w.length >= 3 && !DESCRIPTORS.has(w))
    .map(stem);
}

/** Ingredients a step may name, mapped from the word in the step to how it might be listed. */
const COMMON_INGREDIENTS = [
  "egg", "butter", "milk", "cream", "sugar", "salt", "pepper", "flour", "oil", "vanilla", "cinnamon", "cheese", "yogurt",
  "honey", "syrup", "garlic", "onion", "lemon", "lime", "rice", "chicken", "beef", "pork", "bacon", "shrimp", "salmon",
  "tomato", "potato", "carrot", "celery", "spinach", "broth", "stock", "vinegar", "mustard", "parsley", "cilantro", "basil",
  "thyme", "rosemary", "oregano", "paprika", "cumin", "chocolate", "cocoa", "oat", "almond", "walnut", "pecan", "banana",
  "apple", "blueberry", "strawberry", "zucchini", "mushroom", "pasta", "noodle", "tortilla", "bread", "cornstarch",
  "baking powder", "baking soda", "xanthan gum", "yeast",
];

/** Phrases that legitimately refer to several ingredients at once. */
const GROUP_REFERENCE = /\b(all (of )?the ingredients|remaining ingredients|dry ingredients|wet ingredients|everything else|the rest of the)\b/i;

const HEAT_VERBS = /\b(bake|baking|roast|roasting|simmer|simmering|boil|boiling|cook|cooking|fry|frying|saut[eé]|saut[eé]ing|broil|broiling|grill|grilling|toast|toasting|microwave|air[- ]fry|braise|braising|sear|searing|steam|steaming)\b/i;

/** Longest duration mentioned in a sentence, in minutes ("25 to 30 minutes" -> 30). */
export function maxMinutesIn(sentence: string): number {
  let best = 0;
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:to|-|–|or)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?)\b/gi;
  for (const m of sentence.matchAll(re)) {
    const value = Number(m[2] ?? m[1]);
    const minutes = /^h/i.test(m[3]) ? value * 60 : value;
    best = Math.max(best, minutes);
  }
  return best;
}

/** Minutes of active heat described by the steps: the longest heat time in each sentence, summed. */
export function heatMinutes(instructions: InstructionStep[]): number {
  let total = 0;
  for (const step of instructions) {
    for (const sentence of step.text.split(/(?<=[.!?])\s+/)) {
      if (HEAT_VERBS.test(sentence)) total += maxMinutesIn(sentence);
    }
  }
  return total;
}

/** Oven temperatures in °F mentioned in the steps. */
export function ovenTemperaturesF(text: string): number[] {
  return [...text.matchAll(/(\d{3})\s*(?:°\s*F|degrees\s*F(?:ahrenheit)?|ºF|F\b)/gi)].map((m) => Number(m[1]));
}

const SAFE_TEMPS: Array<[RegExp, number, string]> = [
  [/\b(chicken|turkey|duck|poultry)\b/i, 165, "poultry"],
  [/\bground (beef|pork|lamb|veal|meat)\b|\b(meatballs?|burgers?|sausages?)\b/i, 160, "ground meat"],
  [/\b(pork (chops?|tenderloin|loin|shoulder)|steaks?|lamb chops?)\b/i, 145, "whole cuts of pork, beef or lamb"],
];

/** Runs every consistency check. Blocking issues must be fixed before saving. */
export function checkConsistency(recipe: ConsistencyInput): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const block = (field: string, message: string) => issues.push({ severity: "blocking", field, message });
  const warn = (field: string, message: string) => issues.push({ severity: "warning", field, message });

  const steps = recipe.instructions ?? [];
  const stepText = steps.map((s) => s.text).join(" ");
  const stepWords = new Set(words(stepText).map(stem));
  const stepTextLower = ` ${words(stepText).map(stem).join(" ")} `;
  const groupReference = GROUP_REFERENCE.test(stepText);

  // 1. Every listed ingredient is used in a step.
  (recipe.ingredients ?? []).forEach((ingredient, i) => {
    const keys = ingredientKeywords(ingredient);
    if (keys.length === 0) return;
    if (keys.some((k) => stepWords.has(k))) return;
    const message = `"${ingredient.name}" is listed but never used in the steps.`;
    if (groupReference) warn(`ingredients[${i}]`, message);
    else block(`ingredients[${i}]`, message);
  });

  // 2. Common ingredients a step names are in the list.
  const listed = ` ${(recipe.ingredients ?? []).flatMap((i) => words(`${i.name} ${i.note ?? ""}`).map(stem)).join(" ")} `;
  for (const name of COMMON_INGREDIENTS) {
    const needle = ` ${words(name).map(stem).join(" ")} `;
    if (stepTextLower.includes(needle) && !listed.includes(needle)) {
      block("instructions", `The steps use ${name}, which is not in the ingredient list.`);
    }
  }

  // 3. Times add up.
  const heat = heatMinutes(steps);
  if (recipe.cook_time != null) {
    if (recipe.cook_time === 0 && heat > 0) {
      block("cook_time", `The steps cook for about ${heat} minutes but the cook time is 0.`);
    } else if (heat > recipe.cook_time * 1.5 + 10) {
      block("cook_time", `The steps cook for about ${heat} minutes but the cook time is ${recipe.cook_time}.`);
    } else if (heat > recipe.cook_time + 5) {
      warn("cook_time", `The steps cook for about ${heat} minutes; the cook time is ${recipe.cook_time}.`);
    } else if (recipe.cook_time >= 20 && heat > 0 && heat < recipe.cook_time / 3) {
      warn("cook_time", `The cook time is ${recipe.cook_time} minutes but the steps only describe about ${heat}.`);
    }
  }
  if (recipe.prep_time != null && recipe.prep_time < 1 && (recipe.ingredients?.length ?? 0) > 3) {
    warn("prep_time", "A prep time under one minute is unlikely with this many ingredients.");
  }

  // 4. Oven temperatures are stated and plausible. Internal temperatures
  // ("cook to 165°F") are not oven temperatures, so only oven sentences count.
  const ovenSentences = stepText.split(/(?<=[.!?])\s+/).filter((s) => /\b(oven|preheat|bake|roast|broil)\b/i.test(s) && !/\b(internal|thermometer)\b/i.test(s));
  const temps = ovenTemperaturesF(ovenSentences.join(" "));
  if (/\b(preheat|oven)\b/i.test(stepText) && /\b(bake|roast|preheat)\b/i.test(stepText) && temps.length === 0) {
    block("instructions", "The recipe uses the oven but never states the temperature in °F.");
  }
  for (const t of temps) {
    if (t < 200 || t > 550) block("instructions", `${t}°F is not a realistic cooking temperature.`);
  }

  // 5. Food safety: meat recipes state a safe internal temperature.
  const ingredientText = (recipe.ingredients ?? []).map((i) => i.name).join(" ");
  for (const [pattern, temp, label] of SAFE_TEMPS) {
    if (pattern.test(ingredientText) && !new RegExp(`\\b${temp}\\s*(°|degrees|º)`, "i").test(stepText)) {
      block("instructions", `Recipes with ${label} must say to cook it to an internal temperature of ${temp}°F.`);
      break;
    }
  }

  // 6. Servings are sensible.
  if (recipe.servings != null && recipe.servings > 24) warn("servings", `${recipe.servings} servings is unusually many; check the quantities.`);

  return issues;
}
