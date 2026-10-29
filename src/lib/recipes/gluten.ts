// Gluten-safety checks for recipe ingredients and copy.
//
// These checks are a safety net for editors and for future automated content,
// not a guarantee. They catch obvious gluten sources and flag ingredients that
// must be bought as certified or clearly labeled gluten-free products.

import type { Ingredient, Recipe } from "./types";

export type FindingSeverity = "blocking" | "check_label";

export interface IngredientFinding {
  index: number;
  ingredient: string;
  severity: FindingSeverity;
  message: string;
}

const GF_QUALIFIER = /\b(gluten[- ]free|certified gf|gf)\b/i;

/** Grains and products that always contain gluten. Never acceptable. */
const ALWAYS_GLUTEN: Array<[RegExp, string]> = [
  [/\bwheat\b/i, "wheat"],
  [/\bbarley\b/i, "barley"],
  [/\brye\b/i, "rye"],
  [/\btriticale\b/i, "triticale"],
  [/\bspelt\b/i, "spelt"],
  [/\bkamut\b/i, "kamut"],
  [/\bfarro\b/i, "farro"],
  [/\bdurum\b/i, "durum"],
  [/\bsemolina\b/i, "semolina"],
  [/\beinkorn\b/i, "einkorn"],
  [/\bemmer\b/i, "emmer"],
  [/\bbulgur\b/i, "bulgur"],
  [/\bfreekeh\b/i, "freekeh"],
  [/\bseitan\b/i, "seitan"],
  [/\bvital wheat gluten\b/i, "wheat gluten"],
  [/\bmalt(ed)?\b/i, "malt"],
  [/\bbrewer'?s yeast\b/i, "brewer's yeast"],
];

/**
 * Foods that normally contain gluten but exist in gluten-free versions. They are
 * acceptable only when the ingredient explicitly names a gluten-free version.
 */
const GLUTEN_UNLESS_QUALIFIED: Array<[RegExp, string]> = [
  [/\b(all[- ]purpose|bread|cake|pastry|self[- ]rising|plain) flour\b/i, "flour blend"],
  [/\b(bread ?crumbs?|panko|croutons?|stuffing)\b/i, "breadcrumbs"],
  [/\b(pasta|spaghetti|fettuccine|linguine|penne|rigatoni|macaroni|lasagna|orzo|ziti|tortellini|ravioli)\b/i, "pasta"],
  [/\b(noodles?|udon|ramen|soba)\b/i, "noodles"],
  [/\b(couscous)\b/i, "couscous"],
  [/\b(bread|buns?|rolls?|bagels?|pita|naan|baguette|brioche|english muffins?)\b/i, "bread"],
  [/\b(flour )?tortillas?\b/i, "tortillas"],
  [/\b(crackers?|pretzels?|cookies?|wafers?|graham|cereal|granola)\b/i, "packaged product"],
  [/\b(pie crust|pie dough|puff pastry|phyllo|filo|pizza dough)\b/i, "pastry dough"],
  [/\b(soy sauce|shoyu|teriyaki|hoisin)\b/i, "sauce"],
  [/\b(beer|ale|lager|stout)\b/i, "beer"],
  [/\bgnocchi\b/i, "gnocchi"],
];

/** Naturally gluten-free versions of the above that still need a label check. */
const NATURALLY_GF_VARIANT =
  /\b(rice|corn|brown rice|chickpea|lentil|quinoa|buckwheat|almond|coconut|tapioca|cassava|potato|sorghum|millet|teff|arrowroot)\b/i;

/** Ingredients that are often gluten-free but must be bought with a gluten-free label. */
const CHECK_LABEL: Array<[RegExp, string]> = [
  [/\boats?\b|\boatmeal\b|\boat (flour|milk|bran)\b/i, "Oats are often cross-contacted with wheat. Use certified gluten-free oats."],
  [/\bbaking powder\b/i, "Some baking powders use wheat starch. Check that yours is labeled gluten-free."],
  [/\b(broth|stock|bouillon)\b/i, "Broth and bouillon can contain wheat or barley. Use a product labeled gluten-free."],
  [/\b(seasoning|spice blend|spice mix|rub)\b/i, "Seasoning blends can contain wheat-based fillers. Check the label."],
  [/\b(tamari|worcestershire|bbq sauce|barbecue sauce|hot sauce|ketchup|mustard|gravy|curry paste|fish sauce|miso)\b/i, "Sauces and condiments can contain gluten. Use a product labeled gluten-free."],
  [/\b(chocolate chips|chocolate|sprinkles|candy|marshmallows?|caramels?)\b/i, "Chocolate and confectionery can be made on shared lines. Check the label."],
  [/\b(sausages?|hot dogs?|deli|meatballs?|imitation crab)\b/i, "Processed meats can contain wheat-based binders. Check the label."],
  [/\b(cornmeal|polenta|grits)\b/i, "Corn products can be milled alongside wheat. Choose ones labeled gluten-free."],
  [/\bxanthan gum\b|\bpsyllium\b/i, "Check that the binder is labeled gluten-free."],
  [
    /\b(walnuts?|pecans?|almonds?(?! (flour|meal|milk|butter))|cashews?|pistachios?|hazelnuts?|macadamias?|peanuts?|pine nuts|nuts|(chia|flax|sunflower|pumpkin|sesame|poppy|hemp) seeds|dried fruit|raisins|dried cranberries)\b/i,
    "Packaged nuts, seeds and dried fruit are often processed on shared lines with wheat. Use ones labeled gluten-free.",
  ],
  [/\b(dairy[- ]free|vegan|plant[- ]based) (butter|cheese|yogurt|milk|cream)\b/i, "Some dairy-free products contain oats or barley. Check the label."],
];

function ingredientText(ingredient: Ingredient): string {
  return [ingredient.name, ingredient.note].filter(Boolean).join(" ");
}

export function describeIngredient(ingredient: Ingredient): string {
  return [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
}

/** Analyzes a single ingredient. Returns at most one finding (the most severe). */
export function analyzeIngredient(ingredient: Ingredient, index = 0): IngredientFinding | null {
  const name = ingredient.name ?? "";
  const text = ingredientText(ingredient);
  const label = describeIngredient(ingredient);
  const qualified = GF_QUALIFIER.test(text);

  for (const [pattern, term] of ALWAYS_GLUTEN) {
    // Word boundaries keep gluten-free "buckwheat" from matching "wheat".
    if (pattern.test(name)) {
      return {
        index,
        ingredient: label,
        severity: "blocking",
        message: `Contains ${term}, which contains gluten. Replace it with a gluten-free ingredient.`,
      };
    }
  }

  for (const [pattern, term] of GLUTEN_UNLESS_QUALIFIED) {
    if (!pattern.test(name)) continue;
    if (qualified || NATURALLY_GF_VARIANT.test(name)) {
      return {
        index,
        ingredient: label,
        severity: "check_label",
        message: `Make sure the ${term} is certified or clearly labeled gluten-free.`,
      };
    }
    return {
      index,
      ingredient: label,
      severity: "blocking",
      message: `"${name}" usually contains gluten. Specify a gluten-free version (for example "gluten-free ${name}").`,
    };
  }

  // Unqualified "flour" with no gluten-free grain named.
  if (/\bflour\b/i.test(name) && !qualified && !NATURALLY_GF_VARIANT.test(name)) {
    return {
      index,
      ingredient: label,
      severity: "blocking",
      message: `"${name}" does not say which flour to use. Name a gluten-free flour or blend.`,
    };
  }

  for (const [pattern, message] of CHECK_LABEL) {
    if (pattern.test(name)) {
      return { index, ingredient: label, severity: "check_label", message };
    }
  }

  // Any product the recipe explicitly calls "gluten-free" needs a labeled product.
  if (qualified) {
    return {
      index,
      ingredient: label,
      severity: "check_label",
      message: "Buy a product that is certified or clearly labeled gluten-free.",
    };
  }

  return null;
}

export function analyzeIngredients(ingredients: Ingredient[]): IngredientFinding[] {
  return ingredients
    .map((ingredient, index) => analyzeIngredient(ingredient, index))
    .filter((finding): finding is IngredientFinding => finding !== null);
}

export interface ClaimFinding {
  field: string;
  phrase: string;
  message: string;
}

/** Phrases that make claims the site must not make. */
const FORBIDDEN_CLAIMS: Array<[RegExp, string]> = [
  [/\b(safe|suitable) for (everyone|anyone|all) with celiac\b/i, "Do not claim a recipe is safe for everyone with celiac disease."],
  [/\bceliac[- ]safe\b|\bsafe for celiacs?\b|\b100% (safe|gluten[- ]free)\b/i, "Do not make medical safety claims."],
  [/\b(test kitchen|our testers|recipe testers)\b/i, "Do not refer to a testing team that does not exist."],
  [/\b(i|we) (have )?(tested|retested|made) (this|these|it)\b/i, "Do not invent personal testing experiences."],
  [/\b(my|our) (family|kids|husband|wife) (loves?|loved|devoured)\b/i, "Do not invent personal anecdotes."],
  [/\b(registered )?(dietitian|nutritionist|doctor|chef)[- ](approved|reviewed|tested|recommended)\b/i, "Do not invent credentials or expert reviews."],
  [/\b\d(\.\d)? stars?\b|\b\d+ reviews?\b/i, "Do not include ratings or review counts."],
];

/** Scans editorial text fields for forbidden claims. */
export function analyzeClaims(
  recipe: Pick<Recipe, "title" | "description" | "introduction" | "tips" | "faq" | "storage_instructions" | "substitutions" | "instructions">,
): ClaimFinding[] {
  const fields: Array<[string, string]> = [
    ["title", recipe.title],
    ["description", recipe.description],
    ["introduction", recipe.introduction],
    ["storage_instructions", recipe.storage_instructions],
    ...recipe.tips.map((tip, i): [string, string] => [`tips[${i}]`, tip]),
    ...recipe.faq.flatMap((item, i): Array<[string, string]> => [
      [`faq[${i}].question`, item.question],
      [`faq[${i}].answer`, item.answer],
    ]),
    ...recipe.substitutions.map((s, i): [string, string] => [`substitutions[${i}]`, `${s.substitute} ${s.note ?? ""}`]),
    ...recipe.instructions.map((s, i): [string, string] => [`instructions[${i}]`, s.text]),
  ];

  return fields.flatMap(([field, value]) => analyzeClaimText(field, value));
}

/** Scans one piece of text (for example a Pinterest description) for forbidden claims. */
export function analyzeClaimText(field: string, value: string | null | undefined): ClaimFinding[] {
  if (!value) return [];
  const findings: ClaimFinding[] = [];
  for (const [pattern, message] of FORBIDDEN_CLAIMS) {
    const match = value.match(pattern);
    if (match) findings.push({ field, phrase: match[0], message });
  }
  return findings;
}
