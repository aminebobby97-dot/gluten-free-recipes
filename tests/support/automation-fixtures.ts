// Shared fixtures for the automation pipeline tests: a recipe that passes every
// check, fake AI providers and a fake database with the Phase 2 functions.

import type { AiProviders, GeneratedRecipe, ImageStore, Photo, SiteRefresher } from "@/lib/automation/types";
import { createFakeDb } from "./fake-db";

export const CATEGORY = { id: "0b5c3c1e-7c2a-4f7e-9d0a-1a2b3c4d5e6f", slug: "gluten-free-baking", name: "Gluten-Free Baking", sort_order: 50 };

export function goodRecipe(overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return {
    title: "Gluten-Free Blueberry Muffins",
    slug: "gluten-free-blueberry-muffins",
    description: "Tender, bakery-style gluten-free blueberry muffins made with a measure-for-measure flour blend.",
    introduction:
      "These gluten-free blueberry muffins rise tall and stay moist for days. The batter uses a gluten-free flour blend that already contains xanthan gum, so there is nothing extra to buy. " +
      "Resting the batter for ten minutes lets the rice flour hydrate, which gives a softer crumb. Fresh or frozen berries both work; toss frozen ones in a spoonful of the flour so they do not sink. " +
      "Check that your baking powder is labeled gluten-free, because some brands use wheat starch.",
    ingredients: [
      { amount: "2", unit: "cups", name: "gluten-free all-purpose flour blend", note: "with xanthan gum" },
      { amount: "3/4", unit: "cup", name: "granulated sugar" },
      { amount: "2", unit: "tsp", name: "baking powder", note: "labeled gluten-free" },
      { amount: "1/2", unit: "tsp", name: "kosher salt" },
      { amount: "2", name: "large eggs" },
      { amount: "1", unit: "cup", name: "whole milk" },
      { amount: "1/2", unit: "cup", name: "unsalted butter", note: "melted" },
      { amount: "1 1/2", unit: "cups", name: "fresh blueberries" },
    ],
    instructions: [
      { text: "Preheat the oven to 375°F and line a 12-cup muffin tin with paper liners." },
      { text: "Whisk the flour, sugar, baking powder and salt in a large bowl." },
      { text: "In a second bowl whisk the eggs, milk and melted butter, then stir into the dry mixture and rest for 10 minutes." },
      { text: "Fold in the blueberries and divide the batter between the cups." },
      { text: "Bake for 20 to 22 minutes, until a toothpick comes out clean." },
    ],
    prep_time: 15,
    cook_time: 22,
    servings: 12,
    yield_description: "12 muffins",
    nutrition: null,
    tips: ["Use a dedicated gluten-free muffin tin or new liners to avoid cross-contact."],
    substitutions: [{ original: "whole milk", substitute: "unsweetened almond milk", note: "Makes them dairy-free if you also swap the butter. Almond milk adds a tree-nut allergen." }],
    storage_instructions: "Keep in an airtight container for 2 days or freeze for up to 3 months.",
    faq: [
      { question: "Can I use frozen blueberries?", answer: "Yes. Do not thaw them first, and toss them in a tablespoon of the flour." },
      { question: "Which flour blend works best?", answer: "A measure-for-measure blend that contains xanthan gum." },
      { question: "Why rest the batter?", answer: "Rice flour absorbs liquid slowly; resting gives a softer, less gritty crumb." },
      { question: "Can I make them dairy-free?", answer: "Use a plant milk and a dairy-free butter; check both are labeled gluten-free." },
    ],
    seo_title: "Gluten-Free Blueberry Muffins (Soft and Bakery-Style)",
    seo_description:
      "Soft, bakery-style gluten-free blueberry muffins made with a measure-for-measure flour blend. Simple ingredients, 15 minutes prep, freezer friendly.",
    focus_keyword: "gluten free blueberry muffins",
    category_slug: "gluten-free-baking",
    allergens: ["milk", "eggs"],
    image_alt: "Golden gluten-free blueberry muffins in paper liners on a cooling rack",
    image_brief: "A dozen domed golden muffins studded with blueberries, in white paper liners, on a wire rack, soft daylight.",
    ...overrides,
  };
}

