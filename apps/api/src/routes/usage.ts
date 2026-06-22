import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { UsageStore } from "../usage/store.js";

interface UsageRouteDeps {
  store: UsageStore;
  authenticate: preHandlerHookHandler;
}

export async function registerUsageRoutes(
  app: FastifyInstance,
  deps: UsageRouteDeps,
): Promise<void> {
  app.get(
    "/v1/usage",
    { preHandler: deps.authenticate },
    async (request) => {
      const apiKeyId = request.apiKey!.id;
      const stats = await deps.store.getUsage(apiKeyId);

      return {
        object: "usage",
        api_key_id: apiKeyId,
        requests: stats?.requestCount ?? 0,
        prompt_tokens: stats?.promptTokens ?? 0,
        completion_tokens: stats?.completionTokens ?? 0,
        total_tokens: stats?.totalTokens ?? 0,
        last_request_at: stats?.lastRequestAt ?? null,
      };
    },
  );
}
