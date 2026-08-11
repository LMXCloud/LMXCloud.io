import { notifyProviderBalanceLow } from "../../notify/events.js";
import type { ProviderBalancePoller, ProviderBalanceStore } from "./types.js";

export class ProviderBalanceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  /** Last below-threshold state we Telegram-notified (undefined = not yet observed). */
  private readonly lastNotifiedBelowThreshold = new Map<string, boolean>();

  constructor(
    private readonly pollers: ProviderBalancePoller[],
    private readonly store: ProviderBalanceStore,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    void this.pollAll();
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollAll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await Promise.all(
        this.pollers.map(async (poller) => {
          const status = await poller.poll();
          this.store.set(poller.provider, status);
          this.maybeNotifyLowBalance(poller.provider, status);
        }),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Telegram when an API-observable balance crosses below threshold.
   * Skips not_api_observable providers and dedupes steady-state low balance.
   */
  private maybeNotifyLowBalance(
    provider: string,
    status: Awaited<ReturnType<ProviderBalancePoller["poll"]>>,
  ): void {
    if (status.observability.mode !== "api") return;

    const below = status.belowThreshold;
    const prev = this.lastNotifiedBelowThreshold.get(provider);

    if (prev === below) return;

    if (prev === undefined && !below) {
      this.lastNotifiedBelowThreshold.set(provider, false);
      return;
    }

    this.lastNotifiedBelowThreshold.set(provider, below);

    if (!below) return;

    notifyProviderBalanceLow({
      provider,
      balanceUsd: status.observability.balanceUsd,
      thresholdUsd: status.thresholdUsd,
      balanceKind: status.observability.balanceKind,
    });
  }
}
