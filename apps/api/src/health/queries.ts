import { getPool } from "../db/pool.js";
import type { HealthCheckType } from "./history.js";

function hasPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export type HealthSignalKind =
  | "gateway"
  | "synthetic_completion"
  | "real_traffic";

export interface ProviderHealthSignalStats {
  checks: number;
  healthyChecks: number;
  uptime: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface ProviderHealthHistoryRow {
  provider: string;
  gateway: ProviderHealthSignalStats;
  syntheticCompletion: ProviderHealthSignalStats;
  realTraffic: ProviderHealthSignalStats;
}

export interface ProviderHealthHistoryTelemetry {
  object: "provider_health_history";
  windowDays: number;
  byProvider: ProviderHealthHistoryRow[];
}

function rate(successes: number, attempts: number): number {
  if (attempts === 0) return 0;
  return Math.round((successes / attempts) * 10_000) / 10_000;
}

function emptySignal(): ProviderHealthSignalStats {
  return {
    checks: 0,
    healthyChecks: 0,
    uptime: 0,
    avgLatencyMs: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
  };
}

function mapAggRow(row: {
  checks: string;
  healthy_checks: string;
  avg_latency_ms: string | null;
  p50_latency_ms: string | null;
  p95_latency_ms: string | null;
}): ProviderHealthSignalStats {
  const checks = Number(row.checks);
  const healthyChecks = Number(row.healthy_checks);
  return {
    checks,
    healthyChecks,
    uptime: rate(healthyChecks, checks),
    avgLatencyMs:
      row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
    p50LatencyMs:
      row.p50_latency_ms === null ? null : Number(row.p50_latency_ms),
    p95LatencyMs:
      row.p95_latency_ms === null ? null : Number(row.p95_latency_ms),
  };
}

const SIGNAL_AGG_SQL = `
  COUNT(*)::text AS checks,
  COUNT(*) FILTER (WHERE healthy)::text AS healthy_checks,
  ROUND(AVG(latency_ms))::text AS avg_latency_ms,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)
  )::text AS p50_latency_ms,
  ROUND(
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
  )::text AS p95_latency_ms
`;

/** Latest persisted failure detail per provider for a poll signal type. */
export async function getLatestHealthCheckErrors(
  checkType: HealthCheckType,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!hasPostgres()) return out;

  const result = await getPool().query<{
    provider: string;
    error_detail: string;
  }>(
    `SELECT DISTINCT ON (provider)
       provider,
       error_detail
     FROM provider_health_checks
     WHERE check_type = $1
       AND healthy = false
       AND error_detail IS NOT NULL
     ORDER BY provider, checked_at DESC`,
    [checkType],
  );

  for (const row of result.rows) {
    out.set(row.provider, row.error_detail);
  }
  return out;
}

/**
 * Three-tier reliability for a day window:
 * - gateway / synthetic_completion from provider_health_checks
 * - real_traffic from usage_events (not duplicated into the health table)
 */
export async function getProviderHealthHistory(
  days = 30,
): Promise<ProviderHealthHistoryTelemetry> {
  const windowDays = Math.max(1, Math.min(Math.floor(days), 90));
  const empty: ProviderHealthHistoryTelemetry = {
    object: "provider_health_history",
    windowDays,
    byProvider: [],
  };

  if (!hasPostgres()) return empty;

  const pollResult = await getPool().query<{
    provider: string;
    check_type: string;
    checks: string;
    healthy_checks: string;
    avg_latency_ms: string | null;
    p50_latency_ms: string | null;
    p95_latency_ms: string | null;
  }>(
    `SELECT
       provider,
       check_type,
       ${SIGNAL_AGG_SQL}
     FROM provider_health_checks
     WHERE checked_at >= NOW() - ($1::int || ' days')::interval
       AND check_type IN ('gateway', 'synthetic_completion')
     GROUP BY provider, check_type
     ORDER BY provider, check_type`,
    [windowDays],
  );

  // Real customer outcomes — highest-quality signal; do not re-insert into health table.
  const trafficResult = await getPool().query<{
    provider: string;
    checks: string;
    healthy_checks: string;
    avg_latency_ms: string | null;
    p50_latency_ms: string | null;
    p95_latency_ms: string | null;
  }>(
    `SELECT
       provider,
       COUNT(*)::text AS checks,
       COUNT(*) FILTER (WHERE success)::text AS healthy_checks,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       ROUND(
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)
       )::text AS p50_latency_ms,
       ROUND(
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
       )::text AS p95_latency_ms
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       AND resource_type = 'chat'
     GROUP BY provider
     ORDER BY provider`,
    [windowDays],
  );

  const byProvider = new Map<string, ProviderHealthHistoryRow>();

  function ensure(provider: string): ProviderHealthHistoryRow {
    let row = byProvider.get(provider);
    if (!row) {
      row = {
        provider,
        gateway: emptySignal(),
        syntheticCompletion: emptySignal(),
        realTraffic: emptySignal(),
      };
      byProvider.set(provider, row);
    }
    return row;
  }

  for (const row of pollResult.rows) {
    const target = ensure(row.provider);
    const stats = mapAggRow(row);
    if (row.check_type === "gateway") {
      target.gateway = stats;
    } else if (row.check_type === "synthetic_completion") {
      target.syntheticCompletion = stats;
    }
  }

  for (const row of trafficResult.rows) {
    ensure(row.provider).realTraffic = mapAggRow(row);
  }

  return {
    object: "provider_health_history",
    windowDays,
    byProvider: [...byProvider.values()].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ),
  };
}
