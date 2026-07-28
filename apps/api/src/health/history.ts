import { getPool } from "../db/pool.js";

/** Poll-persisted signal types. real_traffic is merged from usage_events at query time. */
export type HealthCheckType = "gateway" | "synthetic_completion";

export interface ProviderHealthCheckRecord {
  provider: string;
  checkType: HealthCheckType;
  healthy: boolean;
  latencyMs: number | null;
  checkedAt?: Date;
  /** Failure reason for unhealthy rows (timeout / http_NNN / network). */
  errorDetail?: string;
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
          `INSERT INTO provider_health_checks
             (provider, check_type, healthy, latency_ms, checked_at, error_detail)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            check.provider,
            check.checkType,
            check.healthy,
            check.latencyMs,
            checkedAt,
            check.errorDetail ?? null,
          ],
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
