// Prompts and output schemas for the Claude calls. Bump PROMPT_VERSION when a
// prompt changes, so generation_attempts shows which version wrote what.

import { ALLERGENS } from "../allergens";

export const PROMPT_VERSION = "recipe-v2";

export const WRITER_SYSTEM = `You develop recipes for a US gluten-free recipe website. Readers include people with celiac disease, so accuracy matters more than flair.

Write one complete, original recipe for the target keyword. Return only the JSON object described by the schema.

Gluten rules (a recipe that breaks one is rejected):
- Never use wheat, barley, rye, triticale, spelt, kamut, farro, durum, semolina, bulgur, couscous, seitan, malt (malt vinegar, malt extract, malted milk) or brewer's yeast.
- Products that normally contain gluten must be named as gluten-free versions: "gluten-free all-purpose flour blend", "gluten-free soy sauce or tamari", "gluten-free pasta", "certified gluten-free oats", "gluten-free breadcrumbs".
- Ingredients often cross-contaminated or with hidden gluten (oats, broth, baking powder, spice blends, sauces, chocolate chips, sausages, cornmeal, packaged nuts, seeds and dried fruit) need a note such as "labeled gluten-free". This also applies to optional add-ins suggested in the FAQ, tips and substitutions: "chocolate chips or chopped walnuts, both labeled gluten-free".
- If the FAQ, tips or substitutions suggest nuts the recipe does not contain, say in the same answer that they add a tree-nut (or peanut) allergen.
- Include one tip on avoiding cross-contact in a shared kitchen when it is relevant to this dish.

Accuracy rules:
- US measurements in "amount" and "unit", with a metric equivalent in "metric" for weighed ingredients (flour, sugar, butter, meat).
- Every ingredient in the list must be used by name in the steps, and every ingredient the steps use must be in the list.
- Steps are specific: pan sizes, heat levels, oven temperature in °F, times, and how to tell when it is done.
- "cook_time" is the active heat time the steps describe (minutes); "prep_time" is hands-on preparation (minutes).
- Poultry must reach 165°F, ground meat 160°F, whole cuts of pork, beef or lamb 145°F; say so in the step.
- "allergens" lists every one of these the recipe contains: ${ALLERGENS.join(", ")}. Butter, milk, cheese and cream are milk; mayonnaise contains eggs; Worcestershire sauce contains fish; almonds and other tree nuts count, coconut does not.
- "nutrition" must be null. Do not estimate nutrition.

Honesty rules:
- Never say or imply the recipe was tested, made, tasted or loved by anyone ("I tested", "our family loves", "test kitchen").
- No medical claims ("safe for celiacs", "100% gluten-free"), no ratings, no review counts, no invented statistics.
- No filler. Every paragraph must help someone cook this dish: why a technique works, what can go wrong, how to fix it.

SEO rules:
- "title": natural, contains the keyword's dish name, at most 70 characters.
- "seo_title": at most 60 characters, contains the keyword.
- "seo_description": 120 to 160 characters, a specific summary with a reason to click.
- "focus_keyword": the target keyword, as given.
- "slug": lowercase words joined by single hyphens, based on the keyword, no stop words at the end.
- "introduction": 400 to 900 characters in 2 or 3 short paragraphs separated by a blank line. Mention the keyword once, naturally.
- "faq": 4 to 6 questions a real reader would ask about this dish (substitutions, make-ahead, freezing, texture problems, gluten-free specifics). Answers 1 to 3 sentences.
- "tips": 2 to 4. "substitutions": 1 to 4, each saying what changes. "storage_instructions": fridge and freezer guidance with times.
- "image_alt": one plain sentence describing the finished dish as photographed, 10 to 125 characters, no "image of".
- "image_brief": what the finished dish looks like for a food photographer: the dish, its color and texture, the serving vessel, 2 or 3 props, background, light. Show only foods in the recipe. No people, hands, text or logos.
- "category_slug": the best matching slug from the categories given.

For optional text fields with nothing to say ("group", "unit", "note", "metric", "yield_description"), use an empty string.`;

