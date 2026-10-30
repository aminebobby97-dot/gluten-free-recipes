// Food photos from OpenAI Images, optimized with sharp before upload. The
// pipeline asks only for the landscape 3:2 WebP for the site (Pinterest Pins
// are drawn from that photo); portrait 2:3 is still supported here.

import OpenAI from "openai";
import sharp from "sharp";
import { AiCallError, type AiStep, type Photo, type PhotoOrientation, type PhotoRequest } from "../types";
import { roughTokens } from "./anthropic";

export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const IMAGE_PROMPT_VERSION = "photo-v2";

/**
 * OpenAI list prices (USD per million tokens) from developers.openai.com/api/docs/pricing,
 * checked 2026-10-26. Images are billed by tokens, so the cost comes from the reply's usage.
 */
export const IMAGE_MODEL_PRICES: Record<string, { textInput: number; imageInput: number; imageOutput: number }> = {
  "gpt-image-2": { textInput: 2.5, imageInput: 4, imageOutput: 15 },
};

/** A generous ceiling on output tokens for one high-quality 1536x1024 image, used for the budget check. */
const OUTPUT_TOKEN_CEILING = 12_000;

/** Generated size and the size saved after optimization, per orientation. */
const SIZES: Record<PhotoOrientation, { generate: "1536x1024" | "1024x1536"; width: number; height: number }> = {
  landscape: { generate: "1536x1024", width: 1536, height: 1024 },
  portrait: { generate: "1024x1536", width: 1000, height: 1500 },
};

type Quality = "low" | "medium" | "high";

/** The part of the OpenAI client the photographer uses, so tests can pass a fake. */
export interface ImageClient {
  images: {
    generate(params: {
      model: string;
      prompt: string;
      size: string;
      quality: Quality;
      output_format: "png";
      moderation: "auto";
      n: 1;
    }): Promise<{ data?: Array<{ b64_json?: string | null }>; usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { text_tokens: number; image_tokens: number } } }>;
  };
}

/** Flat dishes look best, and most realistic, from directly above. */
const FLAT_DISH = /\b(pizza|crust|flatbread|focaccia|tart|galette|quiche|pie|cookies?|pancakes?|crepes?|tortillas?|naan|socca|frittata|sheet[- ]pan|bars?|brownies?|blondies?)\b/i;

/** The most earlier problems repeated in the prompt, newest first. */
const MAX_AVOID = 6;

export function imagePrompt({ recipe, orientation, avoid = [] }: PhotoRequest): string {
  const frame = orientation === "portrait" ? "Vertical 2:3 composition with the dish in the lower two thirds." : "Horizontal 3:2 composition with the dish slightly off center.";
  const angle = FLAT_DISH.test(recipe.title)
    ? "Camera directly overhead (top-down flat lay), the whole dish in view on a plain board, baking sheet or plate."
    : "Camera at a natural 30 to 45 degree angle, the whole dish in view on a plain plate, board or baking dish.";
  const lessons = [...new Set(avoid.map((p) => p.trim()).filter(Boolean))].slice(-MAX_AVOID);
  return [
    `Realistic editorial food photograph of ${recipe.title}.`,
    recipe.image_brief,
    `It contains only these foods: ${recipe.ingredients.map((i) => i.name).join(", ")}.`,
    frame,
    angle,
    // Simple scenes are what image models render believably; these rules win over the brief.
    "Keep the scene simple: one dish, at most two plain props, nothing folded, rolled, lifted, cut away or tilted to show an underside or a hidden side.",
    "No parchment or paper shapes, no utensils touching, cutting or lying on the food.",
    "Baked doughs and crusts are evenly golden brown with a realistic dry, matte surface; no melted cheese, sauce or toppings that are not in the ingredient list.",
    "If anything above conflicts with these composition rules, follow these rules.",
    "Shot on a full-frame camera with a 50mm lens, natural window light, true-to-life colors and textures, appetizing but not glossy or oversaturated.",
    "No people, no hands, no text, no labels, no logos, no watermarks. No bread, pasta, crackers or pastries that are not part of this recipe.",
    ...(lessons.length ? [`An earlier photo of this dish was rejected for these problems; make sure none of them appears: ${lessons.join(" ")}`] : []),
  ].join(" ");
}

/** Converts the generated PNG to an optimized WebP of the target size, dropping metadata. */
export async function optimizePhoto(png: Uint8Array, orientation: PhotoOrientation): Promise<Photo> {
  const { width, height } = SIZES[orientation];
  const data = await sharp(png).resize(width, height, { fit: "cover", withoutEnlargement: false }).webp({ quality: 82, effort: 5 }).toBuffer();
  return { data: new Uint8Array(data), mimeType: "image/webp" };
}

export interface OpenAiPhotographerOptions {
  client?: ImageClient;
  model?: string;
  quality?: Quality;
  apiKey?: string;
}

export function createOpenAiPhotographer(opts: OpenAiPhotographerOptions = {}): AiStep<PhotoRequest, Photo> {
  const model = opts.model ?? DEFAULT_IMAGE_MODEL;
  const price = IMAGE_MODEL_PRICES[model];
  if (!price) throw new Error(`No price is configured for image model "${model}".`);
  const quality = opts.quality ?? "high";
  const client = opts.client ?? (new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY, maxRetries: 3 }) as unknown as ImageClient);

  const cost = (textTokens: number, imageTokens: number, outputTokens: number) =>
    Math.ceil(((textTokens * price.textInput + imageTokens * price.imageInput + outputTokens * price.imageOutput) / 1_000_000) * 10_000 - 1e-9) / 10_000;

  return {
    estimateUsd: (input) => cost(roughTokens(imagePrompt(input)), 0, OUTPUT_TOKEN_CEILING),
    async run(input) {
      const prompt = imagePrompt(input);
      const response = await client.images.generate({
        model,
        prompt,
        size: SIZES[input.orientation].generate,
        quality,
        output_format: "png",
        moderation: "auto",
        n: 1,
      });
      const usage = response.usage;
      // Without usage, charge the ceiling so the budget is never under-counted.
      const costUsd = usage
        ? cost(usage.input_tokens_details?.text_tokens ?? usage.input_tokens, usage.input_tokens_details?.image_tokens ?? 0, usage.output_tokens)
        : cost(roughTokens(prompt), 0, OUTPUT_TOKEN_CEILING);

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new AiCallError("OpenAI returned no image.", costUsd, "openai", model);
      let photo: Photo;
      try {
        photo = await optimizePhoto(Buffer.from(b64, "base64"), input.orientation);
      } catch (error) {
        throw new AiCallError(`The generated image could not be processed: ${(error as Error).message}`, costUsd, "openai", model);
      }
      return { output: photo, provider: "openai", model, promptVersion: IMAGE_PROMPT_VERSION, costUsd, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
    },
  };
}
