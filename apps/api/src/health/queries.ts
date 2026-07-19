import { getPool } from "../db/pool.js";

function hasPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export interface ProviderHealthHistoryRow {
  provider: string;
  checks: number;
  healthyChecks: number;
  uptime: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
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

/**
 * Aggregated uptime / latency from provider_health_checks over a day window.
 * Independent of customer usage events — reflects health poll results only.
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

  const result = await getPool().query<{
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
       COUNT(*) FILTER (WHERE healthy)::text AS healthy_checks,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       ROUND(
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)
       )::text AS p50_latency_ms,
       ROUND(
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
       )::text AS p95_latency_ms
     FROM provider_health_checks
     WHERE checked_at >= NOW() - ($1::int || ' days')::interval
     GROUP BY provider
     ORDER BY provider`,
    [windowDays],
  );

  return {
    object: "provider_health_history",
    windowDays,
    byProvider: result.rows.map((row) => {
      const checks = Number(row.checks);
      const healthyChecks = Number(row.healthy_checks);
      return {
        provider: row.provider,
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
    }),
  };
}
