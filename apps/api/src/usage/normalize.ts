/**
 * One usage shape for every chat response, whatever the provider sent and
 * whether or not the response streamed.
 *
 * Rule: a token count the provider did not report is `null` and is named in
 * `unavailable`. It is never filled in as 0. A count the router computed
 * rather than read (total = prompt + completion) is named in `derived`.
 */

import type { CostBasis, RequestCost } from "../pricing/rate-card.js";

export const LMX_USAGE_SCHEMA = "lmx.usage/1" as const;

export const LMX_USAGE_FIELDS = [
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "reasoning_tokens",
  "cached_prompt_tokens",
] as const;

export type LmxUsageField = (typeof LMX_USAGE_FIELDS)[number];

/** Where the token counts came from. */
export type LmxUsageSource =
  /** prompt, completion and total all reported (total may be derived). */
  | "provider"
  /** Some core counts reported, others missing. */
  | "provider_partial"
  /** The provider reported no usable counts. */
  | "unavailable";

/**
 * What the charged cost was computed from (see pricing/rate-card.ts):
 * prompt_completion = the normal split; total_tokens_at_output_rate = only a
 * total was reported, billed at the output rate; unavailable = no counts, 0 charged.
 */
export type LmxCostBasis = CostBasis;

/** The charge for this request, with everything needed to recompute it. */
export interface LmxCost {
  /** USD charged (balance callers) or metered (x402), half-up to 8 decimals. */
  amount_usd: number;
  pricing_version: string;
  /** Published rates applied, USD per 1M tokens. */
  rates_per_1m: { input: number; cached_input: number; output: number };
  /** Tokens billed at each rate. */
  billed_tokens: { input: number; cached_input: number; output: number };
}

export interface LmxUsage {
  schema: typeof LMX_USAGE_SCHEMA;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  /** Reasoning tokens inside completion_tokens, when the provider breaks them out. */
  reasoning_tokens: number | null;
  /** Cached tokens inside prompt_tokens, when the provider breaks them out. */
  cached_prompt_tokens: number | null;
  source: LmxUsageSource;
  /** Fields the provider did not report. Their values above are null. */
  unavailable: LmxUsageField[];
  /** Fields the router computed rather than read from the provider. */
  derived: LmxUsageField[];
  cost_basis: LmxCostBasis;
  /** null until the router prices the request (and on responses with no price). */
  cost: LmxCost | null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Normalize a provider's `usage` object (OpenAI-compatible, possibly partial,
 * possibly absent) into the LMX shape.
 */
export function normalizeUsage(raw: unknown): LmxUsage {
  const usage = record(raw);
  const promptDetails = record(usage?.prompt_tokens_details);
  const completionDetails = record(usage?.completion_tokens_details);

  const values: Record<LmxUsageField, number | null> = {
    prompt_tokens: count(usage?.prompt_tokens),
    completion_tokens: count(usage?.completion_tokens),
    total_tokens: count(usage?.total_tokens),
    reasoning_tokens: count(completionDetails?.reasoning_tokens),
    cached_prompt_tokens: count(promptDetails?.cached_tokens),
  };

  const derived: LmxUsageField[] = [];
  if (
    values.total_tokens === null &&
    values.prompt_tokens !== null &&
    values.completion_tokens !== null
  ) {
    values.total_tokens = values.prompt_tokens + values.completion_tokens;
    derived.push("total_tokens");
  }

  const unavailable = LMX_USAGE_FIELDS.filter((field) => values[field] === null);
  const core = ["prompt_tokens", "completion_tokens", "total_tokens"] as const;
  const coreReported = core.filter((field) => values[field] !== null).length;
  const source: LmxUsageSource =
    coreReported === core.length ? "provider" : coreReported > 0 ? "provider_partial" : "unavailable";

  return {
    schema: LMX_USAGE_SCHEMA,
    ...values,
    source,
    unavailable,
    derived,
    cost_basis:
      values.prompt_tokens !== null && values.completion_tokens !== null
        ? "prompt_completion"
        : values.total_tokens !== null
          ? "total_tokens_at_output_rate"
          : "unavailable",
    cost: null,
  };
}

/** The same usage with the request's priced cost filled in. */
export function withCost(usage: LmxUsage, cost: RequestCost): LmxUsage {
  return {
    ...usage,
    cost_basis: cost.basis,
    cost: {
      amount_usd: cost.amount,
      pricing_version: cost.pricingVersion,
      rates_per_1m: {
        input: cost.rates.input,
        cached_input: cost.rates.cachedInput,
        output: cost.rates.output,
      },
      billed_tokens: { ...cost.billed },
    },
  };
}

/** Header value for non-streaming responses: the same object, compact JSON. */
export function usageHeaderValue(usage: LmxUsage): string {
  return JSON.stringify(usage);
}
