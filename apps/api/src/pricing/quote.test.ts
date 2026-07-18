import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_CALL_USDC } from "./constants.js";
import {
  estimatePromptTokens,
  quoteCallPrice,
  resolveMaxCompletionTokens,
} from "./quote.js";

describe("estimatePromptTokens", () => {
  it("uses a rough 4-characters-per-token heuristic", () => {
    assert.equal(
      estimatePromptTokens([{ content: "abcd" }, { content: "efgh" }]),
      2,
    );
    assert.equal(estimatePromptTokens([{ content: "" }]), 1);
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

describe("quoteCallPrice", () => {
  it("quotes based on prompt + max completion tokens", () => {
    const quote = quoteCallPrice({
      listPricePer1k: 0.000125,
      promptTokens: 8000,
      maxCompletionTokens: 4096,
    });
    assert.equal(quote.estimatedTokens, 12096);
    assert.equal(quote.quotedAmount, 0.001512);
  });

  it("enforces the minimum call floor", () => {
    const quote = quoteCallPrice({
      listPricePer1k: 0.000125,
      promptTokens: 1,
      maxCompletionTokens: 1,
    });
    assert.equal(quote.quotedAmount, MIN_CALL_USDC);
  });
});
