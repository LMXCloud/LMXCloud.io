import type { ChatCompletionRequest } from "@lmxcloud/shared";
import {
  AllProvidersDownError,
  ProviderError,
  type ProviderAdapter,
} from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import type { RoutingPreference } from "./strategies.js";

export interface RoutedResult {
  response: Awaited<ReturnType<ProviderAdapter["chatCompletion"]>>["response"];
  latencyMs: number;
  provider: string;
  fallbackUsed: boolean;
}

export class InferenceRouter {
  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly healthStore: HealthStore,
  ) {}

  async route(
    request: ChatCompletionRequest,
    preference: RoutingPreference,
  ): Promise<RoutedResult> {
    const order = this.resolveProviderOrder(preference);
    const depinOnly = preference.strategy === "depin-only";

    if (order.length === 0) {
      throw new AllProvidersDownError(depinOnly);
    }

    let lastError: ProviderError | undefined;

    for (let index = 0; index < order.length; index++) {
      const provider = order[index]!;

      try {
        const result = await provider.chatCompletion(request);
        return {
          response: result.response,
          latencyMs: result.latencyMs,
          provider: provider.name,
          fallbackUsed: index > 0,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    if (depinOnly) {
      throw new AllProvidersDownError(true);
    }

    throw (
      lastError ??
      new AllProvidersDownError(false)
    );
  }

  private resolveProviderOrder(preference: RoutingPreference): ProviderAdapter[] {
    let candidates = [...this.providers];

    if (preference.strategy === "depin-only") {
      candidates = candidates.filter((provider) => provider.isDepin);
    }

    if (preference.preferredProvider) {
      const preferred = candidates.find(
        (provider) => provider.name === preference.preferredProvider,
      );
      if (preferred) {
        candidates = [
          preferred,
          ...candidates.filter((provider) => provider.name !== preferred.name),
        ];
      }
    } else if (preference.strategy === "cheapest") {
      candidates = this.sortByCost(candidates);
    } else if (preference.strategy === "fastest") {
      candidates = this.sortByLatency(candidates);
    }

    return this.prioritizeHealthy(candidates);
  }

  private sortByCost(providers: ProviderAdapter[]): ProviderAdapter[] {
    return [...providers].sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
  }

  private sortByLatency(providers: ProviderAdapter[]): ProviderAdapter[] {
    return [...providers].sort((a, b) => {
      const aLatency = this.healthStore.get(a.name)?.latencyMs ?? Number.MAX_SAFE_INTEGER;
      const bLatency = this.healthStore.get(b.name)?.latencyMs ?? Number.MAX_SAFE_INTEGER;
      return aLatency - bLatency;
    });
  }

  private prioritizeHealthy(providers: ProviderAdapter[]): ProviderAdapter[] {
    const healthy: ProviderAdapter[] = [];
    const unhealthy: ProviderAdapter[] = [];

    for (const provider of providers) {
      const status = this.healthStore.get(provider.name);
      if (status?.healthy) {
        healthy.push(provider);
      } else {
        unhealthy.push(provider);
      }
    }

    return [...healthy, ...unhealthy];
  }
}
