// Cookware wording checks for gluten-free recipes.
//
// Readers are assumed to cook with clean cookware suitable for gluten-free
// cooking, so ordinary instructions such as "Heat a clean skillet over medium
// heat" need no warning. What must never appear is the false idea that heat,
// preheating, wiping or seasoning removes, kills or destroys gluten. It does
// not: gluten is a protein that survives cooking temperatures, and only
// thorough washing or separate equipment prevents cross-contact.
//
// findGlutenRemovalClaims spots that false claim; repairGlutenRemovalClaims
// removes it from the text in code (no AI call), keeping the rest of the
// instruction. A claim that cannot be removed cleanly stays, and the recipe
// checks report it as a blocking issue for the normal repair step.

/** Something done with heat or a cloth that people wrongly believe cleans gluten away. */
const ACTION =
  /\b(heat|heats|heated|heating|preheat|preheats|preheated|preheating|high heat|hot (?:pan|skillet|oil|oven|grill|griddle|surface)|sear|searing|seasoning|season(?:ed|ing)? (?:the |your )?(?:pan|skillet|cast[- ]iron)|burn(?:s|ing|ed)? (?:it |them )?(?:off|away)|bak(?:e|es|ing) (?:it |them )?off|wip(?:e|es|ed|ing)|rins(?:e|es|ed|ing)|toast(?:ing)?|temperatures?|oven)\b/i;

/** What the claim says happens to the gluten. */
const REMOVAL =
  /\b(remov(?:e|es|ed|ing)|kill(?:s|ed|ing)?|destroy(?:s|ed|ing)?|eliminat(?:e|es|ed|ing)|burn(?:s|ed|ing)? (?:off|away)|bak(?:e|es|ed|ing) off|get(?:s|ting)? rid of|neutraliz(?:e|es|ed|ing)|break(?:s|ing)? down|denatur(?:e|es|ed|ing)|sanitiz(?:e|es|ed|ing)|steriliz(?:e|es|ed|ing)|decontaminat(?:e|es|ed|ing)|clean(?:s|ed|ing)? (?:off|away|out)|takes? care of|deals? with|mak(?:e|es|ing) (?:it|them|the (?:pan|skillet|grill|surface)) (?:safe|gluten[- ]free))\b/i;

/** What is supposedly removed. */
const TARGET = /\b(gluten|wheat|cross[- ]contact|cross[- ]contamination|contaminat\w*|contaminants?)\b/i;

/** "Heat does not destroy gluten" is correct and must not be flagged. */
const NEGATED_REMOVAL =
  /\b(?:not|never|no|cannot|can't|won't|doesn't|don't|isn't|aren't|neither|nor|without)\b(?:\s+\w+){0,4}?\s+(remov|kill|destroy|eliminat|burn|bak|get|neutraliz|break|denatur|sanitiz|steriliz|decontaminat|clean|take|deal|mak)\w*/i;

/** Splits text into sentences, keeping the spacing so the text can be rebuilt. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [text];
}

/** True when one sentence (or clause) claims heat, preheating or wiping gets rid of gluten. */
export function isGlutenRemovalClaim(sentence: string): boolean {
  if (!TARGET.test(sentence) || !REMOVAL.test(sentence)) return false;
  if (NEGATED_REMOVAL.test(sentence)) return false;
  // A claim needs the action too, unless the removal phrase itself is about heat ("burns off gluten").
  return ACTION.test(sentence) || /\b(burn|bak)\w*\s+(?:\w+\s+)?(off|away)\b/i.test(sentence);
}

export interface CookwareFinding {
  field: string;
  phrase: string;
  message: string;
}

export const GLUTEN_REMOVAL_MESSAGE =
  "Heating, preheating, wiping or seasoning does not remove gluten. Remove this claim and simply use clean cookware (for example \"Heat a clean skillet over medium heat\").";

/** Every sentence in a text that claims heat, preheating or wiping removes gluten. */
export function findGlutenRemovalClaims(field: string, text: string | null | undefined): CookwareFinding[] {
  if (!text) return [];
  return sentences(text)
    .filter(isGlutenRemovalClaim)
    .map((s) => ({ field, phrase: s.trim(), message: GLUTEN_REMOVAL_MESSAGE }));
}

const SHARED = /\b(shared|also used for|used for (?:regular|wheat|non[- ]gluten[- ]free))\b/i;

/** Where a sentence can be cut into an instruction and its explanation. */
const CUT = /\s*[,;:\u2013\u2014]\s*|\s+(?=(?:to|so|so that|which|because|as|and|then|this|that|in order to)\s)/g;

/**
 * Rewrites one sentence without the false claim, or returns "" when nothing
 * useful is left. Keeps the instruction and drops only the explanation:
 * "Preheat the pan to burn off any gluten." -> "Preheat the pan."
 * "To kill any gluten, preheat the pan." -> "Preheat the pan."
 */
