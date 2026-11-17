/**
 * Jason gate 3 (per-model pricing) through the chat route, plus the two gate 1
 * route tests owed from Nov 5: a caller-visible streaming substitution, and
 * alias handling through the real router.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import Fastify from "fastify";
import type { ApiKeyRecord } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import { InMemoryHealthStore } from "../health/store.js";
import { createPriceBook, isPricedOnProvider, priceRequest } from "../pricing/rate-card.js";
import { expectedProviderModelId } from "../providers/model-maps.js";
import type { ProviderAdapter, ProviderResult } from "../providers/types.js";
import { InferenceRouter } from "../routing/router.js";
import type { LmxUsage } from "../usage/normalize.js";
import type { RecordUsageInput, UsageStore } from "../usage/store.js";
import { registerChatRoutes } from "./chat.js";

const apiKey: ApiKeyRecord = {
  id: "key-1",
  keyHash: "hash",
  environment: "development",
  createdAt: "2026-11-17T00:00:00.000Z",
};

const QWEN36_UPSTREAM = "Qwen/Qwen3.6-35B-A3B";

function creditStore(charges: number[]): CreditStore {
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
    async deduct(_id, amount) {
      charges.push(amount);
      return true;
    },
    async credit() {
      return 10;
    },
    async reserve() {
      return true;
    },
    async settleReservation(_id, _reserved, actual) {
      charges.push(actual);
      return true;
    },
    async releaseReservation() {},
  };
}

function usageStore(rows: RecordUsageInput[]): UsageStore {
  return {
    async recordUsage(input) {
      rows.push(input);
      return `usage-${rows.length}`;
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

/** Stub provider that answers with a fixed body model, usage and request id. */
function provider(
  name: string,
  opts: {
    bodyModel?: (requested: string) => string;
    usage?: Record<string, unknown>;
    requestId?: { id: string; header: string };
    calls?: string[];
  } = {},
): ProviderAdapter {
  const aliases = ["qwen-3.6-35b", "llama-3.3-70b", "llama-3.2-90b-vision", "deepseek-v4-flash"];
  return {
    name,
    tier: 1,
    costPer1kTokens: 0.0002,
    isDepin: true,
    aliases,
    supportsModel: (model) => aliases.includes(model),
    async chatCompletion(request: ChatCompletionRequest): Promise<ProviderResult> {
      opts.calls?.push(`${name}:${request.model}`);
      const model =
        opts.bodyModel?.(request.model) ?? expectedProviderModelId(name, request.model) ?? request.model;
      const usage = opts.usage ?? { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };
      const chunk = { id: "chatcmpl_test", model, choices: [{ index: 0, delta: { content: "ok" } }] };
      return {
        response: {
          id: "chatcmpl_test",
          object: "chat.completion",
          created: 0,
          model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
          usage: usage as never,
        },
        latencyMs: 1,
        usage: request.stream ? null : (usage as never),
        ...(request.stream
          ? {
              stream: (async function* () {
                yield `data: ${JSON.stringify(chunk)}\n\n`;
                yield `data: ${JSON.stringify({ id: "chatcmpl_test", model, choices: [], usage })}\n\n`;
                yield "data: [DONE]\n\n";
              })(),
              streamExecutedModel: () => ({ id: model, source: "body" as const }),
            }
          : {}),
        ...(opts.requestId ? { providerRequestId: opts.requestId } : {}),
      };
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
  };
}

function realRouter(providers: ProviderAdapter[]): InferenceRouter {
  const health = new InMemoryHealthStore();
  for (const p of providers) health.set(p.name, { healthy: true, latencyMs: 1, lastCheck: 1 });
  return new InferenceRouter(providers, health, undefined, undefined, isPricedOnProvider);
}

async function app(router: InferenceRouter) {
  const rows: RecordUsageInput[] = [];
  const charges: number[] = [];
  const server = Fastify();
  server.addHook("onRequest", async (request) => {
    if (request.headers.authorization === "Bearer test") request.apiKey = apiKey;
  });
  await registerChatRoutes(server, {
    router,
    usageStore: usageStore(rows),
    creditStore: creditStore(charges),
    paymentStore: null,
    reconciler: null,
    chatRateLimit: () => ({ allowed: true }),
    minChatCost: 0.000001,
    priceBook: createPriceBook(),
    x402Enabled: false,
  });
  return { server, rows, charges };
}

function chat(
  server: Awaited<ReturnType<typeof app>>["server"],
  model: string,
  stream = false,
) {
  return server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { authorization: "Bearer test" },
    payload: { model, messages: [{ role: "user", content: "hi" }], ...(stream ? { stream: true } : {}) },
  });
}

