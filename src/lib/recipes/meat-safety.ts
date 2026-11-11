// Safe internal cooking temperatures for meat, checked and (only when the meat
// is known for certain) corrected in code.
//
// The temperatures follow USDA guidance:
// - poultry, including ground turkey, ground chicken and poultry sausages
//   (turkey or chicken sausage, also "fully cooked" ones that are reheated):
//   165°F (74°C);
// - ground beef, lamb, veal and other ground red meat, including their
//   sausages, burgers and meatballs: 160°F (71°C);
// - a sausage or mixture of poultry and red meat ("chicken and beef sausage"):
//   the higher temperature, 165°F (74°C);
// - whole cuts of beef, lamb or veal (steaks, chops): 145°F (63°C).
// Pork is never in a recipe (see dietary.ts), so it has no rule here.
//
// Before November 11, 2026 the check had one "ground meat" rule that matched
// any "sausage" and asked for 160°F. A turkey sausage recipe that correctly
// said 165°F was failed for not saying 160°F, and no repair could satisfy it
// without writing an unsafe temperature. Here each ingredient is classified
// first (poultry wins), so a turkey sausage only ever needs 165°F.
//
// Nothing here ever lowers a temperature, and a temperature is only changed in
// code when the ingredient list says exactly which meat it is. A meat the list
// does not name ("sausage", "ground meat") is never guessed: it blocks, and the
// AI repair names the meat.

export type MeatClass = "poultry" | "ground" | "whole";

export const SAFE_TEMPERATURES: Record<MeatClass, { f: number; c: number; what: string }> = {
  poultry: { f: 165, c: 74, what: "poultry (chicken, turkey, ground chicken or turkey, and chicken or turkey sausage)" },
  ground: { f: 160, c: 71, what: "ground beef, lamb or veal (and their sausages, burgers and meatballs)" },
  whole: { f: 145, c: 63, what: "whole cuts of beef, lamb or veal" },
};

/** The rule the writer and reviewer prompts quote, so every step agrees on the same numbers. */
export const SAFE_TEMPERATURE_RULES = [
  "Ground turkey, ground chicken, chicken or turkey sausage (including fully cooked ones), and all other chicken, turkey or duck: 165°F (74°C).",
  "Ground beef, lamb or veal, and beef or lamb sausages, burgers and meatballs: 160°F (71°C).",
  "A sausage or mixture that contains poultry and red meat (for example chicken and beef sausage): 165°F (74°C).",
  "Whole cuts of beef, lamb or veal (steaks, chops): at least 145°F (63°C), then rest 3 minutes.",
];

const POULTRY_WORDS = "chicken|turkey|duck|goose|poultry|hens?|quail|pheasant";
const RED_WORDS = "beef|lamb|veal|bison|buffalo|venison|goat|mutton|elk";
const POULTRY = new RegExp(`\\b(?:${POULTRY_WORDS})\\b`, "i");
const RED = new RegExp(`\\b(?:${RED_WORDS})\\b`, "i");
const HAMBURGER = /\bhamburgers?\b/i;
const GROUND_FORM = /\b(?:ground|minced?|sausages?|burgers?|patty|patties|meatballs?|meatloaf|kofta|kebabs?|links?)\b/i;
const WHOLE_FORM = /\b(?:steaks?|chops?|tenderloin|sirloin|ribeye|rib[- ]eye|filet mignon)\b/i;
const STEAK = /\b(?:steaks?|sirloin|ribeye|rib[- ]eye|filet mignon)\b/i;
/** Products named after a meat that are not meat to cook: "chicken broth", "beef gelatin". */
const NON_MEAT_PRODUCT = new RegExp(
  `\\b(?:${POULTRY_WORDS}|${RED_WORDS}|meat)[- ](?:broth|stock|bouillon|base|gravy|gelatine?|fat|drippings|flavou?r(?:ed|ing)?|seasoning|jerky)\\b`,
  "gi",
);
/** Ingredients that only sound like meat: buns, seasonings, plant-based and fish versions. */
const NOT_A_MEAT =
  /\b(?:buns?|rolls?|seasoning|spice|rub|veggie|vegan|vegetarian|plant[- ]based|meatless|tofu|tempeh|jackfruit|beans?|lentils?|mushrooms?|portobello|cauliflower|cabbage|eggplant|coconut|crab|lobster|salmon|tuna|swordfish|halibut|cod|fish)\b/i;
