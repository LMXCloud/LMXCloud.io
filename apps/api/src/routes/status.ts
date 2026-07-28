import type { FastifyInstance } from "fastify";
import type { AnchorStore } from "../anchors/store.js";
import {
  getLatestHealthCheckErrors,
  getProviderHealthHistory,
  type ProviderHealthSignalStats,
} from "../health/queries.js";
import { getReliabilityTelemetry } from "../ops/queries.js";
import { getFallbackChain } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";

interface StatusRouteDeps {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  anchorStore?: AnchorStore | null;
  anchoring?: {
    chainId: number;
    contractAddress: `0x${string}`;
  };
}

function parseDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 90));
}

function emptySignalJson() {
  return {
    checks: 0,
    healthy_checks: 0,
    uptime: 0,
    avg_latency_ms: null as number | null,
    p50_latency_ms: null as number | null,
    p95_latency_ms: null as number | null,
    last_error_detail: null as string | null,
  };
}

function signalJson(
  stats: ProviderHealthSignalStats,
  lastErrorDetail?: string | null,
) {
  return {
    checks: stats.checks,
    healthy_checks: stats.healthyChecks,
    uptime: stats.uptime,
    avg_latency_ms: stats.avgLatencyMs,
    p50_latency_ms: stats.p50LatencyMs,
    p95_latency_ms: stats.p95LatencyMs,
    last_error_detail: lastErrorDetail ?? null,
  };
}

export async function registerStatusRoutes(
  app: FastifyInstance,
  deps: StatusRouteDeps,
): Promise<void> {
  app.get("/v1/status", async () => {
    const statuses = deps.healthStore.getAll();

    let anchoring:
      | {
          enabled: boolean;
          chain_id: number;
          contract_address: string;
          recent_roots: Array<{
            root: string;
            tx_hash: string | null;
            event_count: number;
            anchored_at: string | null;
          }>;
        }
      | { enabled: false };

    if (deps.anchoring && deps.anchorStore) {
      const batches = await deps.anchorStore.listRecentAnchoredBatches(5);
      anchoring = {
        enabled: true,
        chain_id: deps.anchoring.chainId,
        contract_address: deps.anchoring.contractAddress,
        recent_roots: batches.map((batch) => ({
          root: batch.merkleRoot,
          tx_hash: batch.txHash,
          event_count: batch.eventCount,
          anchored_at: batch.anchoredAt,
        })),
      };
    } else {
      anchoring = { enabled: false };
    }

    // Compact reliability snapshot for StatusPage — full series via GET /v1/ops/reliability
    const reliability = await getReliabilityTelemetry(7, null);

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
      anchoring,
      reliability: {
        window_days: reliability.windowDays,
        overall: {
          attempts: reliability.overall.attempts,
          successes: reliability.overall.successes,
          failures: reliability.overall.failures,
          success_rate: reliability.overall.successRate,
          avg_latency_ms: reliability.overall.avgLatencyMs,
          avg_unit_price: reliability.overall.avgUnitPrice,
        },
        by_provider: reliability.byProvider.map((row) => ({
          resource_type: row.resourceType,
          provider: row.provider,
          attempts: row.attempts,
          successes: row.successes,
          failures: row.failures,
          success_rate: row.successRate,
          avg_latency_ms: row.avgLatencyMs,
          avg_unit_price: row.avgUnitPrice,
        })),
      },
    };
  });

  /**
   * Three-tier provider reliability (not blended):
   * - gateway: /models reachability polls
   * - synthetic_completion: real chatCompletion probes
   * - real_traffic: customer usage_events (merged at read time)
   * Query: ?days=1|7|30 (default 30, max 90).
   */
  app.get<{ Querystring: { days?: string } }>("/v1/status/history", async (request) => {
    const days = parseDays(request.query.days, 30);
    const [history, gatewayErrors, syntheticErrors] = await Promise.all([
      getProviderHealthHistory(days),
      getLatestHealthCheckErrors("gateway"),
      getLatestHealthCheckErrors("synthetic_completion"),
    ]);
    const byName = new Map(history.byProvider.map((row) => [row.provider, row]));

    return {
      object: history.object,
      window_days: history.windowDays,
      by_provider: deps.providers.map((provider) => {
        const row = byName.get(provider.name);
        return {
          provider: provider.name,
          gateway: row
            ? signalJson(row.gateway, gatewayErrors.get(provider.name))
            : emptySignalJson(),
          synthetic_completion: row
            ? signalJson(
                row.syntheticCompletion,
                syntheticErrors.get(provider.name),
              )
            : emptySignalJson(),
          real_traffic: row ? signalJson(row.realTraffic) : emptySignalJson(),
        };
      }),
    };
  });
}
