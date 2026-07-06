import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ApiKeyStore } from "../auth/store.js";
import type { UsageStore } from "../usage/store.js";

interface UsageRouteDeps {
  store: UsageStore;
  apiKeyStore: ApiKeyStore;
  authenticate: preHandlerHookHandler;
}

function parseDays(value: unknown): number {
  const parsed = Number(value ?? 7);
  if (!Number.isFinite(parsed) || parsed < 1) return 7;
  return Math.min(Math.floor(parsed), 90);
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

  app.get<{ Querystring: { days?: string } }>(
    "/v1/usage/history",
    { preHandler: deps.authenticate },
    async (request) => {
      const days = parseDays(request.query.days);
      const keys = await deps.apiKeyStore.listForRecord(request.apiKey!);
      const keyIds = keys.map((key) => key.id);
      const data = await deps.store.getUsageHistory(keyIds, days);

      return {
        object: "usage.history",
        days,
        data: data.map((bucket) => ({
          date: bucket.date,
          requests: bucket.requests,
          prompt_tokens: bucket.promptTokens,
          completion_tokens: bucket.completionTokens,
          total_tokens: bucket.totalTokens,
          cost: bucket.cost,
        })),
      };
    },
  );
}