/** A meat the name does not identify. */
const GENERIC_MEAT = /\b(?:ground|minced) meat\b|\bmince\b|\bsausages?\b|\bburgers?\b|\bpatty\b|\bpatties\b|\bmeatballs?\b|\bmeatloaf\b|\bmeat\b/i;

export interface MeatItem {
  /** "ingredients[3]" */
  field: string;
  name: string;
  /** null when the name does not say which meat it is (blocks; never guessed). */
  cls: MeatClass | null;
  /** How the recipe should call it in a sentence: "turkey sausage", "ground beef". */
  label: string;
  /** Species words in the name, used to match sentences: ["turkey"]. */
  species: string[];
}

function speciesIn(text: string): string[] {
  const found = text.toLowerCase().match(new RegExp(`\\b(?:${POULTRY_WORDS}|${RED_WORDS})\\b`, "gi")) ?? [];
  return [...new Set(found.map((w) => w.toLowerCase()))];
}

/** What kind of meat one ingredient is, or null when it is not a meat to cook. */
export function classifyMeat(name: string): Omit<MeatItem, "field"> | null {
  const text = name.replace(NON_MEAT_PRODUCT, " ").replace(/\s+/g, " ").trim();
  const species = speciesIn(text);
  const poultry = POULTRY.test(text);
  const red = RED.test(text) || (HAMBURGER.test(text) && !/\bbuns?\b/i.test(text));
  const sausage = /\bsausages?\b|\blinks?\b/i.test(text);
  const ground = /\b(?:ground|minced?)\b/i.test(text);
  const form = sausage ? " sausage" : "";
  const prefix = ground && !sausage ? "ground " : "";
  if (poultry) {
    // Poultry alone, or poultry mixed with red meat: the higher temperature.
    return { name, cls: "poultry", label: `${prefix}${species.join(" and ")}${form}`, species };
  }
  if (red) {
    const reds = species.length ? species : ["beef"];
    if (GROUND_FORM.test(text) || HAMBURGER.test(text)) return { name, cls: "ground", label: `${prefix}${reds.join(" and ")}${form}`, species: reds };
    if (WHOLE_FORM.test(text)) return { name, cls: "whole", label: `${reds.join(" and ")}`, species: reds };
    return null; // stew meat, roasts, braises: cooked until tender, no fixed rule here
  }
  if (NOT_A_MEAT.test(text)) return null;
  if (STEAK.test(text)) return { name, cls: "whole", label: "steak", species: ["beef", "steak"] };
  if (GENERIC_MEAT.test(text)) return { name, cls: null, label: text.toLowerCase(), species: [] };
  return null;
}

/** Every meat in the ingredient list, classified. */
export function meatItems(ingredients: Array<{ name: string }>): MeatItem[] {
  const out: MeatItem[] = [];
  ingredients.forEach((ing, i) => {
    const item = classifyMeat(ing.name);
    if (item) out.push({ ...item, field: `ingredients[${i}]` });
  });
  return out;
}

// --- Temperatures in text ------------------------------------------------------

/** "165°F", "165 °F", "165 degrees F", "165°" with an optional "(74°C)" after it. */
const TEMP = /(?<![\d.])(\d{2,3})(\s*(?:°|º|degrees)\s*(?:F(?:ahrenheit)?\b)?|\s*F\b)(?!\s*C\b)(\s*\(\s*(\d{2,3})\s*(?:°|º|degrees)\s*C(?:elsius)?\s*\))?/gi;

/** Internal (not oven) temperatures are below 200°F. */
const isInternal = (f: number) => f >= 100 && f < 200;

/** Words that tie a sentence without a species word to the meat. */
const MEAT_CONTEXT = /\b(?:meat|sausages?|links?|patty|patties|burgers?|meatballs?|meatloaf|internal|thermometer|thickest|cooked through|no longer pink)\b/i;
/** Other things a temperature can be about; such a sentence is never attributed to the meat. */
const OTHER_SUBJECT = /\b(?:eggs?|egg dishes|frittata|quiche|custard|casserole|leftovers?|reheat(?:ed|ing)?|oil|milk|water|butter|sugar|syrup|caramel|chocolate|yeast|bread|loaf|cake)\b/i;

interface TempMention {
  f: number;
  c: number | null;
  start: number;
  end: number;
  text: string;
}

function temperatures(sentence: string): TempMention[] {
  return [...sentence.matchAll(TEMP)]
    .map((m) => ({ f: Number(m[1]), c: m[4] ? Number(m[4]) : null, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }))
    .filter((t) => isInternal(t.f));
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/);

