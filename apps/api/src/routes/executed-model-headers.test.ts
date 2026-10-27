import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import Fastify from "fastify";
import type { ApiKeyRecord } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import { expectedProviderModelId } from "../providers/model-maps.js";
import {
  describeExecutedModel,
  executedModelHeaders,
  type InferenceRouter,
  type ModelIdSource,
} from "../routing/router.js";
import type { UsageStore } from "../usage/store.js";
import { registerChatRoutes } from "./chat.js";

const QWEN36_AKASH = expectedProviderModelId("akash", "qwen-3.6-35b")!;

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

type Executed = { id: string; source: ModelIdSource } | undefined;

/**
 * Router stub. `executed` is what the provider reported for non-streaming calls.
 * For streaming, the executed model becomes visible only once the first chunk
 * has been produced, the same way the real stream parser behaves.
 */
function router(executed: Executed, streamExecuted: Executed = executed): InferenceRouter {
  return {
    async route(request: ChatCompletionRequest) {
      let seen: Executed;
      const stream = request.stream
        ? (async function* () {
            seen = streamExecuted;
            yield `data: ${JSON.stringify({
              id: "chatcmpl_test",
              model: streamExecuted?.id ?? "",
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
          model: executed?.id ?? "",
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
        ...(request.stream
          ? { streamExecutedModel: () => seen }
          : executed
            ? { executedModel: executed }
            : {}),
      };
    },
  } as unknown as InferenceRouter;
}

async function app(r: InferenceRouter) {
  const server = Fastify();
  server.addHook("onRequest", async (request) => {
    if (request.headers.authorization === "Bearer test") {
      request.apiKey = apiKey;
    }
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

function metaEvent(body: string): Record<string, unknown> {
  const frame = body.split("\n\n").find((part) => part.startsWith("event: lmx.meta"));
  assert.ok(frame, "lmx.meta event present");
  return JSON.parse(frame.split("\n")[1]!.slice("data: ".length)) as Record<string, unknown>;
}

describe("describeExecutedModel", () => {
  it("reports a provider header match as no substitution", () => {
    assert.deepEqual(
      describeExecutedModel("akash", "qwen-3.6-35b", { id: QWEN36_AKASH, source: "header" }),
      {
        executed: QWEN36_AKASH,
        source: "provider-header",
        expected: QWEN36_AKASH,
        substitution: "false",
      },
    );
  });

  it("reports a different body model as a substitution", () => {
    const report = describeExecutedModel("akash", "qwen-3.6-35b", {
      id: "other-model",
      source: "body",
    });
    assert.equal(report.source, "response-body");
    assert.equal(report.substitution, "true");
  });

  it("says unknown when the provider reported nothing", () => {
    const report = describeExecutedModel("akash", "qwen-3.6-35b", undefined);
    assert.equal(report.executed, undefined);
    assert.equal(report.source, "unknown");
    assert.equal(report.substitution, "unknown");
    assert.equal(report.expected, QWEN36_AKASH);
  });

  it("says unknown substitution when the router has no expected id for the provider", () => {
    const report = describeExecutedModel("not-a-provider", "qwen-3.6-35b", {
      id: "x",
      source: "header",
    });
    assert.equal(report.expected, undefined);
    assert.equal(report.substitution, "unknown");
    assert.equal("x-lmx-model-expected" in executedModelHeaders(report), false);
  });
});

describe("chat executed-model response headers", () => {
  it("returns executed model, source and substitution on a non-streaming response", async () => {
    const server = await app(router({ id: QWEN36_AKASH, source: "header" }));
    const res = await chat(server);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-lmx-model-executed"], QWEN36_AKASH);
    assert.equal(res.headers["x-lmx-model-executed-source"], "provider-header");
    assert.equal(res.headers["x-lmx-model-expected"], QWEN36_AKASH);
    assert.equal(res.headers["x-lmx-substitution"], "false");
  });

  it("flags a substitution on a non-streaming response", async () => {
    const server = await app(router({ id: "other-model", source: "header" }));
    const res = await chat(server);
    assert.equal(res.headers["x-lmx-model-executed"], "other-model");
    assert.equal(res.headers["x-lmx-substitution"], "true");
  });

  it("sends streaming headers after the first chunk, using the model read from the stream", async () => {
    const server = await app(router(undefined, { id: QWEN36_AKASH, source: "body" }));
    const res = await chat(server, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-lmx-model-executed"], QWEN36_AKASH);
    assert.equal(res.headers["x-lmx-model-executed-source"], "response-body");
    assert.equal(res.headers["x-lmx-substitution"], "false");

    const meta = metaEvent(res.body);
    assert.equal(meta.model_requested, "qwen-3.6-35b");
    assert.equal(meta.model_resolved, "qwen-3.6-35b");
    assert.equal(meta.model_executed, QWEN36_AKASH);
    assert.equal(meta.model_executed_source, "response-body");
    assert.equal(meta.substitution, "false");
  });

  it("states unknown on a stream when no executed model was seen", async () => {
    const server = await app(router(undefined, undefined));
    const res = await chat(server, true);
    assert.equal(res.headers["x-lmx-model-executed"], undefined);
    assert.equal(res.headers["x-lmx-model-executed-source"], "unknown");
    assert.equal(res.headers["x-lmx-substitution"], "unknown");
    assert.equal(metaEvent(res.body).model_executed, null);
  });
});
