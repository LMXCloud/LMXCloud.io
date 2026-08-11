import type { ProviderBalancePoller, ProviderBalanceStatus } from "./types.js";

const NOT_OBSERVABLE_LABEL =
  "not API-observable — check dashboard manually";

/** Providers with no documented account-balance REST API (dashboard only). */
export function createStaticNotObservablePoller(input: {
  provider: string;
  thresholdUsd: number;
  reason?: string;
}): ProviderBalancePoller {
  const reason = input.reason ?? NOT_OBSERVABLE_LABEL;

  return {
    provider: input.provider,
    thresholdUsd: input.thresholdUsd,
    async poll(): Promise<ProviderBalanceStatus> {
      return {
        observability: {
          mode: "not_api_observable",
          reason,
        },
        thresholdUsd: input.thresholdUsd,
        belowThreshold: false,
        lastCheck: Date.now(),
        latencyMs: null,
      };
    },
  };
}
