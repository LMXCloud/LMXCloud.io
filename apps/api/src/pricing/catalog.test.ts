import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPricingCatalog, getModelPrice } from "./catalog.js";
import type { ProviderAdapter } from "../providers/types.js";

function mockProvider(name: string, aliases: string[]): ProviderAdapter {
  return {
    name,
    tier: 1,
    costPer1kTokens: 0.0002,
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
  it("publishes one per-model price from the highest provider cost plus markup", () => {
    const catalog = buildPricingCatalog([
      mockProvider("ionet", ["llama-3-70b", "qwen-3.6-35b"]),
      mockProvider("akash", ["llama-3-70b"]),
    ]);

    const llama = getModelPrice(catalog, "llama-3-70b");
    assert.ok(llama);
    // io.net is the higher cost (0.4786 / 1.0946 / 0.2393 per 1M); x 1.25, rounded up to 4 dp.
    assert.deepEqual(llama.rates, { input: 0.5983, output: 1.3683, cachedInput: 0.2992 });
    assert.deepEqual(llama.availableOn.sort(), ["akash", "ionet"]);

    const qwen = getModelPrice(catalog, "qwen-3.6-35b");
    assert.ok(qwen);
    assert.deepEqual(qwen.rates, { input: 0.1625, output: 1.235, cachedInput: 0.0813 });
  });

  it("does not change the price when only the cheaper provider is healthy", () => {
    const catalog = buildPricingCatalog([mockProvider("akash", ["llama-3-70b"])]);
    assert.equal(getModelPrice(catalog, "llama-3-70b")?.rates.input, 0.5983);
  });

  it("finds a price by upstream id or alias", () => {
    const catalog = buildPricingCatalog([mockProvider("ionet", ["llama-3-70b"])]);
    assert.ok(getModelPrice(catalog, "meta-llama/Llama-3.3-70B-Instruct"));
  });

  it("leaves out models no passed provider can serve at a verified rate", () => {
    const catalog = buildPricingCatalog([
      mockProvider("nosana", ["llama-3-70b"]),
      mockProvider("ionet", ["llama-3.2-90b-vision"]),
    ]);
    assert.equal(catalog.length, 0);
  });

  it("never lists OpenAI proprietary IDs even if a provider advertises them", () => {
    const catalog = buildPricingCatalog([
      mockProvider("ionet", ["llama-3-70b", "gpt-4o-mini", "gpt-4o"]),
    ]);

    assert.ok(catalog.some((entry) => entry.id === "llama-3-70b"));
    assert.equal(
      catalog.some((entry) => entry.id === "gpt-4o-mini" || entry.id === "gpt-4o"),
      false,
    );
  });
});
