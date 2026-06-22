import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "./store.js";

export class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly store: HealthStore,
    private readonly intervalMs: number,
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
        this.store.set(provider.name, {
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          lastCheck: Date.now(),
        });
      }),
    );
  }
}
