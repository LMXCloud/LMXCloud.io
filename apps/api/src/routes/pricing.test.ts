import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { InMemoryHealthStore } from "../health/store.js";
import { PRICING_EFFECTIVE_FROM, PRICING_VERSION } from "../pricing/rate-card.js";
import type { ProviderAdapter } from "../providers/types.js";
import { registerPricingRoutes } from "./pricing.js";

function provider(name: string, aliases: string[]): ProviderAdapter {
  return {
    name,
    tier: 1,
    costPer1kTokens: 0.0002,
    isDepin: true,
    aliases,
    supportsModel: (model) => aliases.includes(model),
    chatCompletion: async () => {
      throw new Error("not used");
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
  };
}

async function app(healthy: Record<string, boolean>) {
  const health = new InMemoryHealthStore();
  for (const [name, ok] of Object.entries(healthy)) {
    health.set(name, { healthy: ok, latencyMs: 1, lastCheck: 1 });
  }
  const server = Fastify();
  await registerPricingRoutes(server, {
    providers: [provider("ionet", ["llama-3.3-70b", "qwen-3.6-35b"]), provider("akash", ["llama-3.3-70b"])],
    healthStore: health,
    chainId: 8453,
    marginPct: 0.25,
  });
  return server;
}

describe("GET /v1/pricing", () => {
  it("publishes dated per-model input, cached-input and output rates with the billing rules", async () => {
    const server = await app({ ionet: true, akash: false });
    const body = (await server.inject({ method: "GET", url: "/v1/pricing" })).json();
    assert.equal(body.pricing_version, PRICING_VERSION);
    assert.equal(body.effective_from, PRICING_EFFECTIVE_FROM);
    assert.equal(body.currency, "USD");
    assert.equal(body.billing.unit, "USD per 1M tokens");
    assert.equal(body.billing.markup_pct, 25);
    assert.match(body.billing.formula, /cached_prompt_tokens/);
    assert.ok(body.sources.ionet.url);

    const llama = body.models.find((m: { id: string }) => m.id === "llama-3.3-70b");
    assert.deepEqual(
      { input: llama.input_per_1m, cached: llama.cached_input_per_1m, output: llama.output_per_1m },
      { input: 0.5983, cached: 0.2992, output: 1.3683 },
    );
    // Akash is down: still listed as a cost behind the price, not as available.
    assert.deepEqual(llama.available_on, ["ionet"]);
    assert.deepEqual(Object.keys(llama.provider_costs).sort(), ["akash", "ionet"]);
  });

  it("keeps the price the same when providers go down, and marks the model unavailable", async () => {
    const server = await app({ ionet: false, akash: false });
    const body = (await server.inject({ method: "GET", url: "/v1/pricing" })).json();
    const llama = body.models.find((m: { id: string }) => m.id === "llama-3.3-70b");
    assert.equal(llama.input_per_1m, 0.5983);
    assert.equal(llama.available, false);
  });

  it("quotes one model at its input and output rates", async () => {
    const server = await app({ ionet: true });
    const body = (
      await server.inject({
        method: "GET",
        url: "/v1/pricing?model=qwen-3.6-35b&prompt_tokens=2000&max_tokens=1000",
      })
    ).json();
    // 2000 x $0.1625/M + 1000 x $1.235/M = $0.00156 (above the $0.001 minimum)
    assert.equal(body.quote.quoted_amount_usdc, "0.001560");
    assert.equal(body.model.output_per_1m, 1.235);
  });

  it("says when a model has no verified price", async () => {
    const server = await app({ ionet: true });
    const body = (await server.inject({ method: "GET", url: "/v1/pricing?model=llama-3.2-90b-vision" })).json();
    assert.equal(body.model, null);
    assert.match(body.error, /no verified price/);
  });
});
