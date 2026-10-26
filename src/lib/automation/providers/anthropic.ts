// Claude providers: the recipe writer, the repairer, the independent reviewer
// and the photo checker. Each call asks for JSON that matches a schema
// (structured outputs), so the reply can be parsed without guessing.
//
// Requests opt in to server-side fallbacks: if Claude declines a request, the
// API retries it on a fallback model. Cost is computed per model from
// usage.iterations, so a fallback is priced at its own rates.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { FALLBACK_PRICE_MODEL, TEXT_MODEL_PRICES, estimateTextCostUsd, textCostUsd, type TokenUsage } from "../cost";
import { AiCallError, type AiProviders, type AiResult, type AiStep, type GeneratedRecipe, type Photo, type PhotoVerdict, type RepairInput, type ReviewVerdict, type WriterInput } from "../types";
import {
  PHOTO_CHECK_JSON_SCHEMA,
  PHOTO_CHECK_SYSTEM,
  PROMPT_VERSION,
  RECIPE_JSON_SCHEMA,
  REVIEWER_SYSTEM,
  REVIEW_JSON_SCHEMA,
  WRITER_SYSTEM,
} from "./prompts";

export const DEFAULT_TEXT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Output limits include adaptive thinking, so they leave room for it. */
const MAX_TOKENS = { writer: 24_000, reviewer: 12_000, photoCheck: 6_000 } as const;
/** Tokens an image adds to a request (a 1024x1536 photo is about 2,100). */
const IMAGE_TOKENS = 2_500;

type Effort = "low" | "medium" | "high";

interface StreamParams {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: unknown[] }>;
  output_config: { effort: Effort; format: { type: "json_schema"; schema: Record<string, unknown> } };
  betas: string[];
  fallbacks: "default";
}

interface UsageIteration extends TokenUsage {
  type: string;
  model?: string | null;
}

export interface ClaudeReply {
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage: TokenUsage & { iterations?: UsageIteration[] | null };
}

/** The part of the Anthropic client the providers use, so tests can pass a fake. */
export interface ClaudeClient {
  beta: { messages: { stream(params: StreamParams): { finalMessage(): Promise<ClaudeReply> } } };
}

/** A billed Claude reply that cannot be used: declined, cut off, or not the requested JSON. */
export class ClaudeOutputError extends AiCallError {
  constructor(message: string, costUsd: number, model: string) {
    super(message, costUsd, "anthropic", model);
    this.name = "ClaudeOutputError";
  }
}

/** Rough, deliberately high token count for text: about 3 characters per token. */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Prices an iteration's model, falling back to the most expensive known model for one missing from the table. */
function priceModel(model: string | null | undefined, requested: string): string {
  const name = model || requested;
  return TEXT_MODEL_PRICES[name] ? name : FALLBACK_PRICE_MODEL;
}