function repairSentence(sentence: string): string {
  const trailing = sentence.match(/\s*$/)?.[0] ?? "";
  const body = sentence.trim();
  const end = body.match(/[.!?]+$/)?.[0] ?? "";
  const core = body.slice(0, body.length - end.length);
  // Advice about a shared pan is dropped whole: half of it ("wipe your shared skillet") would still mislead.
  const usable = (t: string) => t.split(/\s+/).length >= 3 && !isGlutenRemovalClaim(t) && !TARGET.test(t) && !SHARED.test(t);
  // The part cut away must be the one that talks about removing gluten.
  const explains = (t: string) => TARGET.test(t) && REMOVAL.test(t);
  const finish = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}${end || "."}${trailing}`;

  const cuts = [...core.matchAll(CUT)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  // Keep the longest instruction in front of the claim.
  for (const cut of [...cuts].reverse()) {
    const head = core.slice(0, cut.start).trim();
    if (usable(head) && explains(core.slice(cut.start))) return finish(head);
  }
  // Or the instruction after a leading claim.
  for (const cut of cuts) {
    const tail = core.slice(cut.end).trim().replace(/^(?:and|then|so)\s+/i, "");
    if (usable(tail) && explains(core.slice(0, cut.end))) return finish(tail);
  }
  return "";
}

/**
 * Removes false "heat removes gluten" claims from a text. Returns the new text
 * and what was removed; `text` is unchanged when nothing was found.
 */
export function repairGlutenRemovalText(text: string): { text: string; removed: string[] } {
  const parts = sentences(text);
  const removed: string[] = [];
  const kept = parts.map((s) => {
    if (!isGlutenRemovalClaim(s)) return s;
    removed.push(s.trim());
    return repairSentence(s);
  });
  if (removed.length === 0) return { text, removed };
  return { text: kept.join("").replace(/\s{2,}/g, " ").trim(), removed };
}

/** The recipe fields that hold prose a claim can appear in. */
export interface CookwareText {
  description: string;
  introduction: string;
  storage_instructions: string;
  instructions: Array<{ text: string; group?: string }>;
  tips: string[];
  faq: Array<{ question: string; answer: string }>;
  substitutions: Array<{ original: string; substitute: string; note?: string }>;
}

/** Every false "heat removes gluten" claim in a recipe's prose. */
export function analyzeCookwareClaims(recipe: CookwareText): CookwareFinding[] {
  return [
    ...findGlutenRemovalClaims("description", recipe.description),
    ...findGlutenRemovalClaims("introduction", recipe.introduction),
    ...findGlutenRemovalClaims("storage_instructions", recipe.storage_instructions),
    ...recipe.instructions.flatMap((s, i) => findGlutenRemovalClaims(`instructions[${i}]`, s.text)),
    ...recipe.tips.flatMap((t, i) => findGlutenRemovalClaims(`tips[${i}]`, t)),
    ...recipe.faq.flatMap((f, i) => [...findGlutenRemovalClaims(`faq[${i}].question`, f.question), ...findGlutenRemovalClaims(`faq[${i}].answer`, f.answer)]),
    ...recipe.substitutions.flatMap((s, i) => findGlutenRemovalClaims(`substitutions[${i}]`, `${s.substitute} ${s.note ?? ""}`)),
  ];
}

export interface CookwareRepair {
  field: string;
  removed: string;
}

/**
 * Removes false "heat removes gluten" claims from a recipe in code. A field
 * that would be left empty is not changed (its claim stays and is reported as
 * blocking, so the normal repair step rewrites it). Never touches ingredients.
 */
export function repairGlutenRemovalClaims<T extends CookwareText>(recipe: T): { recipe: T; repairs: CookwareRepair[] } {
  const repairs: CookwareRepair[] = [];
  const fix = (field: string, text: string): string => {
    const out = repairGlutenRemovalText(text);
    if (out.removed.length === 0 || !out.text) return text;
    for (const removed of out.removed) repairs.push({ field, removed });
    return out.text;
  };
  const next: T = {
    ...recipe,
    description: fix("description", recipe.description),
    introduction: fix("introduction", recipe.introduction),
    storage_instructions: fix("storage_instructions", recipe.storage_instructions),
    instructions: recipe.instructions.map((s, i) => ({ ...s, text: fix(`instructions[${i}]`, s.text) })),
    tips: repairTips(recipe.tips, repairs),
    faq: recipe.faq.map((f, i) => ({ ...f, answer: fix(`faq[${i}].answer`, f.answer) })),
    substitutions: recipe.substitutions.map((s, i) => (s.note ? { ...s, note: fix(`substitutions[${i}]`, s.note) } : s)),
  };
  return { recipe: repairs.length ? next : recipe, repairs };
}

/** A tip that was only the false claim is dropped, as long as another tip remains. */
function repairTips(tips: string[], repairs: CookwareRepair[]): string[] {
  const out: string[] = [];
  tips.forEach((tip, i) => {
    const fixed = repairGlutenRemovalText(tip);
    if (fixed.removed.length === 0) return void out.push(tip);
    const othersLeft = out.length > 0 || tips.slice(i + 1).length > 0;
    if (!fixed.text && !othersLeft) return void out.push(tip); // left for the repair step
    for (const removed of fixed.removed) repairs.push({ field: `tips[${i}]`, removed });
    if (fixed.text) out.push(fixed.text);
  });
  return out;
}
