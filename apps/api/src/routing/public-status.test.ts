import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateRealTraffic,
  emptyRealTraffic,
  providerHealthyForPublicStatus,
} from "./public-status.js";
import {
  ROUTING_HISTORY_WINDOW_HOURS,
  RoutingSignalStore,
} from "./signal-store.js";

describe("providerHealthyForPublicStatus", () => {
  it("falls back to the gateway ping when the window has no real attempts", () => {
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 0,
        realSuccesses: 0,
      }),
      true,
    );
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: false,
        realAttempts: 0,
        realSuccesses: 0,
      }),
      false,
    );
  });

  it("is unhealthy when every recent real attempt failed, even if the ping is up", () => {
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 10,
        realSuccesses: 0,
      }),
      false,
    );
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 2,
        realSuccesses: 0,
      }),
      false,
    );
  });

  it("is unhealthy when the circuit is open", () => {
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 10,
        realSuccesses: 10,
        circuit: "open",
      }),
      false,
    );
  });

  it("uses the routing success floor once there are enough samples", () => {
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 10,
        realSuccesses: 1,
      }),
      false,
    );
    assert.equal(
      providerHealthyForPublicStatus({
        gatewayUp: true,
        realAttempts: 10,
        realSuccesses: 10,
      }),
      true,
    );
  });
});

describe("RoutingSignalStore.getReportedRealTraffic", () => {
  it("prefers rolling history over the live circuit ring", () => {
    const store = new RoutingSignalStore();
    store.applyHistory([
      {
        provider: "akash",
        realAttempts: 35,
        realSuccesses: 0,
        syntheticAttempts: 10,
        syntheticSuccesses: 10,
      },
    ]);
    store.recordAttempt("akash", true);

    const traffic = store.getReportedRealTraffic("akash");
    assert.equal(traffic.windowHours, ROUTING_HISTORY_WINDOW_HOURS);
    assert.equal(traffic.attempts, 35);
    assert.equal(traffic.successes, 0);
    assert.equal(traffic.successRate, 0);
  });

  it("falls back to live chat outcomes when history is empty", () => {
    const store = new RoutingSignalStore();
    store.recordAttempt("ionet", false, "provider_http_500");
    store.recordAttempt("ionet", false, "provider_http_500");
    store.recordAttempt("ionet", true);

    const traffic = store.getReportedRealTraffic("ionet");
    assert.equal(traffic.attempts, 3);
    assert.equal(traffic.successes, 1);
    assert.equal(traffic.successRate, 1 / 3);
    assert.equal(traffic.windowHours, ROUTING_HISTORY_WINDOW_HOURS);
  });

  it("reports a zero window when there is no real traffic yet", () => {
    const store = new RoutingSignalStore();
    const traffic = store.getReportedRealTraffic("aethir");
    assert.deepEqual(traffic, emptyRealTraffic());
  });
});

describe("aggregateRealTraffic", () => {
  it("sums attempts across providers and keeps the window size", () => {
    const overall = aggregateRealTraffic([
      { attempts: 10, successes: 8, successRate: 0.8, windowHours: 6 },
      { attempts: 5, successes: 0, successRate: 0, windowHours: 6 },
    ]);
    assert.equal(overall.attempts, 15);
    assert.equal(overall.successes, 8);
    assert.equal(overall.successRate, 8 / 15);
    assert.equal(overall.windowHours, 6);
  });
});
