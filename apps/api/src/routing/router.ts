import type { ChatCompletionRequest } from "@lmxcloud/shared";
import {
  AllProvidersDownError,
  ModelNotSupportedError,
  ProviderError,
  type ProviderAdapter,
} from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import { RESOURCE_TYPE_CHAT } from "../telemetry/types.js";
import type { UsageStore } from "../usage/store.js";
import type { RoutingPreference } from "./strategies.js";

/**
 * Optional billing attribution attached to failure telemetry rows.
 * Success rows are recorded by the route after final cost/tokens are known.
 */
export interface RouteTelemetryContext {
  /** Defaults to "chat". Pass a different label for embeddings/image/etc. */
  resourceType?: string;
  apiKeyId?: string;
  payerWallet?: string;
  paymentEventId?: string;
}

export interface RoutedResult {
  response: Awaited<ReturnType<ProviderAdapter["chatCompletion"]>>["response"];
  latencyMs: number;
  provider: string;
  fallbackUsed: boolean;
  costPer1kTokens: number;
  usage: Awaited<ReturnType<ProviderAdapter["chatCompletion"]>>["usage"];
  stream?: Awaited<ReturnType<ProviderAdapter["chatCompletion"]>>["stream"];
}

/**
 * Records every provider attempt that fails while routing.
 * Successful attempts are left to the caller so final billed cost/tokens can be attached.
 * Any new ProviderAdapter is covered automatically — no per-provider wiring.
 */
export class InferenceRouter {
  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly healthStore: HealthStore,
    private readonly usageStore?: UsageStore,
  ) {}

  async route(
    request: ChatCompletionRequest,
    preference: RoutingPreference,
    telemetry?: RouteTelemetryContext,
  ): Promise<RoutedResult> {
    const order = this.resolveProviderOrder(preference);
    const depinOnly = preference.strategy === "depin-only";
    const resourceType = telemetry?.resourceType ?? RESOURCE_TYPE_CHAT;

    if (order.length === 0) {
      throw new AllProvidersDownError(depinOnly);
    }

    const capable = order.filter((provider) => provider.supportsModel(request.model));

    if (capable.length === 0) {
      throw new ModelNotSupportedError(request.model);
    }

    let lastError: ProviderError | undefined;

    for (let index = 0; index < capable.length; index++) {
      const provider = capable[index]!;
      const started = performance.now();

      try {
        const result = await provider.chatCompletion(request);
        return {
          response: result.response,
          latencyMs: result.latencyMs,
          provider: provider.name,
          fallbackUsed: index > 0,
          costPer1kTokens: provider.costPer1kTokens,
          usage: result.usage,
          stream: result.stream,
        };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - started);
        if (err instanceof ProviderError) {
          lastError = err;
          await this.recordFailure({
            telemetry,
            resourceType,
            provider: provider.name,
            model: request.model,
            latencyMs,
            fallbackUsed: index > 0,
            unitPrice: provider.costPer1kTokens,
            errorCode: err.statusCode
              ? `provider_http_${err.statusCode}`
              : "provider_error",
          });
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

  private async recordFailure(input: {
    telemetry?: RouteTelemetryContext;
    resourceType: string;
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    unitPrice: number;
    errorCode: string;
  }): Promise<void> {
    if (!this.usageStore) return;

    try {
      await this.usageStore.recordUsage({
        apiKeyId: input.telemetry?.apiKeyId,
        payerWallet: input.telemetry?.payerWallet,
        paymentEventId: input.telemetry?.paymentEventId,
        resourceType: input.resourceType,
        provider: input.provider,
        model: input.model,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: input.latencyMs,
        fallbackUsed: input.fallbackUsed,
        cost: 0,
        success: false,
        errorCode: input.errorCode,
        unitPrice: input.unitPrice,
      });
    } catch {
      // Telemetry must never fail the request path.
    }
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
