export interface ProviderStatus {
  /** Probe 2xx — used for routing. Invalid keys / empty wallets stay false. */
  healthy: boolean;
  /**
   * Provider answered. Operator faults (invalid API key, insufficient funds)
   * count as reachable so status/uptime is about the vendor, not our account.
   */
  reachable?: boolean;
  latencyMs: number | null;
  lastCheck: number;
  statusCode?: number;
  errorDetail?: string;
  checkUrl?: string;
}

/** Public status / ops "up" chip — not the routing-usable flag. */
export function providerUpForStatus(status: ProviderStatus | undefined): boolean {
  if (!status) return false;
  return status.reachable ?? status.healthy;
}

export type ProviderStatusMap = Record<string, ProviderStatus>;

export interface HealthStore {
  get(name: string): ProviderStatus | undefined;
  getAll(): ProviderStatusMap;
  set(name: string, status: ProviderStatus): void;
}

export class InMemoryHealthStore implements HealthStore {
  private statuses: ProviderStatusMap = {};

  get(name: string): ProviderStatus | undefined {
    return this.statuses[name];
  }

  getAll(): ProviderStatusMap {
    return { ...this.statuses };
  }

  set(name: string, status: ProviderStatus): void {
    this.statuses[name] = status;
  }
}