/**
 * The meat classes a sentence talks about. A species word ("turkey") picks the
 * classes of the listed meats of that species. Without one, the sentence is
 * only attributed to the meat when the recipe has a single kind of meat and the
 * sentence is clearly about cooking it ("the sausage", "internal temperature").
 */
function sentenceClasses(sentence: string, items: MeatItem[], allowFallback: boolean): MeatClass[] {
  const classes = new Set<MeatClass>();
  const words = speciesIn(sentence);
  if (HAMBURGER.test(sentence)) words.push("beef");
  if (STEAK.test(sentence)) words.push("steak");
  for (const w of words) {
    const matching = items.filter((i) => i.cls && i.species.includes(w));
    if (matching.length) for (const i of matching) classes.add(i.cls!);
    else if (POULTRY.test(w)) classes.add("poultry");
  }
  if (classes.size > 0 || words.length > 0) return [...classes];
  if (!allowFallback || OTHER_SUBJECT.test(sentence) || !MEAT_CONTEXT.test(sentence)) return [];
  const known = new Set(items.map((i) => i.cls));
  if (known.size !== 1 || known.has(null)) return [];
  return [...known] as MeatClass[];
}

const celsiusOf = (f: number) => Math.round(((f - 32) * 5) / 9);
const tempText = (cls: MeatClass) => `${SAFE_TEMPERATURES[cls].f}°F (${SAFE_TEMPERATURES[cls].c}°C)`;

// --- Checking ----------------------------------------------------------------

export interface MeatSafetyIssue {
  severity: "blocking" | "warning";
  field: string;
  message: string;
  /** For the AI repair step: what exactly to write. */
  hint?: string;
}

/** The recipe text this module reads and corrects. */
export interface MeatSafetyText {
  ingredients: Array<{ name: string }>;
  instructions: Array<{ text: string }>;
  tips?: string[];
  faq?: Array<{ question: string; answer: string }>;
  substitutions?: Array<{ original: string; substitute: string; note?: string | null }>;
  storage_instructions?: string | null;
  description?: string | null;
  introduction?: string | null;
}

/** Every prose field that can state a temperature, with its field name. */
function textFields(recipe: MeatSafetyText): Array<{ field: string; text: string }> {
  return [
    ...recipe.instructions.map((s, i) => ({ field: `instructions[${i}]`, text: s.text })),
    ...(recipe.tips ?? []).map((t, i) => ({ field: `tips[${i}]`, text: t })),
    ...(recipe.faq ?? []).map((f, i) => ({ field: `faq[${i}]`, text: `${f.question} ${f.answer}` })),
    ...(recipe.substitutions ?? []).map((s, i) => ({ field: `substitutions[${i}]`, text: `${s.substitute} ${s.note ?? ""}` })),
    ...(recipe.storage_instructions ? [{ field: "storage_instructions", text: recipe.storage_instructions }] : []),
    ...(recipe.description ? [{ field: "description", text: recipe.description }] : []),
    ...(recipe.introduction ? [{ field: "introduction", text: recipe.introduction }] : []),
  ];
}

/** True when the steps state a safe internal temperature for this meat. */
function covered(item: MeatItem, items: MeatItem[], instructions: Array<{ text: string }>): boolean {
  const need = SAFE_TEMPERATURES[item.cls!].f;
  const stepText = instructions.map((s) => s.text).join(" ");
  // The exact temperature anywhere in the steps (the original rule).
  if (new RegExp(`(?<![\\d.])${need}\\s*(?:°|º|degrees)`, "i").test(stepText)) return true;
  // Or a sentence about this meat that states at least that temperature.
  for (const sentence of instructions.flatMap((s) => sentencesOf(s.text))) {
    const temps = temperatures(sentence);
    if (temps.length === 0) continue;
    if (!sentenceClasses(sentence, items, true).includes(item.cls!)) continue;
    if (temps.some((t) => t.f >= need)) return true;
  }
  return false;
}

const hintFor = (item: MeatItem) =>
  `${capitalize(item.label)} ${item.cls === "poultry" ? "is poultry and" : ""} must reach ${tempText(item.cls!)}. State "${tempText(item.cls!)}" in the step that cooks it, and use exactly the same temperature wherever the tips, FAQ or substitutions mention it. Never use a lower temperature${item.cls === "poultry" ? " such as 160°F, which is for ground beef, not poultry" : ""}.`.replace(/\s+/g, " ");

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Food-safety checks for meat:
 * - a meat the ingredient list does not identify blocks (its temperature cannot be verified);
 * - every identified meat needs its safe internal temperature in the steps;
 * - no step, tip, FAQ answer or substitution may give that meat a lower temperature;
 * - a Celsius value next to a Fahrenheit one must match it.
 */
