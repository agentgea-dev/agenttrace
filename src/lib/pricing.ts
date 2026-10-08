/**
 * MANUAL REFERENCE PRICE TABLE — hand-entered, not fetched.
 *
 * These are published list prices in USD per 1 million tokens as of the date in
 * PRICES_AS_OF. They are a *reference* for arithmetic, not a billing source:
 * vendors change prices, discount tiers exist, and batch/cached rates differ.
 *
 * AgentTrace never calls a pricing API at runtime. If a model is not in this
 * table, cost is reported as UNKNOWN rather than guessed — see `priceFor`.
 */

export const PRICES_AS_OF = "2026-10-08";

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
  /**
   * USD per 1M cached input tokens read. Per the GenAI semconv,
   * `gen_ai.usage.cache_read.input_tokens` is *included in* input_tokens, so
   * cost is computed as (input - cacheRead) at full rate + cacheRead at this rate.
   */
  cacheReadPerM: number;
}

/**
 * Keys are matched case-insensitively as substrings of the span's model
 * attribute, longest key first — so `gpt-4o-mini` wins over `gpt-4o`.
 */
export const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-sonnet-4-5": { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 },
  "claude-opus-4-1": { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 },
  "claude-3-5-haiku": { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.075 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6, cacheReadPerM: 0.1 },
  "gpt-4.1": { inputPerM: 2, outputPerM: 8, cacheReadPerM: 0.5 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4, cacheReadPerM: 0.275 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5, cacheReadPerM: 0.075 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.31 },
  "text-embedding-3-small": { inputPerM: 0.02, outputPerM: 0, cacheReadPerM: 0.02 },
  "text-embedding-3-large": { inputPerM: 0.13, outputPerM: 0, cacheReadPerM: 0.13 },
};

const KEYS_BY_SPECIFICITY = Object.keys(PRICE_TABLE).sort((a, b) => b.length - a.length);

export function priceFor(model: string | null): ModelPrice | null {
  if (!model) return null;
  const needle = model.toLowerCase();
  for (const key of KEYS_BY_SPECIFICITY) {
    if (needle.includes(key)) return PRICE_TABLE[key];
  }
  return null;
}

export interface CostInput {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * Returns USD cost, or `unknown: true` when the model has no price entry.
 * cacheRead tokens are subtracted from input before charging full rate because
 * the semconv states they are already counted inside `input_tokens`.
 */
export function costOf({ model, inputTokens, outputTokens, cacheReadTokens }: CostInput): {
  usd: number;
  unknown: boolean;
} {
  const price = priceFor(model);
  if (!price) return { usd: 0, unknown: inputTokens > 0 || outputTokens > 0 };
  const cached = Math.min(Math.max(cacheReadTokens, 0), Math.max(inputTokens, 0));
  const fullInput = Math.max(inputTokens, 0) - cached;
  const usd =
    (fullInput / 1_000_000) * price.inputPerM +
    (cached / 1_000_000) * price.cacheReadPerM +
    (Math.max(outputTokens, 0) / 1_000_000) * price.outputPerM;
  return { usd, unknown: false };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
