import type { FastifyInstance } from "fastify";
import { getFallbackChain } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import { requireOpsAuth } from "../ops/auth.js";
import {
  getMcpToolEventById,
  ingestMcpToolEvent,
  listRecentMcpToolEvents,
  mcpToolEventCount,
  type McpToolEventInput,
} from "../ops/mcp-events.js";
import { detectIrregularities } from "../ops/irregularities.js";
import {
  getPaymentById,
  getReliabilityTelemetry,
  getUsageById,
  getUsageSummary,
  hasPostgres,
  listRecentPayments,
  listRecentUsage,
  listStuckPayments,
  listUsageHistory,
  paymentStatusCounts,
} from "../ops/queries.js";

interface OpsRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  x402Enabled: boolean;
  paymentStoreReady: boolean;
}

function parseLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 200));
}

function parseDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 90));
}

export async function registerOpsRoutes(
  app: FastifyInstance,
  deps: OpsRouteDeps,
): Promise<void> {
  await app.register(async (ops) => {
    ops.addHook("preHandler", requireOpsAuth);

    ops.post<{ Body: McpToolEventInput | McpToolEventInput[] }>(
      "/v1/ops/mcp-events",
      async (request, reply) => {
        const body = request.body;
        const inputs = Array.isArray(body) ? body : [body];

        if (inputs.length === 0) {
          return reply.status(400).send({
            error: {
              message: "Expected one or more MCP events",
              type: "invalid_request",
            },
          });
        }

        const ingested = [];
        for (const input of inputs) {
          if (
            !input?.tool ||
            !input?.callerId ||
            !input?.authSource ||
            typeof input.ok !== "boolean"
          ) {
            return reply.status(400).send({
              error: {
                message: "Each event requires tool, callerId, authSource, and ok",
                type: "invalid_request",
              },
            });
          }
          ingested.push(ingestMcpToolEvent(input));
        }

        return { object: "mcp_events", count: ingested.length, data: ingested };
      },
    );

    ops.get<{ Params: { id: string } }>(
      "/v1/ops/payments/:id",
      async (request, reply) => {
        const payment = await getPaymentById(request.params.id);
        if (!payment) {
          return reply.status(404).send({
            error: {
              message: "Payment not found",
              type: "invalid_request_error",
            },
          });
        }
        return { object: "ops_payment", ...payment };
      },
    );

    ops.get<{ Params: { id: string } }>(
      "/v1/ops/usage/:id",
      async (request, reply) => {
        const usage = await getUsageById(request.params.id);
        if (!usage) {
          return reply.status(404).send({
            error: {
              message: "Usage event not found",
              type: "invalid_request_error",
            },
          });
        }
        return { object: "ops_usage", ...usage };
      },
    );

    ops.get("/v1/ops/reliability", async (request) => {
      const query = request.query as Record<string, unknown>;
      const days = parseDays(query.days, 7);
      const resourceType =
        typeof query.resource_type === "string" && query.resource_type.trim()
          ? query.resource_type.trim()
          : null;
      return getReliabilityTelemetry(days, resourceType);
    });

    ops.get<{ Params: { id: string } }>(
      "/v1/ops/mcp-events/:id",
      async (request, reply) => {
        const event = getMcpToolEventById(request.params.id);
        if (!event) {
          return reply.status(404).send({
            error: {
              message:
                "MCP event not found (in-memory buffer only — may be gone after restart)",
              type: "invalid_request_error",
            },
          });
        }
        return { object: "ops_mcp_event", ...event };
      },
    );

    ops.get("/v1/ops/overview", async (request) => {
      const query = request.query as Record<string, unknown>;
      const days = parseDays(query.days, 7);
      const limit = parseLimit(query.limit, 40);

      const statuses = deps.healthStore.getAll();
      const providers = Object.fromEntries(
        deps.providers.map((provider) => {
          const status = statuses[provider.name];
          return [
            provider.name,
            {
              healthy: status?.healthy ?? false,
              latencyMs: status?.latencyMs ?? null,
              tier: provider.tier,
              isDepin: provider.isDepin,
              lastCheck: status?.lastCheck ?? null,
            },
          ];
        }),
      );

      const unhealthyProviders = Object.entries(providers)
        .filter(([, p]) => !p.healthy)
        .map(([name]) => name);
      const healthyCount = Object.values(providers).filter((p) => p.healthy).length;

      let payments: Awaited<ReturnType<typeof listRecentPayments>> = [];
      let usageRecent: Awaited<ReturnType<typeof listRecentUsage>> = [];
      let usageHistory: Awaited<ReturnType<typeof listUsageHistory>> = [];
      let usageSummary: Awaited<ReturnType<typeof getUsageSummary>> = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        fallbackCount: 0,
        avgLatencyMs: null,
        uniquePayers: 0,
        uniqueApiKeys: 0,
      };
      let paymentCounts: Record<string, number> = {};
      let stuckPayments: Awaited<ReturnType<typeof listStuckPayments>> = [];
      let reliability: Awaited<ReturnType<typeof getReliabilityTelemetry>> | null = null;
      let dbError: string | null = null;

      try {
        [
          payments,
          usageRecent,
          usageHistory,
          usageSummary,
          paymentCounts,
          stuckPayments,
          reliability,
        ] = await Promise.all([
          listRecentPayments(limit),
          listRecentUsage(limit),
          listUsageHistory(days),
          getUsageSummary(days),
          paymentStatusCounts(days),
          listStuckPayments(15, 20),
          getReliabilityTelemetry(days, null),
        ]);
      } catch (err) {
        dbError = err instanceof Error ? err.message : "Database query failed";
        request.log.warn({ err }, "ops overview database queries failed");
      }

      const mcpEvents = listRecentMcpToolEvents(limit);

      type ActivityItem =
        | {
            kind: "payment";
            id: string;
            at: string;
            channel: "x402";
            label: string;
            status: string;
            amount: number;
            model: string;
            wallet: string;
            txHash: string | null;
          }
        | {
            kind: "usage";
            id: string;
            at: string;
            channel: "x402" | "balance";
            label: string;
            provider: string;
            model: string;
            tokens: number;
            cost: number;
            latencyMs: number;
            fallbackUsed: boolean;
          }
        | {
            kind: "mcp";
            id: string;
            at: string;
            channel: "mcp";
            label: string;
            tool: string;
            ok: boolean;
            callerId: string;
            authSource: string;
            latencyMs?: number;
            detail?: string;
          };

      const activity: ActivityItem[] = [
        ...payments.map(
          (p): ActivityItem => ({
            kind: "payment",
            id: p.id,
            at: p.createdAt,
            channel: "x402",
            label: `x402 ${p.status}`,
            status: p.status,
            amount: p.settledAmount ?? p.quotedAmount,
            model: p.model,
            wallet: p.payerWallet,
            txHash: p.txHash,
          }),
        ),
        ...usageRecent.map(
          (u): ActivityItem => ({
            kind: "usage",
            id: u.id,
            at: u.createdAt,
            channel: u.channel === "x402" ? "x402" : "balance",
            label: u.success
              ? `${u.provider}/${u.model}`
              : `${u.provider}/${u.model} failed`,
            provider: u.provider,
            model: u.model,
            tokens: u.totalTokens,
            cost: u.cost,
            latencyMs: u.latencyMs,
            fallbackUsed: u.fallbackUsed,
          }),
        ),
        ...mcpEvents.map(
          (e): ActivityItem => ({
            kind: "mcp",
            id: e.id,
            at: e.ts,
            channel: "mcp",
            label: e.tool,
            tool: e.tool,
            ok: e.ok,
            callerId: e.callerId,
            authSource: e.authSource,
            latencyMs: e.latencyMs,
            detail: e.detail,
          }),
        ),
      ]
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, limit);

      const irregularities = detectIrregularities({
        windowDays: days,
        storage: hasPostgres() ? "postgres" : "file",
        x402Enabled: deps.x402Enabled,
        paymentStoreReady: deps.paymentStoreReady,
        healthyCount,
        providerCount: deps.providers.length,
        unhealthyProviders,
        paymentStatusCounts: paymentCounts,
        stuckPayments,
        usageSummary,
        usageHistory,
        mcpEvents,
        recentPayments: payments,
      });

      if (dbError) {
        irregularities.unshift({
          id: "config.db_unreachable",
          severity: "critical",
          category: "config",
          title: "Ops database unreachable",
          detail: dbError,
          action: "Check DATABASE_URL / Neon project status and local network; payments and usage panels may be empty until reconnect.",
        });
      }

      const attention = {
        critical: irregularities.filter((i) => i.severity === "critical").length,
        warn: irregularities.filter((i) => i.severity === "warn").length,
        info: irregularities.filter((i) => i.severity === "info").length,
      };

      return {
        object: "ops_overview",
        generatedAt: new Date().toISOString(),
        windowDays: days,
        storage: hasPostgres() ? "postgres" : "file",
        server: {
          x402Enabled: deps.x402Enabled,
          paymentStore: deps.paymentStoreReady ? "ready" : "disabled",
          providersConfigured: deps.providers.map((p) => p.name),
          fallbackChain: getFallbackChain(deps.providers),
        },
        health: {
          healthyCount,
          providerCount: deps.providers.length,
          providers,
        },
        payments: {
          recent: payments,
          statusCounts: paymentCounts,
        },
        usage: {
          summary: usageSummary,
          history: usageHistory,
          recent: usageRecent,
        },
        reliability,
        mcp: {
          buffered: mcpToolEventCount(),
          recent: mcpEvents,
        },
        paymentsStuck: stuckPayments,
        attention,
        irregularities,
        activity,
      };
    });
  });
}
