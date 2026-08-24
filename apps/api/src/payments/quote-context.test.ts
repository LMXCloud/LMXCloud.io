import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryHealthStore } from "../health/store.js";
import { ModelNotSupportedError, type ProviderAdapter } from "../providers/types.js";
import {
  assertSuccessfulChatQuote,
  buildChatQuote,
  parseChatBody,
} from "./quote-context.js";
import { InvalidChatRequestError, ModelUnavailableError } from "./quote-errors.js";

function mockProvider(
  name: string,
  aliases: string[],
  healthy: boolean,
  healthStore: InMemoryHealthStore,
): ProviderAdapter {
  healthStore.set(name, {
    healthy,
    latencyMs: 1,
    lastCheck: Date.now(),
  });
  return {
    name,
    tier: 1,
    costPer1kTokens: 0.0001,
    isDepin: true,
    aliases,
    supportsModel: (model) => aliases.includes(model),
    chatCompletion: async () => {
      throw new Error("not implemented");
    },
    healthCheck: async () => ({ healthy, latencyMs: 1 }),
  };
}

const quoteOptions = {
  marginPct: 0.25,
  minCallUsdc: 0.001,
  defaultMaxCompletionTokens: 1024,
};

describe("parseChatBody vision content", () => {
  it("accepts OpenAI-style image_url content parts on vision models", () => {
    const parsed = parseChatBody({
      model: "llama-3.2-90b-vision",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/cat.png" },
            },
          ],
        },
      ],
    });

    assert.ok(!(parsed instanceof InvalidChatRequestError));
    assert.equal(parsed.model, "llama-3.2-90b-vision");
    assert.ok(Array.isArray(parsed.messages[0]!.content));
  });

  it("rejects image content on text-only models with a typed error", () => {
    const parsed = parseChatBody({
      model: "llama-3-70b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aaa" },
            },
          ],
        },
      ],
    });

    assert.ok(parsed instanceof InvalidChatRequestError);
    assert.equal(parsed.code, "vision_not_supported");
    assert.match(parsed.message, /does not support image input/);
    assert.match(parsed.message, /llama-3\.2-90b-vision/);
  });

  it("still accepts plain string content", () => {
    const parsed = parseChatBody({
      model: "llama-3-70b",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(!(parsed instanceof InvalidChatRequestError));
    assert.equal(parsed.messages[0]!.content, "hello");
  });

  it("returns InvalidChatRequestError when the body is missing", () => {
    const parsed = parseChatBody(undefined);
    assert.ok(parsed instanceof InvalidChatRequestError);
    assert.equal(parsed.code, "invalid_body");
    assert.equal(parsed.name, "InvalidChatRequestError");
  });
});

describe("buildChatQuote model availability", () => {
  it("throws ModelNotSupportedError for OpenAI proprietary IDs with no providers", () => {
    const healthStore = new InMemoryHealthStore();
    const providers = [
      mockProvider("akash", ["llama-3-70b"], true, healthStore),
    ];
    const parsed = parseChatBody({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(!(parsed instanceof InvalidChatRequestError));

    const quote = buildChatQuote(parsed, providers, healthStore, quoteOptions);
    assert.ok(quote instanceof ModelNotSupportedError);
    assert.equal(quote.name, "ModelNotSupportedError");
    assert.equal(quote.code, "model_not_supported");

    assert.throws(
      () => assertSuccessfulChatQuote(quote),
      (err: unknown) => {
        assert.ok(err instanceof ModelNotSupportedError);
        assert.equal(err.model, "gpt-4o-mini");
        return true;
      },
    );
  });

  it("returns ModelUnavailableError when the model exists but providers are unhealthy", () => {
    const healthStore = new InMemoryHealthStore();
    const providers = [
      mockProvider("ionet", ["llama-4-maverick"], false, healthStore),
    ];
    const parsed = parseChatBody({
      model: "llama-4-maverick",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(!(parsed instanceof InvalidChatRequestError));

    const quote = buildChatQuote(parsed, providers, healthStore, quoteOptions);
    assert.ok(quote instanceof ModelUnavailableError);
    assert.equal(quote.name, "ModelUnavailableError");
    assert.equal(quote.code, "model_unavailable");
    assert.equal(quote.model, "llama-4-maverick");

    assert.throws(
      () => assertSuccessfulChatQuote(quote),
      (err: unknown) => err instanceof ModelUnavailableError,
    );
  });

  it("does not wrap quote failures in a generic Error", () => {
    const missingBody = parseChatBody(null);
    assert.ok(missingBody instanceof InvalidChatRequestError);
    try {
      assertSuccessfulChatQuote(missingBody);
      assert.fail("expected throw");
    } catch (err) {
      assert.equal(err instanceof Error && err.constructor === Error, false);
      assert.ok(err instanceof InvalidChatRequestError);
    }
  });
});
