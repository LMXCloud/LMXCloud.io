import type { ProviderAdapter } from "../providers/types.js";
import type { ProviderHealthHistoryStore } from "./history.js";
import type { HealthStore } from "./store.js";

/** Prune at most once per this interval so poll stays cheap. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPruneAt = 0;

  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly store: HealthStore,
    private readonly intervalMs: number,
    private readonly historyStore: ProviderHealthHistoryStore | null = null,
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
    await Promise.all(
      this.providers.map(async (provider) => {
        const result = await provider.healthCheck();
        const checkedAt = Date.now();
        this.store.set(provider.name, {
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          lastCheck: checkedAt,
        });
        // Persist off the hot path — in-memory update above is what routing reads.
        this.historyStore?.record({
          provider: provider.name,
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          checkedAt: new Date(checkedAt),
        });
      }),
    );

    this.maybePrune();
  }

  private maybePrune(): void {
    if (!this.historyStore) return;
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    // Retention is best-effort; never block or fail the poll loop.
    void this.historyStore.prune().catch(() => {});
  }
}
