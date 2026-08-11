import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import type { ProviderBalanceStore } from "../providers/balance/types.js";
import { listRecentMcpToolEvents } from "./mcp-events.js";
import {
  detectIrregularities,
  type OpsIrregularity,
} from "./irregularities.js";
import {
  getUsageSummary,
  hasPostgres,
  listPendingReconciliations,
  listRecentPayments,
  listRecentUsage,
  listStuckPayments,
  listUsageHistory,
  paymentStatusCounts,
} from "./queries.js";

export type CollectIrregularitiesDeps = {
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  balanceStore: ProviderBalanceStore;
  x402Enabled: boolean;
  paymentStoreReady: boolean;
  windowDays?: number;
  limit?: number;
};

/**
 * Gather ops metrics and run threshold detection (no diagnostic enrichment).
 * Shared by the ops overview route and the background irregularity monitor.
 */
export async function collectIrregularities(
  deps: CollectIrregularitiesDeps,
): Promise<OpsIrregularity[]> {
  const days = deps.windowDays ?? 7;
  const limit = deps.limit ?? 40;

  const statuses = deps.healthStore.getAll();
  const balanceStatuses = deps.balanceStore.getAll();

  const unhealthyProviders = deps.providers
    .filter((provider) => !statuses[provider.name]?.healthy)
    .map((provider) => provider.name);
  const healthyCount = deps.providers.filter(
    (provider) => statuses[provider.name]?.healthy,
  ).length;

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
  let pendingReconciliations: Awaited<
    ReturnType<typeof listPendingReconciliations>
  > = [];
  let dbError: string | null = null;

  try {
    [
      payments,
      usageRecent,
      usageHistory,
      usageSummary,
      paymentCounts,
      stuckPayments,
      pendingReconciliations,
    ] = await Promise.all([
      listRecentPayments(limit),
      listRecentUsage(limit),
      listUsageHistory(days),
      getUsageSummary(days),
      paymentStatusCounts(days),
      listStuckPayments(15, 20),
      listPendingReconciliations(20),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database query failed";
  }

  const mcpEvents = listRecentMcpToolEvents(limit);

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
    pendingReconciliations,
    usageSummary,
    usageHistory,
    mcpEvents,
    recentPayments: payments,
    recentUsage: usageRecent,
    providerBalances: balanceStatuses,
  });

  if (dbError) {
    irregularities.unshift({
      id: "config.db_unreachable",
      severity: "critical",
      category: "config",
      title: "Ops database unreachable",
      detail: dbError,
      action:
        "Check DATABASE_URL / Neon project status and local network; payments and usage panels may be empty until reconnect.",
    });
  }

  return irregularities;
}