/** Cost of a reply in USD, summed over its sampling iterations so each model is billed at its own rates. */
export function replyCostUsd(reply: ClaudeReply, requested: string): number {
  const iterations = (reply.usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (iterations.length === 0) return textCostUsd(priceModel(reply.model, requested), reply.usage);
  const total = iterations.reduce((sum, i) => sum + textCostUsd(priceModel(i.model, requested), i), 0);
  return Math.round(total * 10_000) / 10_000;
}

function replyText(reply: ClaudeReply): string {
  return reply.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

const reviewSchema = z.object({
  issues: z.array(z.object({ severity: z.enum(["blocking", "warning"]), field: z.string(), message: z.string() })),
});
const photoVerdictSchema = z.object({ ok: z.boolean(), problems: z.array(z.string()) });

export interface AnthropicProviderOptions {
  client?: ClaudeClient;
  model?: string;
  apiKey?: string;
}

/** Builds the Claude-backed providers. The photographer comes from the image provider. */
export function createAnthropicProviders(opts: AnthropicProviderOptions = {}): Omit<AiProviders, "photographer"> {
  const model = opts.model ?? DEFAULT_TEXT_MODEL;
  if (!TEXT_MODEL_PRICES[model]) throw new Error(`No price is configured for model "${model}".`);
  const client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY, maxRetries: 3 }) as unknown as ClaudeClient);

  /** Worst case: input and every output token billed at the most expensive model a fallback could use. */
  const estimate = (inputTokens: number, maxTokens: number) =>
    Math.max(estimateTextCostUsd(model, inputTokens, maxTokens), estimateTextCostUsd(FALLBACK_PRICE_MODEL, inputTokens, maxTokens));

  async function ask<T>(
    system: string,
    content: unknown[],
    schema: Record<string, unknown>,
    maxTokens: number,
    effort: Effort,
    parse: (json: unknown) => T,
  ): Promise<AiResult<T>> {
    const reply = await client.beta.messages
      .stream({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
        output_config: { effort, format: { type: "json_schema", schema } },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      })
      .finalMessage();

    const costUsd = replyCostUsd(reply, model);
    if (reply.stop_reason === "refusal") throw new ClaudeOutputError("Claude declined the request.", costUsd, reply.model || model);
    if (reply.stop_reason === "max_tokens") throw new ClaudeOutputError(`The reply was cut off at ${maxTokens} tokens.`, costUsd, reply.model || model);

    let json: unknown;
    try {
      json = JSON.parse(replyText(reply));
    } catch {
      throw new ClaudeOutputError("The reply was not valid JSON.", costUsd, reply.model || model);
    }
    let output: T;
    try {
      output = parse(json);
    } catch (error) {
      throw new ClaudeOutputError(`The reply had an unexpected shape: ${(error as Error).message}`, costUsd, reply.model || model);
    }
    return {
      output,
      provider: "anthropic",
      model: reply.model || model,
      promptVersion: PROMPT_VERSION,
      costUsd,
      inputTokens: reply.usage.input_tokens + (reply.usage.cache_read_input_tokens ?? 0) + (reply.usage.cache_creation_input_tokens ?? 0),
      outputTokens: reply.usage.output_tokens,
    };
  }

  const text = (value: string) => ({ type: "text", text: value });

  const writer: AiStep<WriterInput, unknown> = {
    estimateUsd: (input) => estimate(roughTokens(WRITER_SYSTEM + writerPrompt(input)), MAX_TOKENS.writer),
    run: (input) => ask(WRITER_SYSTEM, [text(writerPrompt(input))], RECIPE_JSON_SCHEMA, MAX_TOKENS.writer, "high", (json) => json),
  };

  const repairer: AiStep<RepairInput, unknown> = {
    estimateUsd: (input) => estimate(roughTokens(WRITER_SYSTEM + repairPrompt(input)), MAX_TOKENS.writer),
    run: (input) => ask(WRITER_SYSTEM, [text(repairPrompt(input))], RECIPE_JSON_SCHEMA, MAX_TOKENS.writer, "high", (json) => json),
  };

  const reviewer: AiStep<GeneratedRecipe, ReviewVerdict> = {
    estimateUsd: (recipe) => estimate(roughTokens(REVIEWER_SYSTEM + reviewPrompt(recipe)), MAX_TOKENS.reviewer),
    run: (recipe) => ask(REVIEWER_SYSTEM, [text(reviewPrompt(recipe))], REVIEW_JSON_SCHEMA, MAX_TOKENS.reviewer, "high", (json) => reviewSchema.parse(json)),
  };

  const photoChecker: AiStep<{ recipe: GeneratedRecipe; photo: Photo }, PhotoVerdict> = {
    estimateUsd: ({ recipe }) => estimate(roughTokens(PHOTO_CHECK_SYSTEM + photoCheckPrompt(recipe)) + IMAGE_TOKENS, MAX_TOKENS.photoCheck),
    run: ({ recipe, photo }) =>
      ask(
        PHOTO_CHECK_SYSTEM,
        [
          { type: "image", source: { type: "base64", media_type: photo.mimeType, data: Buffer.from(photo.data).toString("base64") } },
          text(photoCheckPrompt(recipe)),
        ],
        PHOTO_CHECK_JSON_SCHEMA,
        MAX_TOKENS.photoCheck,
        "medium",
        (json) => photoVerdictSchema.parse(json),
      ),
  };

  return { writer, repairer, reviewer, photoChecker };
}

function writerPrompt({ keyword, categories, existingTitles }: WriterInput): string {
  const lines = [
    `Target keyword: ${keyword.keyword}`,
    "",
    "Categories (use one slug for category_slug):",
    ...categories.map((c) => `- ${c.slug}: ${c.name}`),
  ];
  if (existingTitles.length > 0) {
    lines.push("", "Recipes already on the site. Write something clearly different from these:", ...existingTitles.slice(0, 300).map((t) => `- ${t}`));
  }
  return lines.join("\n");
}

function repairPrompt(input: RepairInput): string {
  return [
    writerPrompt(input),
    "",
    "A draft was written for this keyword but failed checks. Return the complete corrected recipe, fixing every blocking issue and as many warnings as make sense. Change only what the issues require.",
    "",
    "Issues:",
    ...input.issues.map((i) => `- [${i.severity}] ${i.field}: ${i.message}`),
    "",
    "Draft:",
    JSON.stringify(input.draft, null, 2),
  ].join("\n");
}

function reviewPrompt(recipe: GeneratedRecipe): string {
  const { image_brief: _brief, ...rest } = recipe;
  return `Review this recipe.\n\n${JSON.stringify(rest, null, 2)}`;
}

function photoCheckPrompt(recipe: GeneratedRecipe): string {
  return [
    `Recipe: ${recipe.title}`,
    `The photo should show: ${recipe.image_brief}`,
    `Ingredients: ${recipe.ingredients.map((i) => i.name).join(", ")}`,
  ].join("\n");
}
