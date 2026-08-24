import type { ProviderBalanceStatusMap } from "../providers/balance/types.js";
import {
  envConfigured,
  INFRA_SERVICES,
  MANUAL_REASON,
  type InfraServiceDef,
} from "./infra-spend-catalog.js";
import {
  pullLiveSpend,
  type LivePullResult,
  type LiveSpendPoint,
} from "./infra-spend-live.js";
import { hasPostgres } from "./queries.js";
import { buildSpendSeries, type InfraSpendMonth } from "./infra-spend.js";
import {
  listInfraSpendEntries,
  type InfraSpendEntry,
} from "./infra-spend-store.js";

export type InfraObservability =
  | {
      mode: "api";
      metric: "spend" | "balance";
      amountUsd: number;
      amountKind: string;
      checkUrl: string;
      asOf: string;
    }
  | {
      mode: "not_api_observable";
      reason: string;
    }
  | {
      mode: "error";
      error: string;
      checkUrl?: string;
    };

export type InfraServiceSnapshot = {
  id: string;
  name: string;
  category: InfraServiceDef["category"];
  purpose: string;
  consoleUrl: string;
  configured: boolean;
  inDocumentedStack: boolean;
  observability: InfraObservability;
  latestManual: InfraSpendEntry | null;
  needsFunding: boolean;
};

export type InfraSpendSnapshot = {
  object: "ops_infra_spend";
  generatedAt: string;
  storage: "postgres" | "unavailable";
  months: number;
  monthToDateUsd: number;
  monthToDate: { liveUsd: number; manualUsd: number };
  series: InfraSpendMonth[];
  services: InfraServiceSnapshot[];
  entries: InfraSpendEntry[];
};

function latestForService(
  entries: InfraSpendEntry[],
  service: string,
): InfraSpendEntry | null {
  return entries.find((e) => e.service === service) ?? null;
}

function liveResultToObservability(result: LivePullResult | undefined): InfraObservability | null {
  if (!result) return null;
  if (result.status === "skipped") {
    return { mode: "not_api_observable", reason: result.reason };
  }
  if (result.status === "error") {
    return { mode: "error", error: result.error, checkUrl: result.checkUrl };
  }
  const point = result.points[0];
  if (!point) {
    return { mode: "not_api_observable", reason: "Live pull returned no points." };
  }
  return {
    mode: "api",
    metric: "spend",
    amountUsd: point.amountUsd,
    amountKind: point.amountKind,
    checkUrl: point.checkUrl,
    asOf: point.asOf,
  };
}

function providerBalanceObservability(
  def: InfraServiceDef,
  balances: ProviderBalanceStatusMap,
): InfraObservability | null {
  if (def.spendSource !== "provider_balance") return null;
  const status = balances[def.id];
  if (!status) return null;
  const obs = status.observability;
  if (obs.mode === "api") {
    return {
      mode: "api",
      metric: "balance",
      amountUsd: obs.balanceUsd,
      amountKind: obs.balanceKind,
      checkUrl: obs.checkUrl,
      asOf: status.lastCheck ? new Date(status.lastCheck).toISOString() : new Date().toISOString(),
    };
  }
  if (obs.mode === "error") {
    return { mode: "error", error: obs.error, checkUrl: obs.checkUrl };
  }
  return { mode: "not_api_observable", reason: obs.reason };
}

function serviceObservability(
  def: InfraServiceDef,
  liveByService: Record<string, LivePullResult>,
  balances: ProviderBalanceStatusMap,
): InfraObservability {
  const fromLive = liveResultToObservability(liveByService[def.id]);
  if (fromLive && fromLive.mode === "api") return fromLive;

  const fromBalance = providerBalanceObservability(def, balances);
  if (fromBalance && fromBalance.mode === "api") return fromBalance;
  if (fromBalance && fromBalance.mode === "error") return fromBalance;

  if (fromLive && fromLive.mode === "error") return fromLive;
  if (fromLive && fromLive.mode === "not_api_observable") return fromLive;
  if (fromBalance && fromBalance.mode === "not_api_observable") return fromBalance;

  return {
    mode: "not_api_observable",
    reason: MANUAL_REASON[def.id] ?? "No public spend API — log invoices here.",
  };
}

/** Live API remaining-credit only. Manual $0 / "needs funding" notes are historical logs. */
export function computeNeedsFunding(observability: InfraObservability): boolean {
  return (
    observability.mode === "api" &&
    observability.metric === "balance" &&
    observability.amountUsd <= 0
  );
}

export async function assembleInfraSpend(input: {
  months: number;
  balances: ProviderBalanceStatusMap;
  now?: Date;
}): Promise<InfraSpendSnapshot> {
  const now = input.now ?? new Date();
  const storage = hasPostgres() ? "postgres" : "unavailable";

  let entries: InfraSpendEntry[] = [];
  if (hasPostgres()) {
    try {
      entries = await listInfraSpendEntries();
    } catch {
      entries = [];
    }
  }

  let livePoints: LiveSpendPoint[] = [];
  let liveByService: Record<string, LivePullResult> = {};
  try {
    const live = await pullLiveSpend();
    livePoints = live.points;
    liveByService = live.byService;
  } catch {
    liveByService = {};
  }

  const series = buildSpendSeries(entries, livePoints, input.months, now);
  const current = series[series.length - 1] ?? {
    date: "",
    amount: 0,
    liveUsd: 0,
    manualUsd: 0,
  };

  const services: InfraServiceSnapshot[] = INFRA_SERVICES.map((def) => {
    const latestManual = latestForService(entries, def.id);
    const observability = serviceObservability(def, liveByService, input.balances);
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      purpose: def.purpose,
      consoleUrl: def.consoleUrl,
      configured: envConfigured(def),
      inDocumentedStack: Boolean(def.inDocumentedStack),
      observability,
      latestManual,
      needsFunding: computeNeedsFunding(observability),
    };
  });

  return {
    object: "ops_infra_spend",
    generatedAt: now.toISOString(),
    storage,
    months: input.months,
    monthToDateUsd: current.amount,
    monthToDate: { liveUsd: current.liveUsd, manualUsd: current.manualUsd },
    series,
    services,
    entries,
  };
}
