import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import Fastify from "fastify";
import type { ApiKeyRecord } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import type { InferenceRouter } from "../routing/router.js";
import type { LmxUsage } from "../usage/normalize.js";
import type { UsageStore } from "../usage/store.js";
import { registerChatRoutes } from "./chat.js";

const apiKey: ApiKeyRecord = {
  id: "key-1",
  keyHash: "hash",
  environment: "development",
  createdAt: "2026-10-25T00:00:00.000Z",
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

/**
 * Router stub. `bodyUsage` is what the provider returned on a non-streaming
 * call (and the initial value on a stream). `streamUsage`, when set, arrives in
 * a final SSE chunk the way OpenAI-compatible providers send it with
 * stream_options.include_usage.
 */
function router(bodyUsage: unknown, streamUsage?: unknown): InferenceRouter {
  return {
    async route(request: ChatCompletionRequest) {
      const stream = request.stream
        ? (async function* () {
            yield `data: ${JSON.stringify({
              id: "chatcmpl_test",
              model: "m",
              choices: [{ index: 0, delta: { content: "ok" } }],
              usage: null,
            })}\n\n`;
            if (streamUsage !== undefined) {
              yield `data: ${JSON.stringify({ id: "chatcmpl_test", choices: [], usage: streamUsage })}\n\n`;
            }
            yield "data: [DONE]\n\n";
          })()
        : undefined;
      return {
        response: {
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } },
          ],
        },
        latencyMs: 1,
        provider: "akash",
        fallbackUsed: false,
        costPer1kTokens: 0.001,
        usage: request.stream ? null : bodyUsage,
        stream,
      };
    },
  } as unknown as InferenceRouter;
}

async function app(r: InferenceRouter) {
  const server = Fastify();
  server.addHook("onRequest", async (request) => {
    if (request.headers.authorization === "Bearer test") request.apiKey = apiKey;
  });
  await registerChatRoutes(server, {
    router: r,
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

function chat(server: Awaited<ReturnType<typeof app>>, stream = false) {
  return server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { authorization: "Bearer test" },
    payload: {
      model: "qwen-3.6-35b",
      messages: [{ role: "user", content: "hi" }],
      ...(stream ? { stream: true } : {}),
    },
  });
}

function meta(body: string): Record<string, unknown> {
  const frame = body.split("\n\n").find((part) => part.startsWith("event: lmx.meta"));
  assert.ok(frame, "lmx.meta event present");
  return JSON.parse(frame.split("\n")[1]!.slice("data: ".length)) as Record<string, unknown>;
}

async function nonStreamUsage(raw: unknown): Promise<LmxUsage> {
  const res = await chat(await app(router(raw)));
  assert.equal(res.statusCode, 200);
  const header = res.headers["x-lmx-usage"];
  assert.equal(typeof header, "string", "x-lmx-usage header present");
  return JSON.parse(header as string) as LmxUsage;
}

async function streamUsage(raw: unknown): Promise<LmxUsage> {
  const res = await chat(await app(router(null, raw)), true);
  assert.equal(res.statusCode, 200);
  return meta(res.body).lmx_usage as LmxUsage;
}

const FULL = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };

describe("chat usage normalization (lmx.usage/1)", () => {
  it("reports the same shape on streaming and non-streaming responses", async () => {
    const a = await nonStreamUsage(FULL);
    const b = await streamUsage(FULL);
    assert.deepEqual(a, b);
    assert.equal(a.schema, "lmx.usage/1");
    assert.equal(a.total_tokens, 30);
    assert.equal(a.source, "provider");
  });

  it("marks missing usage unavailable on both paths instead of reporting 0", async () => {
    for (const usage of [await nonStreamUsage(null), await streamUsage(undefined)]) {
      assert.equal(usage.source, "unavailable");
      assert.equal(usage.total_tokens, null);
      assert.equal(usage.cost_basis, "unavailable");
      assert.ok(usage.unavailable.includes("prompt_tokens"));
    }
  });

  it("marks partial usage on both paths", async () => {
    const partial = { completion_tokens: 4 };
    const a = await nonStreamUsage(partial);
    const b = await streamUsage(partial);
    assert.deepEqual(a, b);
    assert.equal(a.source, "provider_partial");
    assert.equal(a.prompt_tokens, null);
  });

  it("keeps the legacy lmx.meta.usage field and x-lmx-cost unchanged", async () => {
    const res = await chat(await app(router(null, FULL)), true);
    assert.deepEqual(meta(res.body).usage, FULL);
    assert.equal(meta(res.body).cost, 0.00003);
    const plain = await chat(await app(router(FULL)));
    assert.equal(plain.headers["x-lmx-cost"], "0.00003");
  });
});
