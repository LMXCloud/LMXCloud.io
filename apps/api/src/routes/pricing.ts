import type { FastifyInstance } from "fastify";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import {
  buildPricingCatalog,
  getModelPrice,
  type ModelPriceEntry,
} from "../pricing/catalog.js";
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  MIN_CALL_USDC,
  PRICING_MARGIN_PCT,
  WEB_SEARCH_PRICE_USDC,
  toCaip2ChainId,
} from "../pricing/constants.js";
import {
  estimatePromptTokens,
  quoteCallPrice,
  resolveMaxCompletionTokens,
} from "../pricing/quote.js";
import {
  PRICING_EFFECTIVE_FROM,
  PRICING_VERSION,
  RATE_SOURCES,
  type TokenRates,
} from "../pricing/rate-card.js";

interface PricingRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  chainId: number;
  /** Markup over provider cost; the same value the chat route and x402 quotes use. */
  marginPct?: number;
  webSearchPriceUsdc?: number;
  webSearchConfigured?: boolean;
}

function formatUsd(amount: number): string {
  return amount.toFixed(6);
}

/** Billing rules, published with the rates so a charge can be checked from this response alone. */
export const billingRules = (marginPct: number) => ({
  unit: "USD per 1M tokens",
  markup_pct: Math.round(marginPct * 10000) / 100,
  rate_rule:
    "Each published rate is the highest verified provider cost for that model x (1 + markup), rounded up to 4 decimal places. The price is the same whichever provider serves the request.",
  formula:
    "cost = ((prompt_tokens - cached_prompt_tokens) x input_per_1m + cached_prompt_tokens x cached_input_per_1m + completion_tokens x output_per_1m) / 1,000,000",
  rounding: "Per request, half-up to 8 decimal places (USD).",
  cached_input:
    "cached_prompt_tokens (prompt_tokens_details.cached_tokens) bill at cached_input_per_1m. Cache writes have no separate rate and bill as ordinary input.",
  reasoning:
    "reasoning_tokens are part of completion_tokens and bill once, at output_per_1m.",
  missing_split:
    "If a provider reports total_tokens without the prompt/completion split, the total bills at output_per_1m and lmx.usage cost_basis says total_tokens_at_output_rate.",
  missing_usage:
    "If a provider reports no token counts, the request is charged 0 and cost_basis says unavailable.",
  unpriced:
    "A model or provider without a verified rate is not routed. No request is charged at a guessed rate.",
  balance_callers: "Charged the metered cost above after the request completes.",
  x402_callers:
    "Pay the quoted ceiling up front: estimated prompt tokens x input_per_1m + max completion tokens x output_per_1m, with a minimum of min_call_usdc. Unused tokens are not refunded.",
});

function formatRates(rates: TokenRates) {
  return {
    input_per_1m: rates.input,
    cached_input_per_1m: rates.cachedInput,
    output_per_1m: rates.output,
  };
}

function modelRow(entry: ModelPriceEntry, availableOn: string[]) {
  return {
    id: entry.id,
    ...formatRates(entry.rates),
    available: availableOn.length > 0,
    available_on: availableOn,
    provider_costs: Object.fromEntries(
      Object.entries(entry.providerCosts).map(([provider, rates]) => [
        provider,
        formatRates(rates),
      ]),
    ),
  };
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRouteDeps,
): Promise<void> {
  app.get("/v1/pricing", async (request) => {
    const statuses = deps.healthStore.getAll();
    const healthy = deps.providers.filter((provider) => statuses[provider.name]?.healthy);
    // Every priced model this deployment can route, healthy or not. Price never depends on health.
    const marginPct = deps.marginPct ?? PRICING_MARGIN_PCT;
    const catalog = buildPricingCatalog(deps.providers, marginPct);
    const healthyCatalog = buildPricingCatalog(healthy, marginPct);
    const availableOn = (id: string) => getModelPrice(healthyCatalog, id)?.availableOn ?? [];

    const header = {
      currency: "USD",
      x402_settlement: { asset: "USDC", network: toCaip2ChainId(deps.chainId) },
      pricing_version: PRICING_VERSION,
      effective_from: PRICING_EFFECTIVE_FROM,
      billing: billingRules(marginPct),
      sources: RATE_SOURCES,
      min_call_usdc: formatUsd(MIN_CALL_USDC),
      default_max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
    };

    const query = request.query as Record<string, string | undefined>;
    const modelId = query.model?.trim();

    if (modelId) {
      const entry = getModelPrice(catalog, modelId);
      if (!entry) {
        return {
          ...header,
          model: null,
          quote: null,
          error: `Model "${modelId}" has no verified price on this deployment`,
        };
      }

      const maxCompletionTokens = resolveMaxCompletionTokens(
        query.max_tokens ? Number(query.max_tokens) : undefined,
        query.max_completion_tokens ? Number(query.max_completion_tokens) : undefined,
      );
      const promptTokens =
        query.prompt_tokens && Number(query.prompt_tokens) > 0
          ? Number(query.prompt_tokens)
          : 1;
      const quote = quoteCallPrice({ price: entry, promptTokens, maxCompletionTokens });

      return {
        ...header,
        model: modelRow(entry, availableOn(entry.id)),
        quote: {
          prompt_tokens: quote.promptTokens,
          max_completion_tokens: quote.maxCompletionTokens,
          estimated_tokens: quote.estimatedTokens,
          quoted_amount_usdc: formatUsd(quote.quotedAmount),
        },
      };
    }

    return {
      ...header,
      models: catalog.map((entry) => modelRow(entry, availableOn(entry.id))),
      tools: {
        web_search: {
          provider: "brave",
          price_usdc: formatUsd(deps.webSearchPriceUsdc ?? WEB_SEARCH_PRICE_USDC),
          pricing: "per_call",
          configured: deps.webSearchConfigured ?? false,
          route: "/v1/web/search",
        },
      },
    };
  });
}
