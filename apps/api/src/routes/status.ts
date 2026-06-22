import type { FastifyInstance } from "fastify";
import { getFallbackChain } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";

interface StatusRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
}

export async function registerStatusRoutes(
  app: FastifyInstance,
  deps: StatusRouteDeps,
): Promise<void> {
  app.get("/v1/status", async () => {
    const statuses = deps.healthStore.getAll();

    return {
      object: "status",
      providers: Object.fromEntries(
        deps.providers.map((provider) => {
          const status = statuses[provider.name];
          return [
            provider.name,
            {
              healthy: status?.healthy ?? false,
              latency: status?.latencyMs ?? null,
              tier: provider.tier,
              is_depin: provider.isDepin,
              last_check: status?.lastCheck ?? null,
            },
          ];
        }),
      ),
      fallback_chain: getFallbackChain(deps.providers),
    };
  });
}
