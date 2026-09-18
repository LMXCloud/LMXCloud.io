import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPricingCatalog } from "./catalog.js";
import type { ProviderAdapter } from "../providers/types.js";

function mockProvider(
  name: string,
  tier: number,
  costPer1k: number,
  aliases: string[],
): ProviderAdapter {
  return {
    name,
    tier,
    costPer1kTokens: costPer1k,
    isDepin: true,
    aliases,
    supportsModel: (model) => aliases.includes(model),
    chatCompletion: async () => {
      throw new Error("not implemented");
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
  };
}

describe("buildPricingCatalog", () => {
  it("picks the cheapest provider per alias and applies margin", () => {
    const catalog = buildPricingCatalog([
      mockProvider("ionet", 1, 0.0002, ["llama-3-70b", "qwen-3.6-35b"]),
      mockProvider("akash", 2, 0.0001, ["llama-3-70b"]),
    ]);

    const llama = catalog.find((entry) => entry.id === "llama-3-70b");
    assert.ok(llama);
    assert.equal(llama.provider, "akash");
    assert.equal(llama.costPer1kTokens, 0.0001);
    assert.equal(llama.listPricePer1kTokens, 0.000125);

    const qwen = catalog.find((entry) => entry.id === "qwen-3.6-35b");
    assert.ok(qwen);
    assert.equal(qwen.provider, "ionet");
  });

  it("never lists OpenAI proprietary IDs even if a provider advertises them", () => {
    const catalog = buildPricingCatalog([
      mockProvider("ionet", 1, 0.0002, ["llama-3-70b", "gpt-4o-mini", "gpt-4o"]),
    ]);

    assert.ok(catalog.some((entry) => entry.id === "llama-3-70b"));
    assert.equal(
      catalog.some((entry) => entry.id === "gpt-4o-mini" || entry.id === "gpt-4o"),
      false,
    );
  });
});