const ai = <I, O>(model: string, output: (input: I, call: number) => O, cost = 0.1) => {
  let calls = 0;
  const step = {
    calls: () => calls,
    estimateUsd: () => cost * 2,
    run: async (input: I) => {
      calls++;
      return { output: output(input, calls), provider: "fake", model, promptVersion: "test", costUsd: cost, inputTokens: 100, outputTokens: 200 };
    },
  };
  return step;
};

export function fakeProviders(opts: { drafts?: unknown[]; reviewIssues?: Array<{ severity: "blocking" | "warning"; field: string; message: string }>; photoOk?: boolean[] } = {}) {
  const drafts = opts.drafts ?? [goodRecipe()];
  const photo: Photo = { data: new Uint8Array([1, 2, 3]), mimeType: "image/webp" };
  const writer = ai("fake-writer", (_i, n) => drafts[Math.min(n - 1, drafts.length - 1)], 0.2);
  const repairer = ai("fake-writer", (_i, n) => drafts[Math.min(n, drafts.length - 1)], 0.2);
  const reviewer = ai("fake-reviewer", () => ({ issues: opts.reviewIssues ?? [] }), 0.1);
  const photographer = ai("fake-image", () => photo, 0.05);
  const photoChecker = ai("fake-checker", (_i, n) => ({ ok: opts.photoOk ? opts.photoOk[n - 1] ?? true : true, problems: ["Shows a wheat bagel."] }), 0.02);
  const providers: AiProviders = { writer, repairer, reviewer, photographer, photoChecker };
  return { providers, writer, repairer, reviewer, photographer, photoChecker };
}

export function fakeImages() {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const store: ImageStore = {
    upload: async (path) => (uploaded.push(path), `https://cdn.test/${path}`),
    remove: async (paths) => void removed.push(...paths),
  };
  return { store, uploaded, removed };
}

export function fakeSite(fail = false) {
  const refreshed: string[] = [];
  const site: SiteRefresher = {
    revalidate: async (slug) => {
      if (fail) throw new Error("site unreachable");
      refreshed.push(slug);
    },
  };
  return { site, refreshed };
}

export function automationDb(opts: { settings?: Record<string, unknown>; keywords?: Array<Record<string, unknown>>; recipes?: Array<Record<string, unknown>>; spent?: number; similar?: string[] } = {}) {
  return createFakeDb(
    {
      automation_settings: [
        {
          id: true,
          enabled: true,
          publish_mode: "review",
          min_reviewed_before_auto: 5,
          daily_budget_usd: 3,
          max_keyword_difficulty: 40,
          similarity_threshold: 0.5,
          pinterest_enabled: false,
          ...opts.settings,
        },
      ],
      categories: [CATEGORY],
      recipes: opts.recipes ?? [],
      keywords: opts.keywords ?? [{ id: "kw-1", keyword: "gluten free blueberry muffins", status: "new", category_id: null, search_volume: null, keyword_difficulty: null }],
      publishing_jobs: [],
      publishing_job_events: [],
      generation_attempts: [],
    },
    {
      ai_spend: (_a, data) => (opts.spent ?? 0) + data.generation_attempts.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
      claim_next_keyword: (args, data) => {
        const kw = data.keywords.find((k) => k.status === "new");
        if (!kw) return null;
        kw.status = "queued";
        const job = data.publishing_jobs.find((j) => j.id === args.p_job_id);
        if (job) job.keyword_id = kw.id;
        return kw;
      },
      release_keyword: (args, data) => {
        const kw = data.keywords.find((k) => k.id === args.p_keyword_id);
        if (kw) kw.status = "new";
        return null;
      },
      find_similar_recipes: () => (opts.similar ?? []).map((title) => ({ title })),
      publish_generated_recipe: (args, data) => {
        const job = data.publishing_jobs.find((j) => j.id === args.p_job_id)!;
        const recipe = data.recipes.find((r) => r.id === job.recipe_id)!;
        recipe.status = "published";
        job.status = "succeeded";
        return recipe;
      },
    },
  );
}
