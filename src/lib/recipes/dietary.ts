// Pork-free and alcohol-free rule for AI-generated recipes.
//
// Every AI-generated recipe on the site must be free from pork, pork-derived
// ingredients and intentionally added alcohol. The writer's prompt says so,
// but a prompt is not a guarantee, so this deterministic check runs on every
// generated recipe before it can be saved or published. It scans every text
// field a reader sees (title, ingredients, steps, substitutions, tips, FAQ...)
// and the photo brief.
//
// It never edits a recipe. A recipe that fails is rejected with a reason, and
// the pipeline's normal repair round and retry limits decide what happens next.
//
// The rule is strict on purpose: a recipe should not mention pork or alcohol
// at all, not even to say "instead of wine". Non-alcoholic substitutes are
// allowed only when they say so right before the word ("alcohol-free vanilla
// extract", "non-alcoholic red wine") and, in the ingredient list and in
// suggestions, tell the reader to check the label.

/** "condiment": soy sauce and similar sauces not labeled both gluten-free and alcohol-free. */
export type DietaryCategory = "pork" | "alcohol" | "condiment";

export interface DietaryViolation {
  field: string;
  category: DietaryCategory;
  /** The prohibited ingredient, in plain words ("bacon", "wine"). */
  term: string;
  /** The text that matched, as written in the recipe. */
  match: string;
  message: string;
}

interface Rule {
  category: DietaryCategory;
  term: string;
  pattern: RegExp;
  /** Text right before the match that makes it harmless ("root" beer, "sugar" alcohol). Anchored to the end. */
  allowBefore?: RegExp;
  /** Text right after the match that makes it harmless (wine "vinegar", scotch "bonnet"). Anchored to the start. */
  allowAfter?: RegExp;
  /** A qualifier that, written just before the match, makes it an allowed substitute ("turkey" bacon). */
  substitute?: RegExp;
  /** The substitute also has to tell the reader to check the label (non-alcoholic drinks and extracts). */
  needsLabel?: boolean;
}

/** Words that make a drink or flavoring a non-alcoholic product. */
const NON_ALCOHOLIC = /alcohol[- ]free|non[- ]?alcoholic|zero[- ]proof|de[- ]?alcoholi[sz]ed|0(?:\.0)?\s?%(?:\s?abv)?/;
/** Same, plus glycerin-based flavorings, which are made without alcohol. */
const NON_ALCOHOLIC_FLAVOR = new RegExp(`${NON_ALCOHOLIC.source}|glycerine?[- ]based`);
/** Words that make a usually-pork product a non-pork one ("turkey bacon", "beef pepperoni"). */
const NOT_PORK = /turkey|chicken|beef|lamb|veal|duck|halal|vegan|vegetarian|plant[- ]based|meatless|veggie|tofu|tempeh|mushroom|coconut|soy|fish|bovine/;
/** Gelatin and marshmallows: beef, fish or plant-based versions are fine. */
const NOT_PORK_GELATIN = /beef|bovine|fish|halal|vegan|plant[- ]based|agar|gelatin[- ]free|gelatine[- ]free/;

const FLAVORS =
  "vanilla|almond|lemon|orange|lime|peppermint|mint|spearmint|coconut|maple|anise|coffee|banana|cherry|raspberry|strawberry|rose|hazelnut|butter|chocolate|caramel|pistachio|rum|brandy|bourbon|amaretto";

