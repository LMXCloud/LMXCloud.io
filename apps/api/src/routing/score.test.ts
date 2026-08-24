import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  orderProvidersByBands,
  orderProvidersByScore,
  scoreProvider,
  ROUTING_SCORE_DEFAULTS,
} from "./score.js";
import { RoutingSignalStore } from "./signal-store.js";

describe("scoreProvider", () => {
  it("does not demote on tiny real samples", () => {
    const result = scoreProvider({
      name: "ionet",
      tier: 1,
      gatewayHealthy: true,
      circuit: "closed",
      history: {
        realAttempts: 3,
        realSuccesses: 0,
        syntheticAttempts: 0,
        syntheticSuccesses: 0,
      },
    });
    assert.equal(result.demoted, false);
    assert.equal(result.score, null);
  });

  it("demotes when real success is below floor with enough samples", () => {
    const result = scoreProvider({
      name: "akash",
      tier: 2,
      gatewayHealthy: true,
      circuit: "closed",
      history: {
        realAttempts: 35,
        realSuccesses: 0,
        syntheticAttempts: 100,
        syntheticSuccesses: 0,
      },
    });
    assert.equal(result.demoted, true);
    assert.ok(result.score != null);
    assert.ok(result.score! < ROUTING_SCORE_DEFAULTS.successFloor);
  });

  it("uses synthetic as demote proxy when real samples are insufficient", () => {
    const result = scoreProvider({
      name: "akash",
      tier: 2,
      gatewayHealthy: true,
      circuit: "closed",
      history: {
        realAttempts: 2,
        realSuccesses: 0,
        syntheticAttempts: 20,
        syntheticSuccesses: 1,
      },
    });
    assert.equal(result.demoted, true);
    assert.equal(result.score, 1 / 20);
  });

  it("blends real and synthetic when both have enough samples", () => {
    const result = scoreProvider({
      name: "ionet",
      tier: 1,
      gatewayHealthy: true,
      circuit: "closed",
      history: {
        realAttempts: 10,
        realSuccesses: 10,
        syntheticAttempts: 10,
        syntheticSuccesses: 0,
      },
    });
    assert.equal(result.demoted, false);
    assert.equal(
      result.score,
      ROUTING_SCORE_DEFAULTS.realWeight * 1 +
        ROUTING_SCORE_DEFAULTS.syntheticWeight * 0,
    );
  });
});

describe("orderProvidersByScore", () => {
  it("puts demoted and open-circuit providers after healthy ones", () => {
    const providers = [
      { name: "ionet", tier: 1 },
      { name: "akash", tier: 2 },
      { name: "aethir", tier: 2 },
    ];
    const store = new RoutingSignalStore();
    store.applyHistory([
      {
        provider: "ionet",
        realAttempts: 10,
        realSuccesses: 8,
        syntheticAttempts: 10,
        syntheticSuccesses: 9,
      },
      {
        provider: "akash",
        realAttempts: 35,
        realSuccesses: 0,
        syntheticAttempts: 10,
        syntheticSuccesses: 0,
      },
      {
        provider: "aethir",
        realAttempts: 0,
        realSuccesses: 0,
        syntheticAttempts: 0,
        syntheticSuccesses: 0,
      },
    ]);

    // Trip akash circuit via billing
    for (let i = 0; i < 3; i++) {
      store.recordAttempt("akash", false, "provider_billing_exhausted");
    }

    const ordered = store.orderProviders(providers, (name) => name !== "aethir");
    assert.deepEqual(
      ordered.map((p) => p.name),
      ["ionet", "aethir", "akash"],
    );
  });

  it("preserves cheapest primary order within bands", () => {
    const providers = [
      { name: "cheap", tier: 2, costPer1kTokens: 0.1 },
      { name: "mid", tier: 1, costPer1kTokens: 0.2 },
      { name: "pricey", tier: 1, costPer1kTokens: 0.3 },
    ];
    const scored = new Map(
      providers.map((p) => [
        p.name,
        scoreProvider({
          name: p.name,
          tier: p.tier,
          gatewayHealthy: true,
          circuit: "closed",
          history: null,
        }),
      ]),
    );
    // demote mid
    scored.set(
      "mid",
      scoreProvider({
        name: "mid",
        tier: 1,
        gatewayHealthy: true,
        circuit: "closed",
        history: {
          realAttempts: 10,
          realSuccesses: 0,
          syntheticAttempts: 0,
          syntheticSuccesses: 0,
        },
      }),
    );

    const byCost = [...providers].sort(
      (a, b) => a.costPer1kTokens - b.costPer1kTokens,
    );
    const ordered = orderProvidersByBands(byCost, scored);
    assert.deepEqual(
      ordered.map((p) => p.name),
      ["cheap", "pricey", "mid"],
    );
  });

  it("ranks higher scores first when neither is demoted", () => {
    const providers = [
      { name: "low", tier: 1 },
      { name: "high", tier: 2 },
    ];
    const scored = new Map([
      [
        "low",
        scoreProvider({
          name: "low",
          tier: 1,
          gatewayHealthy: true,
          circuit: "closed",
          history: {
            realAttempts: 10,
            realSuccesses: 3,
            syntheticAttempts: 0,
            syntheticSuccesses: 0,
          },
        }),
      ],
      [
        "high",
        scoreProvider({
          name: "high",
          tier: 2,
          gatewayHealthy: true,
          circuit: "closed",
          history: {
            realAttempts: 10,
            realSuccesses: 9,
            syntheticAttempts: 0,
            syntheticSuccesses: 0,
          },
        }),
      ],
    ]);
    const ordered = orderProvidersByScore(providers, scored);
    assert.deepEqual(
      ordered.map((p) => p.name),
      ["high", "low"],
    );
  });
});
