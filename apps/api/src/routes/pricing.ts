import type { FastifyInstance } from "fastify";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import {
  buildPricingCatalog,
  getModelPrice,
} from "../pricing/catalog.js";
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  MIN_CALL_USDC,
  WEB_SEARCH_PRICE_USDC,
  toCaip2ChainId,
} from "../pricing/constants.js";
import {
  estimatePromptTokens,
  quoteCallPrice,
  resolveMaxCompletionTokens,
} from "../pricing/quote.js";

interface PricingRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  chainId: number;
  webSearchPriceUsdc?: number;
  webSearchConfigured?: boolean;
}

function formatUsd(amount: number): string {
  return amount.toFixed(6);
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRouteDeps,
): Promise<void> {
  app.get("/v1/pricing", async (request) => {
    const statuses = deps.healthStore.getAll();
    const healthyProviders = deps.providers.filter(
      (provider) => statuses[provider.name]?.healthy,
    );
    const catalog = buildPricingCatalog(healthyProviders);
    const query = request.query as Record<string, string | undefined>;
    const modelId = query.model?.trim();

    if (modelId) {
      const entry = getModelPrice(catalog, modelId);
      if (!entry) {
        return {
          currency: "USDC",
          network: toCaip2ChainId(deps.chainId),
          min_call_usdc: formatUsd(MIN_CALL_USDC),
          default_max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
          model: null,
          quote: null,
          error: `Model "${modelId}" is not available from healthy providers`,
        };
      }

      const maxCompletionTokens = resolveMaxCompletionTokens(
        query.max_tokens ? Number(query.max_tokens) : undefined,
        query.max_completion_tokens
          ? Number(query.max_completion_tokens)
          : undefined,
      );
      const promptTokens =
        query.prompt_tokens && Number(query.prompt_tokens) > 0
          ? Number(query.prompt_tokens)
          : 1;
      const quote = quoteCallPrice({
        listPricePer1k: entry.listPricePer1kTokens,
        promptTokens,
        maxCompletionTokens,
      });

      return {
        currency: "USDC",
        network: toCaip2ChainId(deps.chainId),
        min_call_usdc: formatUsd(MIN_CALL_USDC),
        default_max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
        model: {
          id: entry.id,
          provider: entry.provider,
          list_price_per_1k_tokens: formatUsd(entry.listPricePer1kTokens),
          cost_price_per_1k_tokens: formatUsd(entry.costPer1kTokens),
        },
        quote: {
          prompt_tokens: quote.promptTokens,
          max_completion_tokens: quote.maxCompletionTokens,
          estimated_tokens: quote.estimatedTokens,
          quoted_amount_usdc: formatUsd(quote.quotedAmount),
        },
      };
    }

    return {
      currency: "USDC",
      network: toCaip2ChainId(deps.chainId),
      min_call_usdc: formatUsd(MIN_CALL_USDC),
      default_max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
      models: catalog.map((entry) => ({
        id: entry.id,
        provider: entry.provider,
        list_price_per_1k_tokens: formatUsd(entry.listPricePer1kTokens),
        cost_price_per_1k_tokens: formatUsd(entry.costPer1kTokens),
      })),
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
