import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRICING_MARGIN_PCT } from "./constants.js";
import {
  buildPriceBook,
  ceilingCost,
  createPriceBook,
  isPricedOnProvider,
  priceRequest,
  type ModelPrice,
} from "./rate-card.js";

const PRICE: ModelPrice = {
  model: "test-model",
  rates: { input: 1, output: 2, cachedInput: 0.5 },
  providerCosts: {},
  pricingVersion: "test",
};

const counts = (
  prompt: number | null,
  completion: number | null,
  total: number | null,
  cached: number | null = null,
) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: total,
  cached_prompt_tokens: cached,
});

describe("priceRequest", () => {
  it("bills uncached input, cached input and output at their own rates", () => {
    const cost = priceRequest(PRICE, counts(1000, 100, 1100, 400));
    // 600 x $1/M + 400 x $0.50/M + 100 x $2/M = $0.001
    assert.equal(cost.amount, 0.001);
    assert.deepEqual(cost.billed, { input: 600, cached_input: 400, output: 100 });
    assert.equal(cost.basis, "prompt_completion");
    assert.equal(cost.pricingVersion, "test");
  });

  it("treats a missing cached count as no cache hits, never as negative input", () => {
    assert.deepEqual(priceRequest(PRICE, counts(10, 5, 15)).billed, {
      input: 10,
      cached_input: 0,
      output: 5,
    });
    // A cached count larger than the prompt is capped at the prompt.
    assert.deepEqual(priceRequest(PRICE, counts(10, 5, 15, 50)).billed, {
      input: 0,
      cached_input: 10,
      output: 5,
    });
  });

  it("bills a total without a split at the output rate and says so", () => {
    const cost = priceRequest(PRICE, counts(null, null, 100));
    assert.equal(cost.basis, "total_tokens_at_output_rate");
    assert.equal(cost.amount, 0.0002);
  });

  it("charges nothing and says unavailable when no counts were reported", () => {
    const cost = priceRequest(PRICE, counts(null, null, null));
    assert.equal(cost.basis, "unavailable");
    assert.equal(cost.amount, 0);
  });

  it("rounds half-up to 8 decimal places", () => {
    // 3 x $0.0000025/M = 7.5e-12, rounds to 0; 1 x $0.005/M = 5e-9 rounds half-up to 1e-8
    const tiny: ModelPrice = { ...PRICE, rates: { input: 0.005, output: 0, cachedInput: 0 } };
    assert.equal(priceRequest(tiny, counts(1, 0, 1)).amount, 0.00000001);
  });

  it("matches the published rates for Jason's two models", () => {
    const book = createPriceBook();
    const llama = book.priceFor("llama-3.3-70b");
    const qwen = book.priceFor("qwen-3.6-35b");
    assert.ok(llama && qwen);
    // 17 prompt + 2 completion tokens (the Nov 13 production check)
    assert.equal(priceRequest(llama, counts(17, 2, 19)).amount, 0.00001291);
    assert.equal(priceRequest(qwen, counts(19, 2, 21)).amount, 0.00000556);
  });
});

describe("ceilingCost", () => {
  it("prices prompt estimate at input and max completion at output", () => {
    assert.equal(ceilingCost(PRICE, 100, 50), 0.0002);
  });
});

describe("published price book", () => {
  it("never prices a model below any provider's cost plus markup", () => {
    const book = buildPriceBook();
    assert.ok(book.length > 20);
    for (const price of book) {
      for (const cost of Object.values(price.providerCosts)) {
        for (const key of ["input", "output", "cachedInput"] as const) {
          assert.ok(
            price.rates[key] >= cost[key] * (1 + PRICING_MARGIN_PCT) - 1e-12,
            `${price.model} ${key} below cost + markup`,
          );
        }
      }
    }
  });

  it("prices the models that were excluded under the flat rate", () => {
    const book = createPriceBook();
    for (const model of ["kimi-k2.6", "glm-5.1", "deepseek-v4-pro"]) {
      const price = book.priceFor(model);
      assert.ok(price, `${model} should be priced`);
      assert.ok(price.rates.output > 0.2, `${model} output must not be the old flat $0.20/M`);
    }
  });

  it("resolves aliases to the same price", () => {
    const book = createPriceBook();
    assert.deepEqual(book.priceFor("qwen-3.5-35b")?.rates, book.priceFor("qwen-3.6-35b")?.rates);
  });

  it("does not price a model no provider lists", () => {
    assert.equal(createPriceBook().priceFor("llama-3.2-90b-vision"), undefined);
  });
});

describe("isPricedOnProvider", () => {
  it("allows only provider/model pairs with a verified rate", () => {
    assert.equal(isPricedOnProvider("ionet", "llama-3.3-70b"), true);
    assert.equal(isPricedOnProvider("akash", "llama-3.3-70b"), true);
    assert.equal(isPricedOnProvider("akash", "deepseek-v4-flash"), false);
    assert.equal(isPricedOnProvider("nosana", "llama-3.3-70b"), false);
    assert.equal(isPricedOnProvider("aethir", "qwen-3.6-35b"), false);
  });
});
