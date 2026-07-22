export interface ProviderStatus {
  healthy: boolean;
  latencyMs: number | null;
  lastCheck: number;
  statusCode?: number;
  errorDetail?: string;
  checkUrl?: string;
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
