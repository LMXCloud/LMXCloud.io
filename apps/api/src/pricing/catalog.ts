import { resolveSupportedModel } from "@lmxcloud/shared";
import type { ProviderAdapter } from "../providers/types.js";
import { PRICING_MARGIN_PCT } from "./constants.js";
import { buildPriceBook, type ModelPrice } from "./rate-card.js";

export interface ModelPriceEntry extends ModelPrice {
  /** LMX model id (same as `model`). */
  id: string;
  /** Providers in `providers` that are priced for this model and can serve it. */
  availableOn: string[];
}

/**
 * Published per-model prices (x402 quotes, /v1/pricing, Bazaar metadata),
 * limited to models at least one of `providers` can serve at a verified rate.
 * The price itself does not depend on which providers are passed in.
 */
export function buildPricingCatalog(
  providers: ProviderAdapter[],
  marginPct = PRICING_MARGIN_PCT,
): ModelPriceEntry[] {
  const entries: ModelPriceEntry[] = [];
  for (const price of buildPriceBook(marginPct)) {
    const availableOn = providers
      .filter(
        (provider) =>
          provider.name in price.providerCosts && provider.supportsModel(price.model),
      )
      .map((provider) => provider.name);
    if (availableOn.length === 0) continue;
    entries.push({ ...price, id: price.model, availableOn });
  }
  return entries;
}

export function getModelPrice(
  catalog: ModelPriceEntry[],
  modelId: string,
): ModelPriceEntry | undefined {
  const canonical = resolveSupportedModel(modelId)?.alias ?? modelId;
  return catalog.find((entry) => entry.id === canonical);
}
