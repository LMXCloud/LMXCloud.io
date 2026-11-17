/**
 * Per-model pricing (Jason gate 3).
 *
 * Two tables:
 *   1. PROVIDER_RATES: what each provider charges LMX, per upstream model, in
 *      USD per 1M tokens, copied from the provider's own published rates with
 *      the date they were read. These are the router's costs.
 *   2. The published price book, built from (1): one price per LMX model, the
 *      same whichever provider serves the request. That is what callers pay.
 *
 * Billing rules (also published on GET /v1/pricing):
 *   - Units: USD per 1M tokens, billed per request.
 *   - prompt_tokens minus cached_prompt_tokens are billed at the input rate.
 *     cached_prompt_tokens are billed at the cached-input rate. Cache writes
 *     have no separate rate at any current provider and are inside
 *     prompt_tokens, so they bill as ordinary input.
 *   - completion_tokens are billed at the output rate. reasoning_tokens are
 *     inside completion_tokens and are not billed a second time.
 *   - If a provider reports a total but not the prompt/completion split, the
 *     whole total is billed at the output rate (the higher one) and the
 *     response says so in cost_basis.
 *   - Published rate = highest provider cost for that model x (1 + markup),
 *     rounded up to 4 decimal places per 1M tokens.
 *   - Request cost is rounded half-up to 8 decimal places (USD).
 *   - A model or provider with no verified rate is never routed: no request
 *     is ever charged at a guessed price.
 */
import {
  isOpenAiProprietaryModelId,
  resolveSupportedModel,
  SUPPORTED_MODELS,
} from "@lmxcloud/shared";
import { roundCredits } from "../credits/pricing.js";
import { expectedProviderModelId } from "../providers/model-maps.js";
import { PRICING_MARGIN_PCT } from "./constants.js";

/** Bump this when any rate, the markup or a billing rule changes. */
export const PRICING_VERSION = "2026-11-17.1";
/** First day this version is charged. Set to the production deploy date. */
export const PRICING_EFFECTIVE_FROM = "2026-11-18";

export interface TokenRates {
  /** USD per 1M uncached prompt tokens. */
  input: number;
  /** USD per 1M output tokens (reasoning tokens included). */
  output: number;
  /** USD per 1M cached prompt tokens. */
  cachedInput: number;
}

export interface RateSource {
  url: string;
  /** ISO timestamp the rates were read. */
  readAt: string;
  note: string;
}

export const RATE_SOURCES: Record<string, RateSource> = {
  ionet: {
    url: "https://api.intelligence.io.solutions/api/v1/models",
    readAt: "2026-11-17T18:53:16Z",
    note:
      "io.net GET /models input_token_price, output_token_price and " +
      "cache_read_token_price (USD per token), multiplied by 1M.",
  },
  akash: {
    url: "https://akashml.com/pricing",
    readAt: "2026-11-17T18:58:00Z",
    note: "AkashML published list rates (input, output, cache read per 1M).",
  },
};