export function checkMeatSafety(recipe: MeatSafetyText): MeatSafetyIssue[] {
  const issues: MeatSafetyIssue[] = [];
  const items = meatItems(recipe.ingredients ?? []);
  const unknown = items.filter((i) => i.cls === null);
  const known = items.filter((i) => i.cls !== null);

  for (const item of unknown) {
    issues.push({
      severity: "blocking",
      field: item.field,
      message: `"${item.name}" does not say what meat it is, so its safe internal temperature cannot be checked.`,
      hint: `Name the meat, for example "ground turkey" or "turkey sausage" (cooked to 165°F (74°C)) or "ground beef" or "beef sausage" (cooked to 160°F (71°C)), the same way in every section, and state that temperature in the step that cooks it.`,
    });
  }

  // Missing temperatures: one issue per kind of meat.
  const reported = new Set<MeatClass>();
  for (const item of known) {
    if (reported.has(item.cls!) || covered(item, items, recipe.instructions ?? [])) continue;
    reported.add(item.cls!);
    const { f, c } = SAFE_TEMPERATURES[item.cls!];
    const label = item.cls === "poultry" ? `poultry (${item.label})` : item.cls === "ground" ? `ground meat (${item.label})` : `whole cuts of beef, lamb or veal (${item.label})`;
    issues.push({ severity: "blocking", field: "instructions", message: `Recipes with ${label} must say to cook it to an internal temperature of ${f}°F (${c}°C).`, hint: hintFor(item) });
  }

  // Unsafe or inconsistent temperatures, in every section.
  for (const { field, text } of textFields(recipe)) {
    for (const sentence of sentencesOf(text)) {
      const temps = temperatures(sentence);
      if (temps.length === 0) continue;
      for (const t of temps) {
        if (t.c !== null && Math.abs(t.c - celsiusOf(t.f)) > 1) {
          issues.push({ severity: "blocking", field, message: `${t.f}°F is ${celsiusOf(t.f)}°C, not ${t.c}°C ("${t.text.trim()}").`, hint: `Write ${t.f}°F (${celsiusOf(t.f)}°C).` });
        }
      }
      if (OTHER_SUBJECT.test(sentence) && !speciesIn(sentence).length) continue;
      const classes = sentenceClasses(sentence, known, unknown.length === 0).filter((c) => c !== "whole");
      if (classes.length === 0) continue;
      // With two kinds of meat in one sentence, only a temperature below both is certainly wrong.
      const need = Math.min(...classes.map((c) => SAFE_TEMPERATURES[c].f));
      const cls = classes.find((c) => SAFE_TEMPERATURES[c].f === need)!;
      for (const t of temps) {
        if (t.f >= need) continue;
        const item = known.find((i) => i.cls === cls);
        issues.push({
          severity: "blocking",
          field,
          message: `Unsafe temperature: ${t.f}°F is too low for ${item ? item.label : SAFE_TEMPERATURES[cls].what}; ${SAFE_TEMPERATURES[cls].what} must reach ${tempText(cls)}.`,
          hint: item ? hintFor(item) : `Use ${tempText(cls)}.`,
        });
      }
    }
  }
  return issues;
}

// --- Correcting in code ---------------------------------------------------------

export interface MeatTemperatureFix {
  field: string;
  from: string;
  to: string;
  reason: string;
}

/**
 * Corrects safe-temperature problems in code, only where the meat type is
 * certain:
 * - a temperature lower than the meat's safe temperature, in a sentence that
 *   names that meat (or, when the recipe has exactly one kind of meat, a
 *   sentence clearly about cooking it), is raised to the safe temperature, in
 *   steps, tips, FAQ, substitutions and storage notes alike;
 * - a Celsius value that does not match the Fahrenheit next to it is corrected
 *   to match;
 * - a missing safe temperature is added to the step that cooks that meat.
 * Nothing is changed when the ingredient list has a meat it does not identify,
 * when a sentence mixes two kinds of meat, or when no step clearly cooks it:
 * those stay blocking for the AI repair. A temperature is never lowered.
 */
