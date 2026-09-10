import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ApiKeyStore } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import type { HealthStore } from "../health/store.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { RoutingSignalStore } from "../routing/signal-store.js";
import { hasPostgres } from "../ops/queries.js";
import {
  buildUserNotificationFeed,
  dismissUserNotifications,
  markUserNotificationsRead,
  type NotificationFeedDeps,
} from "../notifications/feed.js";
import { parseReadBody } from "../notifications/parse.js";

interface NotificationRouteDeps {
  authenticate: preHandlerHookHandler;
  apiKeyStore: ApiKeyStore;
  creditStore: CreditStore;
  healthStore: HealthStore;
  providers: ProviderAdapter[];
  routingSignalStore?: RoutingSignalStore;
}

function feedDeps(deps: NotificationRouteDeps): NotificationFeedDeps {
  return {
    apiKeyStore: deps.apiKeyStore,
    creditStore: deps.creditStore,
    healthStore: deps.healthStore,
    providers: deps.providers,
    routingSignalStore: deps.routingSignalStore,
  };
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRouteDeps,
): Promise<void> {
  app.get(
    "/v1/notifications",
    { preHandler: deps.authenticate },
    async (request) => {
      const items = await buildUserNotificationFeed(request.apiKey!, feedDeps(deps));
      return { object: "list", data: items };
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/notifications/read",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const parsed = parseReadBody(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({
          error: { message: parsed.message, type: "invalid_request_error" },
        });
      }
      if (!hasPostgres()) {
        return reply.status(503).send({
          error: {
            message: "DATABASE_URL is required to persist notification reads",
            type: "service_unavailable",
          },
        });
      }
      const items = await markUserNotificationsRead(
        request.apiKey!,
        parsed.ids,
        feedDeps(deps),
      );
      return { object: "list", data: items };
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/notifications/dismiss",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const parsed = parseReadBody(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({
          error: { message: parsed.message, type: "invalid_request_error" },
        });
      }
      if (!hasPostgres()) {
        return reply.status(503).send({
          error: {
            message: "DATABASE_URL is required to dismiss notifications",
            type: "service_unavailable",
          },
        });
      }
      const items = await dismissUserNotifications(
        request.apiKey!,
        parsed.ids,
        feedDeps(deps),
      );
      return { object: "list", data: items };
    },
  );
}
