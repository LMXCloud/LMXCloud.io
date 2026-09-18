import { isOpenAiProprietaryModelId } from "@lmxcloud/shared";
import type { FastifyInstance } from "fastify";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";

interface ModelsRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
}

export async function registerModelsRoutes(
  app: FastifyInstance,
  deps: ModelsRouteDeps,
): Promise<void> {
  app.get("/v1/models", async () => {
    const statuses = deps.healthStore.getAll();
    const models = new Map<string, { id: string; owned_by: string; tier: number }>();

    for (const provider of deps.providers) {
      const status = statuses[provider.name];
      if (!status?.healthy) continue;

      for (const alias of provider.aliases) {
        if (isOpenAiProprietaryModelId(alias)) continue;
        const existing = models.get(alias);
        if (!existing || provider.tier < existing.tier) {
          models.set(alias, {
            id: alias,
            owned_by: provider.name,
            tier: provider.tier,
          });
        }
      }
    }

    const created = Math.floor(Date.now() / 1000);

    return {
      object: "list",
      data: [...models.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((model) => ({
          id: model.id,
          object: "model" as const,
          created,
          owned_by: model.owned_by,
        })),
    };
  });
}
