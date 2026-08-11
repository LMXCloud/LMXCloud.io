import type {
  ProviderBalanceStatus,
  ProviderBalanceStatusMap,
  ProviderBalanceStore,
} from "./types.js";

export class InMemoryProviderBalanceStore implements ProviderBalanceStore {
  private statuses: ProviderBalanceStatusMap = {};

  get(name: string): ProviderBalanceStatus | undefined {
    return this.statuses[name];
  }

  getAll(): ProviderBalanceStatusMap {
    return { ...this.statuses };
  }

  set(name: string, status: ProviderBalanceStatus): void {
    this.statuses[name] = status;
  }
}
