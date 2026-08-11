/** How upstream provider credits can be observed for ops. */
export type ProviderBalanceObservability =
  | {
      mode: "api";
      /** USD-equivalent balance (or per-key allowance when labeled). */
      balanceUsd: number;
      /** e.g. "remaining sub-key allowance" vs "account balance". */
      balanceKind: string;
      checkUrl: string;
    }
  | {
      mode: "not_api_observable";
      /** Shown in ops UI — no scraping, dashboard only. */
      reason: string;
    }
  | {
      mode: "error";
      error: string;
      checkUrl?: string;
    };

export type ProviderBalanceStatus = {
  observability: ProviderBalanceObservability;
  thresholdUsd: number;
  /** True when balanceUsd < thresholdUsd (api mode only). */
  belowThreshold: boolean;
  lastCheck: number | null;
  latencyMs: number | null;
};

export type ProviderBalanceStatusMap = Record<string, ProviderBalanceStatus>;

export interface ProviderBalanceStore {
  get(name: string): ProviderBalanceStatus | undefined;
  getAll(): ProviderBalanceStatusMap;
  set(name: string, status: ProviderBalanceStatus): void;
}

export interface ProviderBalancePoller {
  readonly provider: string;
  readonly thresholdUsd: number;
  poll(): Promise<ProviderBalanceStatus>;
}