const RULES: Rule[] = [
  // --- Pork -------------------------------------------------------------------
  { category: "pork", term: "pork", pattern: /\bpork\b/gi },
  { category: "pork", term: "bacon", pattern: /\bbacon\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "ham", pattern: /\bhams?\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "pancetta", pattern: /\bpancetta\b/gi },
  { category: "pork", term: "prosciutto", pattern: /\bprosciutto\b/gi },
  { category: "pork", term: "guanciale", pattern: /\bguanciale\b/gi },
  { category: "pork", term: "lard", pattern: /\blard(?:ons?|o)?\b/gi },
  { category: "pork", term: "pork sausage", pattern: /\bsausages?\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "pork sausage", pattern: /\b(?:bratwursts?|kielbasa|andouille|frankfurters?|wieners?|bologna|hot dogs?)\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "chorizo", pattern: /\bchorizo\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "pepperoni", pattern: /\bpepperoni\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "salami", pattern: /\bsalami\b/gi, substitute: NOT_PORK },
  { category: "pork", term: "cured pork", pattern: /\b(?:mortadella|capicola|capocollo|coppa|jam[oó]n|soppressata|lardo|nduja|'nduja|speck(?! of))\b/gi },
  { category: "pork", term: "pork", pattern: /\b(?:pigs?|piglets?|hogs?|swine|(?:wild )?boar|gammon|trotters?|chitterlings|scrapple|carnitas|char siu|tonkotsu|lech[oó]n|spam)\b/gi },
  { category: "pork", term: "XO sauce (made with ham)", pattern: /\bXO sauce\b/gi },
  { category: "pork", term: "pork fat", pattern: /\b(?:fatback|caul fat|cracklings?|chicharr[oó]n(?:es)?|pork rinds?)\b/gi },
  { category: "pork", term: "pork ribs", pattern: /\b(?:spare ?ribs|baby[- ]back ribs|st\.? louis[- ]style ribs)\b/gi, substitute: /beef|lamb/ },
  { category: "pork", term: "pork-derived gelatin", pattern: /\bgelatine?\b/gi, substitute: NOT_PORK_GELATIN },
  { category: "pork", term: "pork-derived gelatin", pattern: /\b(?:marshmallows?|marshmallow (?:fluff|creme|cream)|jell-?o)\b/gi, substitute: NOT_PORK_GELATIN },

  // --- Alcohol ----------------------------------------------------------------
  { category: "alcohol", term: "wine", pattern: /\bwines?\b/gi, allowAfter: /^\s+vinegars?\b/i, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "sherry", pattern: /\bsherry\b/gi, allowAfter: /^\s+vinegars?\b/i, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "champagne", pattern: /\bchampagne\b/gi, allowAfter: /^\s+vinegars?\b/i, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "wine", pattern: /\b(?:marsala|vermouth|prosecco|sangria|(?:ruby|tawny) port)\b/gi, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "wine", pattern: /\bmadeira\b/gi, allowAfter: /^\s+cakes?\b/i },
  { category: "alcohol", term: "beer", pattern: /\bbeers?\b/gi, allowBefore: /\broot\s+$/i, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "beer", pattern: /\b(?:ales?|lagers?|stouts?|porters?|pilsners?|ipas?)\b/gi, allowBefore: /\bginger\s+$/i, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "hard cider", pattern: /\bhard (?:cider|seltzer|lemonade)\b/gi },
  { category: "alcohol", term: "rum", pattern: /\brums?\b/gi, substitute: NON_ALCOHOLIC_FLAVOR, needsLabel: true },
  { category: "alcohol", term: "vodka", pattern: /\bvodka\b/gi },
  { category: "alcohol", term: "brandy", pattern: /\b(?:brandy|cognac|armagnac|calvados|grappa|pisco|kirsch(?:wasser)?)\b/gi, substitute: NON_ALCOHOLIC_FLAVOR, needsLabel: true },
  { category: "alcohol", term: "whiskey", pattern: /\b(?:whiske?y|whiskies|whiskeys)\b/gi },
  { category: "alcohol", term: "bourbon", pattern: /\bbourbon\b/gi, allowAfter: /^\s+vanilla\b/i, substitute: NON_ALCOHOLIC_FLAVOR, needsLabel: true },
  { category: "alcohol", term: "scotch", pattern: /\bscotch\b/gi, allowAfter: /^\s+(?:bonnets?|eggs?)\b/i },
  { category: "alcohol", term: "spirits", pattern: /\b(?:gin|tequila|mezcal|soju|shochu|baijiu|ouzo|sambuca|absinthe|schnapps|cacha[cç]a|mead)\b/gi },
  // "for the sake of" is not rice wine.
  { category: "alcohol", term: "sake", pattern: /\bsake\b/gi, allowBefore: /\bfor (?:the |goodness'? ?s? |heaven'? ?s? |pete'? ?s? |old times'? )?$/i },
  { category: "alcohol", term: "rice wine", pattern: /\b(?:mirin|shaoxing|shao hsing)\b/gi, substitute: NON_ALCOHOLIC, needsLabel: true },
  {
    category: "alcohol",
    term: "liqueur",
    pattern: /\b(?:liqueurs?|liquors?|amaretto|kahl[uú]a|baileys|grand marnier|cointreau|triple sec|cura[cç]ao|frangelico|limoncello|chambord|drambuie|galliano|cr[eè]me de (?:menthe|cassis|cacao|banane|noyaux))\b/gi,
    substitute: NON_ALCOHOLIC_FLAVOR,
    needsLabel: true,
  },
  { category: "alcohol", term: "bitters", pattern: /\bbitters\b/gi, substitute: NON_ALCOHOLIC, needsLabel: true },
  { category: "alcohol", term: "alcohol", pattern: /\b(?:alcohol|alcoholic|booze|boozy)\b/gi, allowBefore: /(?:\bnon[- ]?|\bsugar\s+|\bde[- ]?|0(?:\.0)?\s?%\s*)$/i },
  { category: "alcohol", term: "flambé", pattern: /\bflamb(?:[eé]e?d|[eé]ing|[eé]s|[eé])(?![a-z])/gi },
  // Ordinary extracts and essences are made with alcohol.
  {
    category: "alcohol",
    term: "alcohol-based extract",
    pattern: new RegExp(`\\b(?:${FLAVORS})(?:\\s+bean)?\\s+(?:extracts?|essences?|flavou?rings?)\\b|\\bvanilla(?:\\s+bean)?\\s+paste\\b|\\bpure extracts?\\b`, "gi"),
    substitute: NON_ALCOHOLIC_FLAVOR,
    needsLabel: true,
  },
];

/** "labeled", "check the label", "label says 0.0%". */
const LABEL = /\blabel(?:l?ed|s)?\b/i;

/**
 * A qualifier followed by at most three more words, at the end of the text
 * before a match: "non-alcoholic dry white" before "wine". The words in between
 * may not be "and", "or", "with"... or a comma, so "chicken and bacon" does not
 * count as turkey-style bacon.
 */
function qualifierRight(qualifier: RegExp): RegExp {
  return new RegExp(`\\b(?:${qualifier.source})(?:[\\s-]+(?!(?:and|or|with|plus|then|than|instead|of|not|but|nor|vs)\\b)[\\w'%.]+){0,3}[\\s-]*$`, "i");
}

const qualifierCache = new Map<RegExp, RegExp>();
function nearQualifier(qualifier: RegExp): RegExp {
  let near = qualifierCache.get(qualifier);
  if (!near) {
    near = qualifierRight(qualifier);
    qualifierCache.set(qualifier, near);
  }
  return near;
}

export interface CheckOptions {
  /** The text is a list ingredient or a suggestion, so a non-alcoholic substitute must also say to check the label. */
  requireLabel?: boolean;
}

/** Finds pork and alcohol in one piece of text. */
export function findDietaryViolations(field: string, value: string | null | undefined, options: CheckOptions = {}): DietaryViolation[] {
  if (!value) return [];
  const found: DietaryViolation[] = [];
  for (const rule of RULES) {
    for (const m of value.matchAll(rule.pattern)) {
      const start = m.index ?? 0;
      const before = value.slice(Math.max(0, start - 60), start);
      const after = value.slice(start + m[0].length, start + m[0].length + 30);
      // "pork-free", "alcohol free", "gelatin-free": saying it is absent is not a violation.
      if (/^[- ]free\b/i.test(after)) continue;
      if (rule.allowBefore?.test(before) || rule.allowAfter?.test(after)) continue;
      if (rule.substitute && nearQualifier(rule.substitute).test(before)) {
        if (rule.needsLabel && options.requireLabel && !LABEL.test(value)) {
          found.push({
            field,
            category: rule.category,
            term: rule.term,
            match: m[0],
            message: `${field} uses a non-alcoholic ${m[0]} without telling the reader to check the label. Say "labeled alcohol-free" (or remove it).`,
          });
        }
        continue;
      }
      found.push({
        field,
        category: rule.category,
        term: rule.term,
        match: m[0],
        message:
          rule.category === "pork"
            ? `${field} mentions "${m[0]}" (${rule.term}). Recipes must be completely free of pork and pork-derived ingredients.`
            : `${field} mentions "${m[0]}" (${rule.term}). Recipes must not contain any alcohol or alcohol-based ingredients.`,
      });
    }
  }
  return found;
}

// --- Soy sauce and similar condiments ----------------------------------------
//
// Soy sauce usually contains wheat, and soy sauce, tamari, teriyaki, ponzu,
// gochujang, miso and other cooking sauces can contain alcohol (added or from
// brewing). Coconut aminos and fish sauce vary by brand. So none of them is
// assumed safe: where the recipe names one as something to buy (the ingredient
// list, substitutions, tips, FAQ), the same item must say it is labeled both
// gluten-free and alcohol-free. In the steps and other copy, a mention is fine
// only when the ingredient list has a compliant version of it.

export interface Condiment {
  kind: string;
  pattern: RegExp;
  /** A homemade version made from a compliant soy sauce, tamari or coconut aminos is fine. */
  composite?: boolean;
}

export const CONDIMENTS: Condiment[] = [
  { kind: "soy sauce", pattern: /\b(?:(?:light|dark|sweet|low[- ]sodium|reduced[- ]sodium|thick|mushroom)\s+)?soy sauce\b|\bshoyu\b|\bkecap manis\b/gi },
  { kind: "tamari", pattern: /\btamari\b/gi },
  { kind: "coconut aminos", pattern: /\bcoconut aminos\b/gi },
  { kind: "liquid aminos", pattern: /\b(?:liquid|soy) aminos\b/gi },
  { kind: "fish sauce", pattern: /\bfish sauce\b/gi },
  { kind: "oyster sauce", pattern: /\boyster sauce\b/gi },
  { kind: "hoisin sauce", pattern: /\bhoisin(?: sauce)?\b/gi },
  { kind: "miso", pattern: /\b(?:(?:white|red|yellow|shiro|aka|brown rice|chickpea)\s+)?miso(?: paste)?\b/gi },
  { kind: "gochujang", pattern: /\bgochujang\b/gi },
  { kind: "chili bean sauce", pattern: /\b(?:doubanjiang|chili bean (?:sauce|paste)|black bean (?:sauce|paste))\b/gi },
  { kind: "teriyaki sauce", pattern: /\bteriyaki (?:sauce|glaze|marinade)\b/gi, composite: true },
  { kind: "ponzu", pattern: /\bponzu(?: sauce)?\b/gi, composite: true },
  {
    kind: "cooking sauce",
    pattern: /\b(?:stir[- ]fry|cooking|simmer|yakitori|unagi|eel|plum|sweet and sour|duck|katsu|tonkatsu|yakisoba|bulgogi|char siu|orange chicken|general tso'?s?) sauces?\b/gi,
    composite: true,
  },
];

/** Bases a homemade teriyaki, ponzu or stir-fry sauce can be made from. */
const SOY_BASES = new Set(["soy sauce", "tamari", "coconut aminos", "liquid aminos"]);
const GLUTEN_FREE = /\bgluten[- ]free\b|\bcertified gf\b/i;
const ALCOHOL_FREE = new RegExp(`\\b(?:${NON_ALCOHOLIC.source})`, "i");
/** "regular soy sauce", "any fish sauce": never compliant, whatever else the sentence says. */
const UNSAFE_PREFIX = /\b(?:regular|ordinary|standard|traditional|conventional|normal|any|most|plain|store[- ]bought)\s+$/i;

/** True when one piece of text says the product is labeled gluten-free and alcohol-free. */
export function isCompliantCondimentText(text: string): boolean {
  return GLUTEN_FREE.test(text) && ALCOHOL_FREE.test(text) && LABEL.test(text);
}

interface CondimentMention {
  kind: string;
  match: string;
  composite: boolean;
  unsafe: boolean;
}

function condimentMentions(text: string): CondimentMention[] {
  const mentions: CondimentMention[] = [];
  for (const c of CONDIMENTS) {
    for (const m of text.matchAll(c.pattern)) {
      const start = m.index ?? 0;
      const before = text.slice(Math.max(0, start - 30), start);
      const after = text.slice(start + m[0].length, start + m[0].length + 10);
      if (/^[- ]free\b/i.test(after)) continue;
      mentions.push({ kind: c.kind, match: m[0], composite: Boolean(c.composite), unsafe: UNSAFE_PREFIX.test(before) });
    }
  }
  return mentions;
}

const condimentMessage = (field: string, match: string) =>
  `${field} uses "${match}" without saying it is labeled both gluten-free and alcohol-free. Name a product labeled gluten-free and alcohol-free (for example "tamari, labeled gluten-free and alcohol-free"), or leave it out.`;

/**
 * Soy sauce and similar condiments in one field. "buy" fields (ingredients and
 * suggestions) must qualify the product themselves; other fields may refer to a
 * compliant product from the ingredient list.
 */
export function findCondimentViolations(field: string, value: string | null | undefined, buy: boolean, compliantKinds: ReadonlySet<string> = new Set()): DietaryViolation[] {
  if (!value) return [];
  const qualified = isCompliantCondimentText(value);
  const hasBase = [...compliantKinds].some((k) => SOY_BASES.has(k));
  const found: DietaryViolation[] = [];
  for (const m of condimentMentions(value)) {
    if (m.unsafe) {
      found.push({ field, category: "condiment", term: m.kind, match: m.match, message: condimentMessage(field, m.match) });
      continue;
    }
    if (qualified) continue;
    if (!buy && (compliantKinds.has(m.kind) || (m.composite && hasBase))) continue;
    found.push({ field, category: "condiment", term: m.kind, match: m.match, message: condimentMessage(field, m.match) });
  }
  return found;
}

export interface DietaryCheckInput {
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  introduction?: string | null;
  ingredients?: Array<{ group?: string | null; name?: string | null; note?: string | null }> | null;
  instructions?: Array<{ group?: string | null; text?: string | null }> | null;
  tips?: string[] | null;
  substitutions?: Array<{ original?: string | null; substitute?: string | null; note?: string | null }> | null;
  storage_instructions?: string | null;
  faq?: Array<{ question?: string | null; answer?: string | null }> | null;
  yield_description?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  focus_keyword?: string | null;
  image_alt?: string | null;
  featured_image_alt?: string | null;
  image_brief?: string | null;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" ");

/** Checks every field of a recipe. An empty list means it is pork-free and alcohol-free, with compliant condiments. */
export function analyzeDietaryRestrictions(recipe: DietaryCheckInput): DietaryViolation[] {
  const label = { requireLabel: true };
  const fields: Array<[string, string | null | undefined, CheckOptions?]> = [
    ["title", recipe.title],
    ["slug", recipe.slug?.replace(/-/g, " ")],
    ["description", recipe.description],
    ["introduction", recipe.introduction],
    ["seo_title", recipe.seo_title],
    ["seo_description", recipe.seo_description],
    ["focus_keyword", recipe.focus_keyword],
    ["yield_description", recipe.yield_description],
    ...(recipe.ingredients ?? []).map((i, n): [string, string, CheckOptions] => [`ingredients[${n}]`, join(i.group, i.name, i.note), label]),
    ...(recipe.instructions ?? []).map((s, n): [string, string] => [`instructions[${n}]`, join(s.group, s.text)]),
    ...(recipe.substitutions ?? []).map((s, n): [string, string, CheckOptions] => [`substitutions[${n}]`, join(s.original, s.substitute, s.note), label]),
    ...(recipe.tips ?? []).map((t, n): [string, string, CheckOptions] => [`tips[${n}]`, t, label]),
    ...(recipe.faq ?? []).map((f, n): [string, string, CheckOptions] => [`faq[${n}]`, join(f.question, f.answer), label]),
    ["storage_instructions", recipe.storage_instructions],
    ["image_alt", recipe.image_alt ?? recipe.featured_image_alt],
    ["image_brief", recipe.image_brief],
  ];
  // Condiments the ingredient list names as labeled gluten-free and alcohol-free.
  const compliantKinds = new Set(
    (recipe.ingredients ?? []).flatMap((i) => {
      const text = join(i.name, i.note);
      if (!isCompliantCondimentText(text)) return [];
      return condimentMentions(text).filter((m) => !m.unsafe).map((m) => m.kind);
    }),
  );
  const condimentFields = fields.map(([field, value, options]): [string, string | null | undefined, boolean] => [field, value, Boolean(options?.requireLabel)]);
  // A substitution's "original" is the recipe's own ingredient, already checked
  // in the list; the substitute and its note are what the reader would buy.
  (recipe.substitutions ?? []).forEach((sub, n) => {
    const at = condimentFields.findIndex(([field]) => field === `substitutions[${n}]`);
    condimentFields.splice(at, 1, [`substitutions[${n}]`, sub.original, false], [`substitutions[${n}]`, join(sub.substitute, sub.note), true]);
  });
  return [
    ...fields.flatMap(([field, value, options]) => findDietaryViolations(field, value, options)),
    ...condimentFields.flatMap(([field, value, buy]) => findCondimentViolations(field, value, buy, compliantKinds)),
  ];
}

/** True when a keyword asks for a pork or alcohol dish ("bacon wrapped dates", "beer bread"). */
export function keywordViolation(keyword: string): DietaryViolation | null {
  return findDietaryViolations("keyword", keyword)[0] ?? null;
}

/** One line for the job log: "Rejected: pork-free and alcohol-free rule. ingredients[2] mentions "bacon" ..." */
export function dietaryRejectionReason(violations: DietaryViolation[]): string {
  const shown = violations.slice(0, 5).map((v) => v.message).join(" ");
  const more = violations.length > 5 ? ` (and ${violations.length - 5} more)` : "";
  return `Rejected by the pork-free and alcohol-free rule: ${shown}${more}`;
}
