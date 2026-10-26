// Shapes shared by the daily publishing pipeline and the AI providers it calls.
// Providers are plain objects implementing AiStep, so the pipeline can be
// tested with fakes and a provider can be swapped without touching it.

import { z } from "zod";
import { recipeInputSchema } from "@/lib/recipes/schema";
import { ALLERGENS } from "./allergens";

/** What the recipe writer must return. Images, category id and is_tested are filled in by the pipeline. */
export const generatedRecipeSchema = recipeInputSchema
  .omit({ category_id: true, featured_image: true, featured_image_alt: true, pinterest_image: true, pinterest_image_alt: true, is_tested: true })
  .extend({
    category_slug: z.string().trim().min(2).max(80),
    allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
    /** Alt text for the featured photo, describing the finished dish. */
    image_alt: z.string().trim().min(10).max(250),
    /** What the finished dish looks like, for the photo prompt and the photo check. */
    image_brief: z.string().trim().min(20).max(1000),
  });

export type GeneratedRecipe = z.output<typeof generatedRecipeSchema>;

export interface KeywordRow {
  id: string;
  keyword: string;
  category_id: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
}

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
}

export interface Issue {
  severity: "blocking" | "warning";
  field: string;
  message: string;
  source: "schema" | "readiness" | "consistency" | "allergens" | "seo" | "duplicate" | "review" | "photo";
}

/** One AI request's result, with what it cost. */
export interface AiResult<T> {
  output: T;
  provider: string;
  model: string;
  promptVersion: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** An AI request the pipeline can price before sending and record after. */
export interface AiStep<TInput, TOutput> {
  /** Worst-case cost in USD, checked against the daily budget before the call. */
  estimateUsd(input: TInput): number;
  run(input: TInput): Promise<AiResult<TOutput>>;
}

export interface WriterInput {
  keyword: KeywordRow;
  categories: CategoryOption[];
  /** Titles already on the site, so the writer avoids near-duplicates. */
  existingTitles: string[];
}

export interface RepairInput extends WriterInput {
  draft: GeneratedRecipe;
  issues: Issue[];
}

export interface ReviewVerdict {
  issues: Array<Pick<Issue, "severity" | "field" | "message">>;
}

export interface Photo {
  data: Uint8Array;
  mimeType: "image/webp" | "image/jpeg" | "image/png";
}

export interface PhotoVerdict {
  ok: boolean;
  problems: string[];
}

export interface AiProviders {
  writer: AiStep<WriterInput, unknown>;
  repairer: AiStep<RepairInput, unknown>;
  reviewer: AiStep<GeneratedRecipe, ReviewVerdict>;
  photographer: AiStep<GeneratedRecipe, Photo>;
  photoChecker: AiStep<{ recipe: GeneratedRecipe; photo: Photo }, PhotoVerdict>;
}

export interface ImageStore {
  /** Uploads and returns the public URL. */
  upload(path: string, photo: Photo): Promise<string>;
  remove(paths: string[]): Promise<void>;
}

export interface SiteRefresher {
  revalidate(slug: string): Promise<void>;
}

/** A failed AI request that was still billed, so its cost counts toward the daily budget. */
export class AiCallError extends Error {
  constructor(
    message: string,
    public readonly costUsd: number,
    public readonly provider: string,
    public readonly model: string,
  ) {
    super(message);
    this.name = "AiCallError";
  }
}
