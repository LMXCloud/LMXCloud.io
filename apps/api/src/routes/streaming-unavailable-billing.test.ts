import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { paymentMiddlewareFromHTTPServer } from "@x402/fastify";
import type { x402HTTPResourceServer } from "@x402/fastify";
import Fastify from "fastify";
import type { ApiKeyRecord } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import { InMemoryHealthStore } from "../health/store.js";
import type { ProviderAdapter } from "../providers/types.js";
import {
  InferenceRouter,
  StreamingTemporarilyUnavailableError,
} from "../routing/router.js";
import type { UsageStore } from "../usage/store.js";
import { registerChatRoutes } from "./chat.js";

const apiKey: ApiKeyRecord = {
  id: "key-1",
  keyHash: "hash",
  environment: "development",
  createdAt: "2026-10-08T00:00:00.000Z",
};

function chargingCreditStore(calls: string[]): CreditStore {
  return {
    async getBalance() {
      calls.push("getBalance");
      return 10;
    },
    async getBalances() {
      return new Map();
    },
    async hasMinimumBalance() {
      calls.push("hasMinimumBalance");
      return true;
    },
    async deduct() {
      calls.push("deduct");
      return true;
    },
    async credit() {
      calls.push("credit");
      return 10;
    },
    async reserve() {
      calls.push("reserve");
      return true;
    },
    async settleReservation() {
      calls.push("settleReservation");
      return true;
    },
    async releaseReservation() {
      calls.push("releaseReservation");
    },
  };
}

function usageStore(calls: string[]): UsageStore {
  return {
    async recordUsage() {
      calls.push("recordUsage");
      return null;
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

function akashOnlyRouter(): InferenceRouter {
  const health = new InMemoryHealthStore();
  health.set("akash", { healthy: true, latencyMs: 1, lastCheck: 1 });
  const akash: ProviderAdapter = {
    name: "akash",
    tier: 1,
    costPer1kTokens: 0.001,
    isDepin: true,
    aliases: ["qwen-3.5-35b"],
    supportsModel: (model) => model === "qwen-3.5-35b",
    async chatCompletion() {
      throw new Error("akash should not be called");
    },
    async healthCheck() {
      return { healthy: true, latencyMs: 1 };
    },
  };
  return new InferenceRouter([akash], health);
}

describe("streaming_temporarily_unavailable billing", () => {
  it("does not reserve or deduct API-key credits when routing rejects the stream", async () => {
    const creditCalls: string[] = [];
    const usageCalls: string[] = [];
    const app = Fastify();
    app.addHook("onRequest", async (request) => {
      if (request.headers.authorization === "Bearer test") {
        request.apiKey = apiKey;
      }
    });
    await registerChatRoutes(app, {
      router: akashOnlyRouter(),
      usageStore: usageStore(usageCalls),
      creditStore: chargingCreditStore(creditCalls),
      paymentStore: null,
      reconciler: null,
      chatRateLimit: () => ({ allowed: true }),
      minChatCost: 0.001,
      x402Enabled: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test" },
      payload: {
        model: "qwen-3.5-35b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    });
    await app.close();

    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, "streaming_temporarily_unavailable");
    assert.deepEqual(creditCalls, ["hasMinimumBalance"]);
    assert.deepEqual(usageCalls, []);
  });

  it("does not settle an x402 payment when chat returns 503", async () => {
    const settled: string[] = [];
    const canceled: Array<{ reason?: string; responseStatus?: number }> = [];
    const app = Fastify();
    const httpServer = {
      routes: {},
      requiresPayment(context: { paymentHeader?: string }) {
        return Boolean(context.paymentHeader);
      },
      async processHTTPRequest() {
        return {
          type: "payment-verified" as const,
          cancellationDispatcher: {
            async cancel(info: { reason?: string; responseStatus?: number }) {
              canceled.push(info);
            },
          },
          paymentPayload: {
            x402Version: 2,
            payload: { permit2Authorization: { from: "0xabc" } },
          } as unknown as PaymentPayload,
          paymentRequirements: {
            scheme: "upto",
            network: "eip155:84532",
          } as unknown as PaymentRequirements,
          declaredExtensions: [],
        };
      },
      async processSettlement() {
        settled.push("processSettlement");
        return { success: true, headers: {} };
      },
    };
    paymentMiddlewareFromHTTPServer(
      app,
      httpServer as unknown as x402HTTPResourceServer,
      undefined,
      undefined,
      false,
    );
    await registerChatRoutes(app, {
      router: {
        async route() {
          throw new StreamingTemporarilyUnavailableError("qwen-3.5-35b");
        },
      } as unknown as InferenceRouter,
      usageStore: usageStore([]),
      creditStore: chargingCreditStore([]),
      paymentStore: null,
      reconciler: null,
      chatRateLimit: () => ({ allowed: true }),
      x402RateLimit: () => ({ allowed: true }),
      minChatCost: 0.001,
      x402Enabled: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "payment-signature": "test-signature" },
      payload: {
        model: "qwen-3.5-35b",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    await app.close();

    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json().error.code, "streaming_temporarily_unavailable");
    assert.deepEqual(settled, []);
    assert.equal(canceled.length, 1);
    assert.equal(canceled[0]?.reason, "handler_failed");
    assert.equal(canceled[0]?.responseStatus, 503);
  });
});
