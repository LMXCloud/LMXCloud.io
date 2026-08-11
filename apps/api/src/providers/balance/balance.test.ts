import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createIonetBalancePoller } from "./ionet.js";
import { createStaticNotObservablePoller } from "./static.js";
import { detectIrregularities } from "../../ops/irregularities.js";
import type { ProviderBalanceStatus } from "./types.js";

describe("createIonetBalancePoller", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("returns API balance when sub-key usage reports remaining_credit", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({
        status: "succeeded",
        data: {
          remaining_credit: 4.5,
          credit_limit: 10,
        },
      }),
    );

    const poller = createIonetBalancePoller({ apiKey: "sub-key", thresholdUsd: 10 });
    const status = await poller.poll();

    assert.deepEqual(status.observability, {
      mode: "api",
      balanceUsd: 4.5,
      balanceKind: "remaining sub-key allowance (not account balance)",
      checkUrl:
        "https://api.intelligence.io.solutions/v1/api-keys/sub-keys/me/usage",
    });
    assert.equal(status.belowThreshold, true);
  });

  it("marks admin keys as not API-observable on 403", async () => {
    mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));

    const poller = createIonetBalancePoller({ apiKey: "admin-key", thresholdUsd: 10 });
    const status = await poller.poll();

    assert.deepEqual(status.observability, {
      mode: "not_api_observable",
      reason: "not API-observable — check dashboard manually",
    });
    assert.equal(status.belowThreshold, false);
  });

  it("marks sub-keys without credit_limit as not API-observable", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({
        status: "succeeded",
        data: {
          remaining_credit: null,
          credit_limit: null,
        },
      }),
    );

    const poller = createIonetBalancePoller({ apiKey: "sub-key", thresholdUsd: 10 });
    const status = await poller.poll();

    assert.equal(status.observability.mode, "not_api_observable");
  });
});

describe("createStaticNotObservablePoller", () => {
  it("labels AkashML/Aethir-style providers as dashboard-only", async () => {
    const poller = createStaticNotObservablePoller({
      provider: "akash",
      thresholdUsd: 10,
    });
    const status = await poller.poll();

    assert.deepEqual(status.observability, {
      mode: "not_api_observable",
      reason: "not API-observable — check dashboard manually",
    });
  });
});

describe("detectIrregularities provider balance low", () => {
  const baseInput = {
    windowDays: 7,
    storage: "postgres" as const,
    x402Enabled: false,
    paymentStoreReady: true,
    healthyCount: 1,
    providerCount: 1,
    unhealthyProviders: [] as string[],
    paymentStatusCounts: {},
    stuckPayments: [],
    pendingReconciliations: [],
    usageSummary: {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      fallbackCount: 0,
      avgLatencyMs: null,
      uniquePayers: 0,
      uniqueApiKeys: 0,
    },
    usageHistory: [],
    mcpEvents: [],
    recentPayments: [],
    recentUsage: [],
  };

  it("fires warn irregularity when API-observable balance is below threshold", () => {
    const balances: Record<string, ProviderBalanceStatus> = {
      ionet: {
        observability: {
          mode: "api",
          balanceUsd: 5,
          balanceKind: "remaining sub-key allowance (not account balance)",
          checkUrl: "https://example.com",
        },
        thresholdUsd: 10,
        belowThreshold: true,
        lastCheck: Date.now(),
        latencyMs: 50,
      },
    };

    const irregularities = detectIrregularities({
      ...baseInput,
      providerBalances: balances,
    });

    const low = irregularities.find((item) => item.id === "health.provider_balance_low.ionet");
    assert.ok(low);
    assert.equal(low?.severity, "warn");
  });

  it("skips not_api_observable providers", () => {
    const balances: Record<string, ProviderBalanceStatus> = {
      akash: {
        observability: {
          mode: "not_api_observable",
          reason: "not API-observable — check dashboard manually",
        },
        thresholdUsd: 10,
        belowThreshold: false,
        lastCheck: Date.now(),
        latencyMs: null,
      },
    };

    const irregularities = detectIrregularities({
      ...baseInput,
      providerBalances: balances,
    });

    assert.equal(
      irregularities.some((item) => item.id.startsWith("health.provider_balance_low.")),
      false,
    );
  });
});