/** Provider cost per upstream model id, USD per 1M tokens. */
export const PROVIDER_RATES: Record<string, Record<string, TokenRates>> = {
  ionet: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0.4786, output: 1.0946, cachedInput: 0.2393 },
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": { input: 0.35, output: 1.075, cachedInput: 0.175 },
    "Qwen/Qwen3.6-35B-A3B": { input: 0.13, output: 0.988, cachedInput: 0.065 },
    "Qwen/Qwen3.6-27B": { input: 0.399, output: 3.67, cachedInput: 0.1995 },
    "Qwen/Qwen3-Next-80B-A3B-Instruct": { input: 0.09925, output: 1.1825, cachedInput: 0.049625 },
    "Intel/Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar": { input: 0.325, output: 1.25, cachedInput: 0.1625 },
    "deepseek-ai/DeepSeek-V4-Flash": { input: 0.288, output: 0.556, cachedInput: 0.144 },
    "deepseek-ai/DeepSeek-V4-Pro": { input: 1.4288, output: 2.7996, cachedInput: 0.7144 },
    "deepseek-ai/DeepSeek-V3.2": { input: 1.50176, output: 2.25392, cachedInput: 0.75088 },
    "deepseek-ai/DeepSeek-R1-0528": { input: 0.523667, output: 2.205333, cachedInput: 0.261834 },
    "zai-org/GLM-5.2": { input: 1.2614, output: 5.32, cachedInput: 0.6307 },
    "zai-org/GLM-5.1": { input: 1.34428, output: 4.22488, cachedInput: 0.67214 },
    "zai-org/GLM-5": { input: 0.94, output: 3.008, cachedInput: 0.47 },
    "zai-org/GLM-4.7": { input: 0.48408, output: 1.95584, cachedInput: 0.24204 },
    "zai-org/GLM-4.7-Flash": { input: 0.06525, output: 0.4, cachedInput: 0.032625 },
    "zai-org/GLM-4.6": { input: 0.496, output: 1.95, cachedInput: 0.248 },
    "zai-org/GLM-4.5-Air": { input: 0.156667, output: 0.936667, cachedInput: 0.078334 },
    "mistralai/Mistral-Nemo-Instruct-2407": { input: 0.05675, output: 0.06, cachedInput: 0.028375 },
    "moonshotai/Kimi-K2.5": { input: 0.5384, output: 2.835, cachedInput: 0.2692 },
    "moonshotai/Kimi-K2.6": { input: 0.7799, output: 3.632, cachedInput: 0.38995 },
    "moonshotai/Kimi-K2.7-Code": { input: 0.9525, output: 4.3, cachedInput: 0.47625 },
    "moonshotai/Kimi-K2-Thinking": { input: 0.6, output: 2.5, cachedInput: 0.3 },
    "moonshotai/Kimi-K2-Instruct-0905": { input: 0.57, output: 2.3, cachedInput: 0.285 },
    "openai/gpt-oss-120b": { input: 0.168, output: 0.63, cachedInput: 0.084 },
    "openai/gpt-oss-20b": { input: 0.055, output: 0.176, cachedInput: 0.0275 },
    "google/gemma-4-26b-a4b-it": { input: 0.0993, output: 0.315, cachedInput: 0.04965 },
    "MiniMaxAI/MiniMax-M2.5": { input: 0.287, output: 1.126, cachedInput: 0.1435 },
    // Not listed by io.net on 2026-11-17, so not priced and not routed:
    // meta-llama/Llama-3.2-90B-Vision-Instruct
  },
  akash: {
    "meta-llama/Llama-3.3-70B-Instruct": { input: 0.2, output: 0.52, cachedInput: 0.1 },
    "Qwen/Qwen3.6-35B-A3B": { input: 0.1, output: 0.9, cachedInput: 0.05 },
    // Not on AkashML's price list on 2026-11-17, so not routed to Akash:
    // deepseek-ai/DeepSeek-V4-Flash, zai-org/GLM-5.2
  },
  // nosana: billed per GPU-hour per deployment, no per-token rate. Not routed.
  // aethir, together: no verified rates on file. Not routed.
};

/** Provider cost for one LMX model on one provider, or undefined when unpriced. */
export function providerRate(provider: string, model: string): TokenRates | undefined {
  const upstream = expectedProviderModelId(provider, resolveCanonical(model));
  if (!upstream) return undefined;
  return PROVIDER_RATES[provider]?.[upstream];
}

/** True when this provider has a verified rate for this model and may serve it. */
export function isPricedOnProvider(provider: string, model: string): boolean {
  return providerRate(provider, model) !== undefined;
}

function resolveCanonical(model: string): string {
  return resolveSupportedModel(model)?.alias ?? model;
}

function ceil4(value: number): number {
  // Small epsilon so float noise (0.1625000000001) never rounds up a cent-fraction.
  return Math.ceil(value * 1e4 - 1e-7) / 1e4;
}

export interface ModelPrice {
  /** LMX model id. */
  model: string;
  /** Published per-1M rates the caller pays. */
  rates: TokenRates;
  /** Provider costs behind the price, per provider. */
  providerCosts: Record<string, TokenRates>;
  pricingVersion: string;
}