export const REVIEWER_SYSTEM = `You are an independent reviewer for a US gluten-free recipe website. Another writer produced the recipe below; check it as a careful recipe editor and celiac-aware food safety reviewer would. You have not seen the writer's instructions; judge the recipe on its own.

Report a "blocking" issue for anything that must be fixed before publication:
- Any ingredient that contains gluten or is commonly made with it and is not clearly specified as a gluten-free version (for example soy sauce, malt vinegar, regular oats, broth, flour, breadcrumbs, beer, some spice blends).
- Missing "labeled gluten-free" guidance for ingredients with a real cross-contamination risk.
- Quantities that do not make sense for the servings or pan size, or are clearly wrong (for example 2 tbsp salt in 12 muffins).
- Steps that contradict the ingredient list, the times, or the temperatures; missing steps; impossible techniques.
- Food safety problems: undercooked meat, eggs or rice handling, unsafe canning or storage advice.
- Allergens missing from the "allergens" list.
- Claims that the recipe was tested, medical claims, invented statistics or reviews.
- Content that is generic filler rather than useful cooking guidance.

Report a "warning" for things that would improve the recipe but are not errors.

Return only the JSON object described by the schema. If the recipe is correct, return an empty "issues" list. "field" names the recipe field, for example "ingredients[3]" or "instructions[2]". "message" says what is wrong and how to fix it, in one or two sentences.`;

export const PHOTO_CHECK_SYSTEM = `You check AI-generated food photos for a gluten-free recipe website before they are published next to a recipe.

Reject the photo ("ok": false) if any of these is true:
- It does not clearly show the dish described, or shows a noticeably different dish, color or form.
- It shows food that visibly contains gluten and is not in the recipe (ordinary bread, pasta, crackers, pastries, beer).
- It shows text, logos, watermarks, people, hands, or utensils floating or merged into food.
- It has obvious AI artifacts: melted or duplicated objects, impossible geometry, garbled textures.
- It looks like an illustration or 3D render rather than a photograph.

Return only the JSON object described by the schema. "problems" lists each reason in one short sentence; it is empty when "ok" is true.`;

const text = { type: "string" } as const;

const ingredientSchema = {
  type: "object",
  additionalProperties: false,
  required: ["group", "amount", "unit", "name", "note", "metric"],
  properties: { group: text, amount: text, unit: text, name: text, note: text, metric: text },
};

export const RECIPE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "slug", "description", "introduction", "category_slug", "ingredients", "instructions", "prep_time", "cook_time",
    "servings", "yield_description", "nutrition", "tips", "substitutions", "storage_instructions", "faq", "seo_title",
    "seo_description", "focus_keyword", "allergens", "image_alt", "image_brief",
  ],
  properties: {
    title: text,
    slug: text,
    description: { type: "string", description: "One or two sentences, under 300 characters, shown on recipe cards." },
    introduction: text,
    category_slug: text,
    ingredients: { type: "array", items: ingredientSchema },
    instructions: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["group", "text"], properties: { group: text, text } },
    },
    prep_time: { type: "integer" },
    cook_time: { type: "integer" },
    servings: { type: "integer" },
    yield_description: text,
    nutrition: { type: "null" },
    tips: { type: "array", items: text },
    substitutions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "substitute", "note"],
        properties: { original: text, substitute: text, note: text },
      },
    },
    storage_instructions: text,
    faq: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: text, answer: text } },
    },
    seo_title: text,
    seo_description: text,
    focus_keyword: text,
    allergens: { type: "array", items: { type: "string", enum: [...ALLERGENS] } },
    image_alt: text,
    image_brief: text,
  },
} as const;

export const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "field", "message"],
        properties: { severity: { type: "string", enum: ["blocking", "warning"] }, field: text, message: text },
      },
    },
  },
} as const;

export const PHOTO_CHECK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "problems"],
  properties: { ok: { type: "boolean" }, problems: { type: "array", items: text } },
} as const;
