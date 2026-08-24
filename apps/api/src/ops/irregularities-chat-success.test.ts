import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectIrregularities } from "./irregularities.js";
import type { DetectIrregularitiesInput } from "./irregularities.js";
import type { ReliabilityTelemetry } from "../telemetry/types.js";

function baseInput(
  overrides: Partial<DetectIrregularitiesInput> = {},
): DetectIrregularitiesInput {
  return {
    windowDays: 7,
    storage: "postgres",
    x402Enabled: true,
    paymentStoreReady: true,
    healthyCount: 2,
    providerCount: 3,
    unhealthyProviders: ["aethir"],
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
    ...overrides,
  };
}

function chatReliability(
  overall: { attempts: number; successes: number },
  byProvider: Array<{ provider: string; attempts: number; successes: number }>,
): ReliabilityTelemetry {
  const failures = overall.attempts - overall.successes;
  return {
    object: "reliability_telemetry",
    windowDays: 7,
    resourceType: "chat",
    overall: {
      attempts: overall.attempts,
      successes: overall.successes,
      failures,
      successRate:
        overall.attempts === 0 ? 0 : overall.successes / overall.attempts,
      avgLatencyMs: 1000,
      avgUnitPrice: 0.0001,
    },
    byProvider: byProvider.map((row) => ({
      resourceType: "chat",
      provider: row.provider,
      attempts: row.attempts,
      successes: row.successes,
      failures: row.attempts - row.successes,
      successRate: row.attempts === 0 ? 0 : row.successes / row.attempts,
      avgLatencyMs: 500,
      avgUnitPrice: 0.0001,
    })),
    series: [],
  };
}

describe("detectIrregularities chat success collapse", () => {
  it("emits critical overall + per-provider alerts matching Aug 11 incident shape", () => {
    const irregularities = detectIrregularities(
      baseInput({
        chatReliability: chatReliability(
          { attempts: 86, successes: 15 },
          [
            { provider: "akash", attempts: 35, successes: 0 },
            { provider: "ionet", attempts: 51, successes: 15 },
          ],
        ),
      }),
    );

    const ids = irregularities.map((i) => i.id);
    assert.ok(ids.includes("usage.chat_success_collapse"));
    assert.ok(ids.includes("usage.provider_chat_success_low.akash"));
    // ionet at 29.4% is above 20% floor — no per-provider critical
    assert.ok(!ids.includes("usage.provider_chat_success_low.ionet"));

    const collapse = irregularities.find(
      (i) => i.id === "usage.chat_success_collapse",
    )!;
    assert.equal(collapse.severity, "critical");
  });

  it("does not alert on tiny samples", () => {
    const irregularities = detectIrregularities(
      baseInput({
        chatReliability: chatReliability(
          { attempts: 5, successes: 0 },
          [{ provider: "akash", attempts: 3, successes: 0 }],
        ),
        unhealthyProviders: [],
        healthyCount: 1,
        providerCount: 1,
      }),
    );
    const ids = irregularities.map((i) => i.id);
    assert.ok(!ids.includes("usage.chat_success_collapse"));
    assert.ok(!ids.includes("usage.provider_chat_success_low.akash"));
  });
});