export function repairMeatTemperatures<T extends MeatSafetyText>(recipe: T): { recipe: T; fixes: MeatTemperatureFix[] } {
  const items = meatItems(recipe.ingredients ?? []);
  if (items.length === 0 || items.some((i) => i.cls === null)) return { recipe, fixes: [] };
  const fixes: MeatTemperatureFix[] = [];

  const fixText = (field: string, text: string): string =>
    sentencesOf(text)
      .map((sentence) => {
        let temps = temperatures(sentence);
        if (temps.length === 0) return sentence;
        let out = sentence;
        // Celsius that does not match its Fahrenheit.
        for (const t of [...temps].reverse()) {
          if (t.c === null || Math.abs(t.c - celsiusOf(t.f)) <= 1) continue;
          const to = `${t.f}°F (${celsiusOf(t.f)}°C)`;
          out = out.slice(0, t.start) + to + out.slice(t.end);
          fixes.push({ field, from: t.text.trim(), to, reason: `${t.f}°F is ${celsiusOf(t.f)}°C.` });
        }
        temps = temperatures(out);
        if (OTHER_SUBJECT.test(out) && !speciesIn(out).length) return out;
        const classes = sentenceClasses(out, items, true).filter((c) => c !== "whole");
        if (classes.length !== 1) return out; // no meat, or two kinds of meat: not certain
        const cls = classes[0];
        const item = items.find((i) => i.cls === cls)!;
        for (const t of [...temps].reverse()) {
          if (t.f >= SAFE_TEMPERATURES[cls].f) continue;
          const to = tempText(cls);
          out = out.slice(0, t.start) + to + out.slice(t.end);
          fixes.push({
            field,
            from: t.text.trim(),
            to,
            reason: `${capitalize(item.label)} ${cls === "poultry" ? "is poultry; poultry" : "is ground meat; it"} must reach ${to}.`,
          });
        }
        return out;
      })
      .join(" ");

  // Keep each field's own whitespace when nothing in it changed.
  const fix = (field: string, text: string) => {
    const before = fixes.length;
    const out = fixText(field, text);
    return fixes.length === before ? text : out;
  };

  let instructions = recipe.instructions.map((s, i) => ({ ...s, text: fix(`instructions[${i}]`, s.text) }));
  const tips = recipe.tips?.map((t, i) => fix(`tips[${i}]`, t));
  const faq = recipe.faq?.map((f, i) => ({ ...f, question: fix(`faq[${i}]`, f.question), answer: fix(`faq[${i}]`, f.answer) }));
  const substitutions = recipe.substitutions?.map((s, i) => ({ ...s, substitute: fix(`substitutions[${i}]`, s.substitute), ...(s.note ? { note: fix(`substitutions[${i}]`, s.note) } : {}) }));
  const storage = recipe.storage_instructions ? fix("storage_instructions", recipe.storage_instructions) : recipe.storage_instructions;

  // Missing temperatures: added to the first step that cooks that meat by name
  // (where it is cooked raw), never guessed when no step does.
  const HEAT = /\b(?:cook|cooking|brown|browning|fry|frying|saut[eé]|saut[eé]ing|sear|searing|bake|baking|roast|roasting|grill|grilling|broil|broiling|simmer|simmering|crumble)\b/i;
  const done = new Set<MeatClass>();
  for (const item of items) {
    const cls = item.cls!;
    if (done.has(cls) || covered(item, items, instructions)) continue;
    done.add(cls);
    const names = [...item.species, ...(item.label.includes("sausage") ? ["sausage"] : [])];
    const single = new Set(items.map((i) => i.cls)).size === 1;
    let target = -1;
    instructions.forEach((s, i) => {
      const lower = s.text.toLowerCase();
      const named = names.some((n) => new RegExp(`\\b${n}`, "i").test(lower));
      // In a recipe with two kinds of meat, the step must name this one and no other species.
      const others = speciesIn(lower).filter((w) => !item.species.includes(w));
      if (target === -1 && named && HEAT.test(lower) && (single || others.length === 0)) target = i;
    });
    if (target === -1) continue;
    const sentence = `The ${item.label} is done when it reaches ${tempText(cls)} on an instant-read thermometer.`;
    const field = `instructions[${target}]`;
    instructions = instructions.map((s, i) => (i === target ? { ...s, text: `${s.text.trim().replace(/([^.!?])$/, "$1.")} ${sentence}` } : s));
    fixes.push({ field, from: "", to: sentence, reason: `The steps never said the safe internal temperature for ${item.label}.` });
  }

  if (fixes.length === 0) return { recipe, fixes };
  return {
    recipe: {
      ...recipe,
      instructions,
      ...(tips ? { tips } : {}),
      ...(faq ? { faq } : {}),
      ...(substitutions ? { substitutions } : {}),
      ...(storage !== undefined ? { storage_instructions: storage } : {}),
    },
    fixes,
  };
}
