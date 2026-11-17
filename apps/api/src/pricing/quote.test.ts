import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_CALL_USDC } from "./constants.js";
import {
  estimateMaxStreamCost,
  estimatePromptTokens,
  quoteCallPrice,
  resolveMaxCompletionTokens,
} from "./quote.js";
import type { ModelPrice } from "./rate-card.js";

describe("estimatePromptTokens", () => {
  it("uses a rough 4-characters-per-token heuristic", () => {
    assert.equal(
      estimatePromptTokens([{ content: "abcd" }, { content: "efgh" }]),
      2,
    );
    assert.equal(estimatePromptTokens([{ content: "" }]), 1);
    assert.equal(estimatePromptTokens([{ content: null }]), 1);
  });

  it("adds a per-image token floor for multimodal content", () => {
    assert.equal(
      estimatePromptTokens([
        {
          content: [
            { type: "text", text: "abcd" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/a.png" },
            },
          ],
        },
      ]),
      1 + 765,
    );
  });
});

describe("resolveMaxCompletionTokens", () => {
  it("prefers max_completion_tokens, then max_tokens, then default", () => {
    assert.equal(resolveMaxCompletionTokens(undefined, 512), 512);
    assert.equal(resolveMaxCompletionTokens(256, undefined), 256);
    assert.equal(resolveMaxCompletionTokens(undefined, undefined), 1024);
  });
});

const TEST_PRICE: ModelPrice = {
  model: "llama-3-70b",
  rates: { input: 1, output: 2, cachedInput: 0.5 },
  providerCosts: {},
  pricingVersion: "test",
};

describe("estimateMaxStreamCost", () => {
  it("quotes prompt + max completion tokens with an optional floor", () => {
    const cost = estimateMaxStreamCost(
      {
        model: "llama-3-70b",
        messages: [{ role: "user", content: "abcd" }],
        max_tokens: 256,
      },
      TEST_PRICE,
      0.00001,
    );
    // 1 prompt token x $1/M + 256 completion tokens x $2/M
    assert.equal(cost, 0.000513);
  });
});

describe("quoteCallPrice", () => {
  it("quotes based on prompt + max completion tokens", () => {
    const quote = quoteCallPrice({
      price: TEST_PRICE,
      promptTokens: 8000,
      maxCompletionTokens: 4096,
    });
    assert.equal(quote.estimatedTokens, 12096);
    // 8000 x $1/M + 4096 x $2/M: input and output priced separately
    assert.equal(quote.quotedAmount, 0.016192);
  });

  it("enforces the minimum call floor", () => {
    const quote = quoteCallPrice({
      price: TEST_PRICE,
      promptTokens: 1,
      maxCompletionTokens: 1,
    });
    assert.equal(quote.quotedAmount, MIN_CALL_USDC);
  });
});