function meta(body: string): Record<string, unknown> {
  const frame = body.split("\n\n").find((part) => part.startsWith("event: lmx.meta"));
  assert.ok(frame, "lmx.meta event present");
  return JSON.parse(frame.split("\n")[1]!.slice("data: ".length)) as Record<string, unknown>;
}

/** What a caller can check from the response alone: usage x published rates = cost. */
function recompute(usage: LmxUsage): number {
  assert.ok(usage.cost, "lmx.usage.cost present");
  const { rates_per_1m: r, billed_tokens: b } = usage.cost;
  assert.equal(b.input + b.cached_input, usage.prompt_tokens);
  assert.equal(b.output, usage.completion_tokens);
  const raw = (b.input * r.input + b.cached_input * r.cached_input + b.output * r.output) / 1e6;
  return Math.round(raw * 1e8) / 1e8;
}

describe("per-model pricing on chat responses", () => {
  it("charges usage x the published rate, and the response shows the math", async () => {
    const { server, rows, charges } = await app(
      realRouter([
        provider("ionet", {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
            total_tokens: 1100,
            prompt_tokens_details: { cached_tokens: 400 },
            completion_tokens_details: { reasoning_tokens: 30 },
          },
          requestId: { id: "ionet-req-1", header: "x-request-id" },
        }),
      ]),
    );
    const res = await chat(server, "qwen-3.6-35b");
    assert.equal(res.statusCode, 200, res.body);

    const usage = JSON.parse(res.headers["x-lmx-usage"] as string) as LmxUsage;
    const price = createPriceBook().priceFor("qwen-3.6-35b")!;
    // 600 uncached x 0.1625 + 400 cached x 0.0813 + 100 output x 1.235 (reasoning inside output, billed once)
    assert.deepEqual(usage.cost?.billed_tokens, { input: 600, cached_input: 400, output: 100 });
    assert.deepEqual(usage.cost?.rates_per_1m, {
      input: price.rates.input,
      cached_input: price.rates.cachedInput,
      output: price.rates.output,
    });
    assert.equal(usage.cost_basis, "prompt_completion");

    const amount = recompute(usage);
    assert.equal(usage.cost?.amount_usd, amount);
    assert.equal(res.headers["x-lmx-cost"], String(amount));
    assert.deepEqual(charges, [amount]);
    assert.equal(res.headers["x-lmx-pricing-version"], price.pricingVersion);

    // The ledger row carries everything needed to recompute it.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.cost, amount);
    assert.equal(rows[0]!.promptTokens, 1000);
    assert.equal(rows[0]!.completionTokens, 100);
    assert.equal(rows[0]!.cachedPromptTokens, 400);
    assert.equal(rows[0]!.pricingVersion, price.pricingVersion);
    assert.equal(rows[0]!.providerRequestId, "ionet-req-1");
    assert.equal(rows[0]!.providerRequestIdHeader, "x-request-id");
  });

  it("charges the same price whichever provider serves the model", async () => {
    const viaIonet = await app(realRouter([provider("ionet")]));
    const viaAkash = await app(realRouter([provider("akash")]));
    const a = await chat(viaIonet.server, "llama-3.3-70b");
    const b = await chat(viaAkash.server, "llama-3.3-70b");
    assert.equal(a.headers["x-lmx-provider"], "ionet");
    assert.equal(b.headers["x-lmx-provider"], "akash");
    assert.equal(a.headers["x-lmx-cost"], b.headers["x-lmx-cost"]);
    // Ledger unit_price is what LMX paid: lower on Akash.
    assert.ok(viaAkash.rows[0]!.unitPrice! < viaIonet.rows[0]!.unitPrice!);
  });

  it("streams carry the same priced usage, the ledger id and the provider request id", async () => {
    const { server, rows, charges } = await app(
      realRouter([provider("akash", { requestId: { id: "inf-9", header: "inference-id" } })]),
    );
    const res = await chat(server, "qwen-3.6-35b", true);
    assert.equal(res.statusCode, 200);
    const trailer = meta(res.body);
    const usage = trailer.lmx_usage as LmxUsage;
    const amount = recompute(usage);
    assert.equal(trailer.cost, amount);
    assert.deepEqual(charges, [amount]);
    assert.equal(trailer.usage_id, "usage-1");
    assert.equal(rows[0]!.cost, amount);
    assert.equal(trailer.pricing_version, createPriceBook().priceFor("qwen-3.6-35b")!.pricingVersion);
    assert.equal(trailer.provider_request_id, "inf-9");
    assert.equal(res.headers["x-lmx-provider-request-id"], "inf-9");
    assert.equal(res.headers["x-lmx-provider-request-id-header"], "inference-id");
  });

  it("refuses a model with no verified price before calling any provider", async () => {
    const calls: string[] = [];
    const { server, rows, charges } = await app(realRouter([provider("ionet", { calls })]));
    const res = await chat(server, "llama-3.2-90b-vision");
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, "model_not_supported");
    assert.deepEqual(calls, []);
    assert.deepEqual(rows, []);
    assert.deepEqual(charges, []);
  });

  it("never routes to a provider that has no verified rate for the model", async () => {
    const calls: string[] = [];
    // Akash serves deepseek-v4-flash but is not on AkashML's price list, so only io.net may serve it.
    const { server } = await app(realRouter([provider("akash", { calls }), provider("ionet", { calls })]));
    const res = await chat(server, "deepseek-v4-flash");
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(calls, ["ionet:deepseek-v4-flash"]);
  });

  it("bills a total without a split at the output rate and says so", async () => {
    const { server } = await app(realRouter([provider("ionet", { usage: { total_tokens: 50 } })]));
    const res = await chat(server, "qwen-3.6-35b");
    const usage = JSON.parse(res.headers["x-lmx-usage"] as string) as LmxUsage;
    assert.equal(usage.cost_basis, "total_tokens_at_output_rate");
    const price = createPriceBook().priceFor("qwen-3.6-35b")!;
    assert.equal(
      usage.cost?.amount_usd,
      priceRequest(price, { prompt_tokens: null, completion_tokens: null, total_tokens: 50, cached_prompt_tokens: null }).amount,
    );
  });
});

