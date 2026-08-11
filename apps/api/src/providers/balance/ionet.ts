import type { ProviderBalancePoller, ProviderBalanceStatus } from "./types.js";

const IONET_USAGE_URL =
  "https://api.intelligence.io.solutions/v1/api-keys/sub-keys/me/usage";

const NOT_OBSERVABLE_LABEL =
  "not API-observable — check dashboard manually";

type IonetUsageResponse = {
  status?: string;
  data?: {
    credit_used?: number;
    credit_limit?: number | null;
    remaining_credit?: number | null;
    credit_refresh_cycle?: string;
  };
};

export function createIonetBalancePoller(input: {
  apiKey: string;
  thresholdUsd: number;
}): ProviderBalancePoller {
  const provider = "ionet";

  return {
    provider,
    thresholdUsd: input.thresholdUsd,
    async poll(): Promise<ProviderBalanceStatus> {
      const started = performance.now();
      const lastCheck = Date.now();

      try {
        const response = await fetch(IONET_USAGE_URL, {
          headers: { "x-api-key": input.apiKey },
          signal: AbortSignal.timeout(15_000),
        });

        const latencyMs = Math.round(performance.now() - started);

        if (response.status === 403) {
          return {
            observability: {
              mode: "not_api_observable",
              reason: NOT_OBSERVABLE_LABEL,
            },
            thresholdUsd: input.thresholdUsd,
            belowThreshold: false,
            lastCheck,
            latencyMs,
          };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          return {
            observability: {
              mode: "error",
              error: `HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
              checkUrl: IONET_USAGE_URL,
            },
            thresholdUsd: input.thresholdUsd,
            belowThreshold: false,
            lastCheck,
            latencyMs,
          };
        }

        const json = (await response.json()) as IonetUsageResponse;
        const remaining = json.data?.remaining_credit;

        if (remaining == null || !Number.isFinite(remaining)) {
          return {
            observability: {
              mode: "not_api_observable",
              reason: NOT_OBSERVABLE_LABEL,
            },
            thresholdUsd: input.thresholdUsd,
            belowThreshold: false,
            lastCheck,
            latencyMs,
          };
        }

        const balanceUsd = remaining;
        return {
          observability: {
            mode: "api",
            balanceUsd,
            balanceKind: "remaining sub-key allowance (not account balance)",
            checkUrl: IONET_USAGE_URL,
          },
          thresholdUsd: input.thresholdUsd,
          belowThreshold: balanceUsd < input.thresholdUsd,
          lastCheck,
          latencyMs,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          observability: {
            mode: "error",
            error: message.slice(0, 200),
            checkUrl: IONET_USAGE_URL,
          },
          thresholdUsd: input.thresholdUsd,
          belowThreshold: false,
          lastCheck,
          latencyMs: Math.round(performance.now() - started),
        };
      }
    },
  };
}
