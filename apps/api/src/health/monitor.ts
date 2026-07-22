import { notifyProviderHealthChange } from "../notify/events.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { ProviderHealthHistoryStore } from "./history.js";
import type { HealthStore } from "./store.js";

/** Prune at most once per this interval so poll stays cheap. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Tiny fixed probe — exercises the same chatCompletion path as real traffic. */
const SYNTHETIC_PROMPT = "ping";
const SYNTHETIC_MAX_TOKENS = 1;

export class HealthMonitor {
  private gatewayTimer: ReturnType<typeof setInterval> | null = null;
  private syntheticTimer: ReturnType<typeof setInterval> | null = null;
  private lastPruneAt = 0;
  private syntheticInFlight = false;
  /** Last healthy state we Telegram-notified (undefined = not yet observed). */
  private readonly lastNotifiedHealthy = new Map<string, boolean>();

  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly store: HealthStore,
    private readonly gatewayIntervalMs: number,
    private readonly historyStore: ProviderHealthHistoryStore | null = null,
    private readonly syntheticIntervalMs: number | null = null,
  ) {}

  start(): void {
    void this.pollGateway();
    this.gatewayTimer = setInterval(() => {
      void this.pollGateway();
    }, this.gatewayIntervalMs);

    if (this.syntheticIntervalMs != null && this.syntheticIntervalMs > 0) {
      void this.pollSynthetic();
      this.syntheticTimer = setInterval(() => {
        void this.pollSynthetic();
      }, this.syntheticIntervalMs);
    }
  }

  stop(): void {
    if (this.gatewayTimer) {
      clearInterval(this.gatewayTimer);
      this.gatewayTimer = null;
    }
    if (this.syntheticTimer) {
      clearInterval(this.syntheticTimer);
      this.syntheticTimer = null;
    }
  }

  /** Cheap /models reachability — also drives the in-memory routing health store. */
  private async pollGateway(): Promise<void> {
    await Promise.all(
      this.providers.map(async (provider) => {
        const result = await provider.healthCheck();
        const checkedAt = Date.now();
        this.store.set(provider.name, {
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          lastCheck: checkedAt,
          statusCode: result.statusCode,
          errorDetail: result.errorDetail,
          checkUrl: result.checkUrl,
        });
        this.historyStore?.record({
          provider: provider.name,
          checkType: "gateway",
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          checkedAt: new Date(checkedAt),
        });
        return { provider: provider.name, result };
      }),
    ).then((rows) => {
      for (const { provider, result } of rows) {
        this.maybeNotifyHealthChange(provider, result.healthy, result.latencyMs);
      }
    });

    this.maybePrune();
  }

  /**
   * Telegram on gateway health transitions only (not every failed poll).
   * Skips the initial "healthy" observation on cold start to avoid noise.
   */
  private maybeNotifyHealthChange(
    provider: string,
    healthy: boolean,
    latencyMs: number | null,
  ): void {
    const prev = this.lastNotifiedHealthy.get(provider);
    if (prev === healthy) return;

    if (prev === undefined && healthy) {
      this.lastNotifiedHealthy.set(provider, true);
      return;
    }

    this.lastNotifiedHealthy.set(provider, healthy);

    const statuses = this.store.getAll();
    const healthyCount = Object.values(statuses).filter((s) => s.healthy).length;

    notifyProviderHealthChange({
      provider,
      healthy,
      latencyMs,
      healthyCount,
      providerCount: this.providers.length,
    });
  }

  /**
   * Real minimal chatCompletion through the adapter path (not a bespoke fetch).
   * Does not update InMemoryHealthStore — routing stays on the cheap gateway signal.
   */
  private async pollSynthetic(): Promise<void> {
    if (this.syntheticInFlight) return;
    this.syntheticInFlight = true;
    try {
      await Promise.all(
        this.providers.map(async (provider) => {
          const model = provider.aliases[0];
          const started = Date.now();
          if (!model) {
            this.historyStore?.record({
              provider: provider.name,
              checkType: "synthetic_completion",
              healthy: false,
              latencyMs: null,
              checkedAt: new Date(started),
            });
            return;
          }

          try {
            const result = await provider.chatCompletion({
              model,
              messages: [{ role: "user", content: SYNTHETIC_PROMPT }],
              max_tokens: SYNTHETIC_MAX_TOKENS,
              temperature: 0,
            });
            this.historyStore?.record({
              provider: provider.name,
              checkType: "synthetic_completion",
              healthy: true,
              latencyMs: result.latencyMs,
              checkedAt: new Date(),
            });
          } catch {
            this.historyStore?.record({
              provider: provider.name,
              checkType: "synthetic_completion",
              healthy: false,
              latencyMs: Math.round(Date.now() - started),
              checkedAt: new Date(),
            });
          }
        }),
      );
    } finally {
      this.syntheticInFlight = false;
    }
  }

  private maybePrune(): void {
    if (!this.historyStore) return;
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    void this.historyStore.prune().catch(() => {});
  }
}