describe("gate 1: substitution and alias handling at the route", () => {
  it("shows x-lmx-substitution: true to the caller on a streaming response", async () => {
    const { server } = await app(
      realRouter([provider("ionet", { bodyModel: () => "Qwen/Qwen3-Next-80B-A3B-Instruct" })]),
    );
    const res = await chat(server, "qwen-3.6-35b", true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-lmx-substitution"], "true");
    assert.equal(res.headers["x-lmx-model-expected"], QWEN36_UPSTREAM);
    assert.equal(res.headers["x-lmx-model-executed"], "Qwen/Qwen3-Next-80B-A3B-Instruct");
    assert.equal(meta(res.body).substitution, "true");
  });

  it("resolves a retired alias through the router and reports both names", async () => {
    for (const stream of [false, true]) {
      const calls: string[] = [];
      const { server } = await app(realRouter([provider("akash", { calls })]));
      const res = await chat(server, "qwen-3.5-35b", stream);
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(calls, ["akash:qwen-3.6-35b"], "provider asked for the resolved model");
      assert.equal(res.headers["x-lmx-model-requested"], "qwen-3.5-35b");
      assert.equal(res.headers["x-lmx-model-resolved"], "qwen-3.6-35b");
      assert.equal(res.headers["x-lmx-model-expected"], QWEN36_UPSTREAM);
      assert.equal(res.headers["x-lmx-substitution"], "false");
    }
  });

  it("flags a substitution against the resolved id when an aliased request comes back wrong", async () => {
    const { server } = await app(
      realRouter([provider("akash", { bodyModel: () => "Qwen/Qwen3.5-35B-A3B" })]),
    );
    const res = await chat(server, "qwen-3.5-35b");
    assert.equal(res.headers["x-lmx-model-expected"], QWEN36_UPSTREAM);
    assert.equal(res.headers["x-lmx-substitution"], "true");
  });
});
