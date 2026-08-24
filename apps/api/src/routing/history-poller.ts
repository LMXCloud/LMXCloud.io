import { getPool } from "../db/pool.js";
import type { ProviderHistoryRates } from "./score.js";
import type { RoutingSignalStore } from "./signal-store.js";

function hasPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export const ROUTING_HISTORY_WINDOW_HOURS = 6;
export const ROUTING_HISTORY_POLL_INTERVAL_MS = 60_000;

export type RoutingHistoryRow = { provider: string } & ProviderHistoryRates;

/**
 * Short-window aggregates for weighted routing (not the public 7/30d history API).
 */
export async function fetchRoutingHistoryRates(
  windowHours = ROUTING_HISTORY_WINDOW_HOURS,
): Promise<RoutingHistoryRow[]> {
  if (!hasPostgres()) return [];

  const hours = Math.max(1, Math.min(Math.floor(windowHours), 48));

  const [realResult, synthResult] = await Promise.all([
    getPool().query<{
      provider: string;
      attempts: string;
      successes: string;
    }>(
      `SELECT
         provider,
         COUNT(*)::text AS attempts,
         COUNT(*) FILTER (WHERE success)::text AS successes
       FROM usage_events
       WHERE created_at >= NOW() - ($1::int || ' hours')::interval
         AND resource_type = 'chat'
       GROUP BY provider`,
      [hours],
    ),
    getPool().query<{
      provider: string;
      attempts: string;
      successes: string;
    }>(
      `SELECT
         provider,
         COUNT(*)::text AS attempts,
         COUNT(*) FILTER (WHERE healthy)::text AS successes
       FROM provider_health_checks
       WHERE checked_at >= NOW() - ($1::int || ' hours')::interval
         AND check_type = 'synthetic_completion'
       GROUP BY provider`,
      [hours],
    ),
  ]);

  const byProvider = new Map<string, RoutingHistoryRow>();

  function ensure(provider: string): RoutingHistoryRow {
    let row = byProvider.get(provider);
    if (!row) {
      row = {
        provider,
        realAttempts: 0,
        realSuccesses: 0,
        syntheticAttempts: 0,
        syntheticSuccesses: 0,
      };
      byProvider.set(provider, row);
    }
    return row;
  }

  for (const row of realResult.rows) {
    const target = ensure(row.provider);
    target.realAttempts = Number(row.attempts);
    target.realSuccesses = Number(row.successes);
  }

  for (const row of synthResult.rows) {
    const target = ensure(row.provider);
    target.syntheticAttempts = Number(row.attempts);
    target.syntheticSuccesses = Number(row.successes);
  }

  return [...byProvider.values()];
}

/**
 * Periodically refreshes RoutingSignalStore historical rates from Postgres.
 */
export class RoutingHistoryPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly signalStore: RoutingSignalStore,
    private readonly intervalMs = ROUTING_HISTORY_POLL_INTERVAL_MS,
    private readonly windowHours = ROUTING_HISTORY_WINDOW_HOURS,
    private readonly onError?: (err: unknown) => void,
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const rows = await fetchRoutingHistoryRates(this.windowHours);
      this.signalStore.applyHistory(rows);
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.inFlight = false;
    }
  }
}
