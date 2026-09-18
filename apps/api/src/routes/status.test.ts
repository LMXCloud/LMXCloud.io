import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { InMemoryHealthStore } from "../health/store.js";
import type { ProviderAdapter } from "../providers/types.js";
import { RoutingSignalStore } from "../routing/signal-store.js";
import { registerStatusRoutes } from "./status.js";

function mockProvider(name: string, tier = 1): ProviderAdapter {
  return {
    name,
    tier,
    costPer1kTokens: 0.0001,
    isDepin: true,
    aliases: [`${name}-model`],
    supportsModel: () => true,
    chatCompletion: async () => {
      throw new Error("not implemented");
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
  };
}

describe("GET /v1/status", () => {
  it("reports real-traffic success over the routing window, not the gateway ping", async () => {
    const healthStore = new InMemoryHealthStore();
    healthStore.set("akash", {
      healthy: true,
      reachable: true,
      latencyMs: 12,
      lastCheck: 1_700_000_000_000,
    });
    const routingSignalStore = new RoutingSignalStore();
    routingSignalStore.applyHistory([
      {
        provider: "akash",
        realAttempts: 35,
        realSuccesses: 0,
        syntheticAttempts: 20,
        syntheticSuccesses: 20,
      },
    ]);

    const app = Fastify();
    await registerStatusRoutes(app, {
      providers: [mockProvider("akash", 2)],
      healthStore,
      routingSignalStore,
    });

    const res = await app.inject({ method: "GET", url: "/v1/status" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      providers: Record<
        string,
        {
          healthy: boolean;
          gateway_healthy: boolean;
          real_attempts: number;
          real_successes: number;
          real_success_rate: number | null;
          real_window_hours: number;
        }
      >;
      real_traffic: {
        window_hours: number;
        attempts: number;
        successes: number;
        success_rate: number | null;
      };
    };

    assert.equal(body.providers.akash?.gateway_healthy, true);
    assert.equal(body.providers.akash?.healthy, false);
    assert.equal(body.providers.akash?.real_attempts, 35);
    assert.equal(body.providers.akash?.real_successes, 0);
    assert.equal(body.providers.akash?.real_success_rate, 0);
    assert.equal(body.providers.akash?.real_window_hours, 6);
    assert.equal(body.real_traffic.window_hours, 6);
    assert.equal(body.real_traffic.attempts, 35);
    assert.equal(body.real_traffic.successes, 0);
    assert.equal(body.real_traffic.success_rate, 0);

    await app.close();
  });

  it("exposes a zero attempt count when the window is empty so ping-healthy is not overclaimed", async () => {
    const healthStore = new InMemoryHealthStore();
    healthStore.set("ionet", {
      healthy: true,
      reachable: true,
      latencyMs: 8,
      lastCheck: 1_700_000_000_000,
    });
    const routingSignalStore = new RoutingSignalStore();

    const app = Fastify();
    await registerStatusRoutes(app, {
      providers: [mockProvider("ionet")],
      healthStore,
      routingSignalStore,
    });

    const res = await app.inject({ method: "GET", url: "/v1/status" });
    const body = res.json() as {
      providers: Record<
        string,
        {
          healthy: boolean;
          gateway_healthy: boolean;
          real_attempts: number;
          real_success_rate: number | null;
          real_window_hours: number;
        }
      >;
      real_traffic: { attempts: number; window_hours: number };
    };

    assert.equal(body.providers.ionet?.gateway_healthy, true);
    assert.equal(body.providers.ionet?.healthy, true);
    assert.equal(body.providers.ionet?.real_attempts, 0);
    assert.equal(body.providers.ionet?.real_success_rate, null);
    assert.equal(body.providers.ionet?.real_window_hours, 6);
    assert.equal(body.real_traffic.attempts, 0);
    assert.equal(body.real_traffic.window_hours, 6);

    await app.close();
  });
});
