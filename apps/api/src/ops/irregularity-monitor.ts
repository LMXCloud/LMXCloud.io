import { notifyCriticalIrregularities } from "../notify/irregularities.js";
import { isTelegramEnabled } from "../notify/telegram.js";
import {
  collectIrregularities,
  type CollectIrregularitiesDeps,
} from "./collect-irregularities.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

function getPollIntervalMs(): number {
  const raw = process.env.OPS_IRREGULARITY_POLL_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_POLL_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 15_000 ? n : DEFAULT_POLL_INTERVAL_MS;
}

export class IrregularityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(private readonly deps: CollectIrregularitiesDeps) {}

  start(): void {
    if (!isTelegramEnabled()) return;

    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, getPollIntervalMs());
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
      const irregularities = await collectIrregularities(this.deps);
      notifyCriticalIrregularities(irregularities);
    } catch (err) {
      console.warn(
        "[ops] irregularity monitor poll failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.inFlight = false;
    }
  }
}
