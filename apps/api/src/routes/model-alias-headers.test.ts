import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import Fastify from "fastify";
import type { ApiKeyRecord } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import type { InferenceRouter } from "../routing/router.js";
import type { UsageStore } from "../usage/store.js";
import { registerChatRoutes } from "./chat.js";

const apiKey: ApiKeyRecord = {
  id: "key-1",
  keyHash: "hash",
  environment: "development",
  createdAt: "2026-10-13T00:00:00.000Z",
};

function creditStore(): CreditStore {
  return {
    async getBalance() {
      return 10;
    },
    async getBalances() {
      return new Map();
    },
    async hasMinimumBalance() {
      return true;
    },
    async deduct() {
      return true;
    },
    async credit() {
      return 10;
    },
    async reserve() {
      return true;
    },
    async settleReservation() {
      return true;
    },
    async releaseReservation() {},
  };
}

function usageStore(): UsageStore {
  return {
    async recordUsage() {
      return "usage-1";
    },
    async getUsage() {
      return null;
    },
    async getUsageForKeys() {
      return new Map();
    },
    async getUsageHistory() {
      return [];
    },
    async getUsageLogs() {
      return { data: [], hasMore: false, nextCursor: null };
    },
  };
}

function router(): InferenceRouter {
  return {
    async route(request: ChatCompletionRequest) {
      const stream = request.stream
        ? (async function* () {
            yield `data: ${JSON.stringify({
              id: "chatcmpl_test",
              model: "Qwen/Qwen3.6-35B-A3B",
              choices: [{ index: 0, delta: { content: "ok" } }],
            })}\n\n`;
            yield "data: [DONE]\n\n";
          })()
        : undefined;
      return {
        response: {
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model: "Qwen/Qwen3.6-35B-A3B",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" },
            },
          ],
        },
        latencyMs: 1,
        provider: "akash",
        fallbackUsed: false,
        costPer1kTokens: 0.001,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        stream,
      };
    },
    } as unknown as InferenceRouter;
}

async function app() {
  const server = Fastify();
  server.addHook("onRequest", async (request) => {
    if (request.headers.authorization === "Bearer test") {
      request.apiKey = apiKey;
    }
  });
  await registerChatRoutes(server, {
    router: router(),
    usageStore: usageStore(),
    creditStore: creditStore(),
    paymentStore: null,
    reconciler: null,
    chatRateLimit: () => ({ allowed: true }),
    minChatCost: 0.001,
    x402Enabled: false,
  });
  return server;
}

describe("chat model alias response headers", () => {
  it("reports the caller model and the resolved catalog model on a non-streaming response", async () => {
    const server = await app();
    const aliased = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "qwen-3.5-35b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    assert.equal(aliased.statusCode, 200);
    assert.equal(aliased.headers["x-lmx-model-requested"], "qwen-3.5-35b");
    assert.equal(aliased.headers["x-lmx-model-resolved"], "qwen-3.6-35b");
    assert.equal(aliased.json().model, "Qwen/Qwen3.6-35B-A3B");

    const upstreamAlias = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "Qwen/Qwen3.5-35B-A3B",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    assert.equal(upstreamAlias.headers["x-lmx-model-requested"], "Qwen/Qwen3.5-35B-A3B");
    assert.equal(upstreamAlias.headers["x-lmx-model-resolved"], "qwen-3.6-35b");

    const unchanged = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "llama-3-70b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    assert.equal(unchanged.headers["x-lmx-model-requested"], "llama-3-70b");
    assert.equal(unchanged.headers["x-lmx-model-resolved"], "llama-3-70b");
    await server.close();
  });

  it("reports the same headers on a streaming response", async () => {
    const server = await app();
    const aliased = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "Qwen3.5-35B-A3B",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    });
    assert.equal(aliased.statusCode, 200, aliased.body);
    assert.equal(aliased.headers["x-lmx-model-requested"], "Qwen3.5-35B-A3B");
    assert.equal(aliased.headers["x-lmx-model-resolved"], "qwen-3.6-35b");
    assert.match(aliased.body, /Qwen\/Qwen3\.6-35B-A3B/);

    const unchanged = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "llama-3-70b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    });
    assert.equal(unchanged.statusCode, 200, unchanged.body);
    assert.equal(unchanged.headers["x-lmx-model-requested"], "llama-3-70b");
    assert.equal(unchanged.headers["x-lmx-model-resolved"], "llama-3-70b");
    await server.close();
  });
});
