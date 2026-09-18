import { isOpenAiProprietaryModelId } from "@lmxcloud/shared";
import type { ProviderAdapter } from "../providers/types.js";
import { PRICING_MARGIN_PCT, roundListPrice } from "./constants.js";

export interface ModelPriceEntry {
  id: string;
  provider: string;
  costPer1kTokens: number;
  listPricePer1kTokens: number;
  tier: number;
}

/** Single source of truth for per-model list prices (x402 quotes + Bazaar metadata). */
export function buildPricingCatalog(
  providers: ProviderAdapter[],
  marginPct = PRICING_MARGIN_PCT,
): ModelPriceEntry[] {
  const models = new Map<string, ModelPriceEntry>();

  for (const provider of providers) {
    for (const alias of provider.aliases) {
      if (isOpenAiProprietaryModelId(alias)) continue;
      const existing = models.get(alias);
      if (!existing || provider.costPer1kTokens < existing.costPer1kTokens) {
        models.set(alias, {
          id: alias,
          provider: provider.name,
          costPer1kTokens: provider.costPer1kTokens,
          listPricePer1kTokens: roundListPrice(
            provider.costPer1kTokens * (1 + marginPct),
          ),
          tier: provider.tier,
        });
      }
    }
  }

  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getModelPrice(
  catalog: ModelPriceEntry[],
  modelId: string,
): ModelPriceEntry | undefined {
  return catalog.find((entry) => entry.id === modelId);
}
