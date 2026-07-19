import { getPool } from "../db/pool.js";

export interface ProviderHealthCheckRecord {
  provider: string;
  healthy: boolean;
  latencyMs: number | null;
  checkedAt?: Date;
}

/** Keep raw poll rows this long; older rows are pruned opportunistically. */
export const HEALTH_HISTORY_RETENTION_DAYS = 365;

/**
 * Persisted provider health poll history.
 * Writes must never block the in-memory health / routing hot path.
 */
export interface ProviderHealthHistoryStore {
  /** Fire-and-forget insert; errors are swallowed via onError. */
  record(check: ProviderHealthCheckRecord): void;
  /** Delete rows older than retention; safe to call infrequently. */
  prune(retentionDays?: number): Promise<number>;
}

export function createProviderHealthHistoryStore(
  onError?: (err: unknown) => void,
): ProviderHealthHistoryStore | null {
  if (!process.env.DATABASE_URL) return null;

  return {
    record(check) {
      const checkedAt = check.checkedAt ?? new Date();
      void getPool()
        .query(
          `INSERT INTO provider_health_checks (provider, healthy, latency_ms, checked_at)
           VALUES ($1, $2, $3, $4)`,
          [check.provider, check.healthy, check.latencyMs, checkedAt],
        )
        .catch((err) => {
          onError?.(err);
        });
    },

    async prune(retentionDays = HEALTH_HISTORY_RETENTION_DAYS) {
      const days = Math.max(1, Math.min(Math.floor(retentionDays), 365));
      const result = await getPool().query(
        `DELETE FROM provider_health_checks
         WHERE checked_at < NOW() - ($1::int || ' days')::interval`,
        [days],
      );
      return result.rowCount ?? 0;
    },
  };
}
