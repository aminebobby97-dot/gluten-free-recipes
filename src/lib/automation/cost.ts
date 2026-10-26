// Cost tracking and the daily AI spending limit. Every AI call records its
// cost in generation_attempts; before each call the worker checks that today's
// spend plus a conservative estimate for the call stays under the limit set in
// automation_settings.daily_budget_usd.

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

interface TextModelPrice {
  /** US dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes cost 1.25x input. */
  cacheWrite: number;
}

/** Anthropic list prices (USD per million tokens), checked 2026-10-26. */
export const TEXT_MODEL_PRICES: Record<string, TextModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Possible server-side fallback models when a request is declined.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Price used for a model missing from the table: the most expensive one, so spend is never under-counted. */
export const FALLBACK_PRICE_MODEL = "claude-opus-4-8";

export class UnknownPriceError extends Error {
  constructor(model: string) {
    super(`No price is configured for model "${model}". Add it to TEXT_MODEL_PRICES before using it.`);
    this.name = "UnknownPriceError";
  }
}

/** Cost of one text request in USD, rounded up to 1/10,000 of a dollar. */
export function textCostUsd(model: string, usage: TokenUsage): number {
  const price = TEXT_MODEL_PRICES[model];
  if (!price) throw new UnknownPriceError(model);
  const dollars =
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
    1_000_000;
  // The small epsilon stops float noise (350.00000000000006) from rounding up a whole step.
  return Math.ceil(dollars * 10_000 - 1e-9) / 10_000;
}

/** Worst-case cost of a text request before it is sent: full input plus max_tokens of output. */
export function estimateTextCostUsd(model: string, inputTokens: number, maxOutputTokens: number): number {
  return textCostUsd(model, { input_tokens: inputTokens, output_tokens: maxOutputTokens });
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly estimateUsd: number,
    public readonly limitUsd: number,
  ) {
    super(
      `Daily AI budget reached: $${spentUsd.toFixed(2)} spent today, this call could cost up to $${estimateUsd.toFixed(2)}, limit $${limitUsd.toFixed(2)}.`,
    );
    this.name = "BudgetExceededError";
  }
}

/** Throws BudgetExceededError if the call could push today's spend over the limit. */
export function assertWithinBudget(spentUsd: number, estimateUsd: number, limitUsd: number): void {
  if (!(limitUsd > 0) || spentUsd + estimateUsd > limitUsd) {
    throw new BudgetExceededError(spentUsd, estimateUsd, limitUsd);
  }
}