/** Published price for one model: highest provider cost x (1 + markup), rounded up. */
export function buildModelPrice(
  model: string,
  marginPct = PRICING_MARGIN_PCT,
): ModelPrice | undefined {
  const supported = resolveSupportedModel(model);
  if (!supported || isOpenAiProprietaryModelId(supported.alias)) return undefined;

  const providerCosts: Record<string, TokenRates> = {};
  for (const provider of supported.providers) {
    const rate = providerRate(provider, supported.alias);
    if (rate) providerCosts[provider] = rate;
  }
  const costs = Object.values(providerCosts);
  if (costs.length === 0) return undefined;

  const max = (key: keyof TokenRates) => Math.max(...costs.map((rate) => rate[key]));
  return {
    model: supported.alias,
    rates: {
      input: ceil4(max("input") * (1 + marginPct)),
      output: ceil4(max("output") * (1 + marginPct)),
      cachedInput: ceil4(max("cachedInput") * (1 + marginPct)),
    },
    providerCosts,
    pricingVersion: PRICING_VERSION,
  };
}

/** Published prices for every priced model, sorted by id. */
export function buildPriceBook(marginPct = PRICING_MARGIN_PCT): ModelPrice[] {
  const seen = new Set<string>();
  const book: ModelPrice[] = [];
  for (const model of SUPPORTED_MODELS) {
    if (seen.has(model.alias)) continue;
    seen.add(model.alias);
    const price = buildModelPrice(model.alias, marginPct);
    if (price) book.push(price);
  }
  return book.sort((a, b) => a.model.localeCompare(b.model));
}

/** Price lookup used by the chat route. Injected so tests can supply their own. */
export interface PriceBook {
  priceFor(model: string): ModelPrice | undefined;
}

export function createPriceBook(marginPct = PRICING_MARGIN_PCT): PriceBook {
  const byModel = new Map(buildPriceBook(marginPct).map((price) => [price.model, price]));
  return {
    priceFor(model: string) {
      return byModel.get(resolveCanonical(model));
    },
  };
}

export type CostBasis =
  /** Billed from the prompt/completion split (the normal case). */
  | "prompt_completion"
  /** Split missing: the reported total billed at the output rate. */
  | "total_tokens_at_output_rate"
  /** No token counts: nothing could be billed. */
  | "unavailable";

export interface TokenCounts {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_prompt_tokens: number | null;
}

export interface RequestCost {
  /** USD, rounded half-up to 8 decimal places. */
  amount: number;
  basis: CostBasis;
  /** Tokens billed at each rate. Their sum is what was charged for. */
  billed: { input: number; cached_input: number; output: number };
  rates: TokenRates;
  pricingVersion: string;
}

/** Cost of one request at a published price. Pure: same counts, same price, same answer. */
export function priceRequest(price: ModelPrice, usage: TokenCounts): RequestCost {
  const { rates } = price;
  let billed = { input: 0, cached_input: 0, output: 0 };
  let basis: CostBasis;

  if (usage.prompt_tokens !== null && usage.completion_tokens !== null) {
    const cached = Math.min(usage.cached_prompt_tokens ?? 0, usage.prompt_tokens);
    billed = {
      input: usage.prompt_tokens - cached,
      cached_input: cached,
      output: usage.completion_tokens,
    };
    basis = "prompt_completion";
  } else if (usage.total_tokens !== null) {
    billed = { input: 0, cached_input: 0, output: usage.total_tokens };
    basis = "total_tokens_at_output_rate";
  } else {
    basis = "unavailable";
  }

  const raw =
    (billed.input * rates.input +
      billed.cached_input * rates.cachedInput +
      billed.output * rates.output) /
    1e6;

  return {
    amount: roundCredits(raw),
    basis,
    billed,
    rates,
    pricingVersion: price.pricingVersion,
  };
}

/** Upper bound for a request before it runs (x402 quotes, stream reservations). */
export function ceilingCost(
  price: ModelPrice,
  promptTokens: number,
  maxCompletionTokens: number,
): number {
  return roundCredits(
    (promptTokens * price.rates.input + maxCompletionTokens * price.rates.output) / 1e6,
  );
}

/**
 * What LMX paid the provider for this request, per 1k billed tokens, at the
 * provider's own rates. Recorded as usage_events.unit_price so margin can be
 * tracked per request. null when the provider has no rate or nothing was billed.
 */
export function providerCostPer1k(
  provider: string,
  model: string,
  cost: RequestCost,
): number | null {
  const rate = providerRate(provider, model);
  const tokens = cost.billed.input + cost.billed.cached_input + cost.billed.output;
  if (!rate || tokens === 0) return null;
  const paid =
    (cost.billed.input * rate.input +
      cost.billed.cached_input * rate.cachedInput +
      cost.billed.output * rate.output) /
    1e6;
  return roundCredits((paid / tokens) * 1000);
}
