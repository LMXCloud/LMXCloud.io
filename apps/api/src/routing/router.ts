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
import type { RoutingSignalStore } from "./signal-store.js";

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
    private readonly signalStore?: RoutingSignalStore,
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

    const attemptOrder = this.applyCircuitSkip(capable);
    let lastError: ProviderError | undefined;
    let attemptedIndex = 0;

    for (const provider of attemptOrder) {
      const started = performance.now();
      const fallbackUsed = attemptedIndex > 0;
      attemptedIndex += 1;

      try {
        const result = await provider.chatCompletion(request);
        this.signalStore?.recordAttempt(provider.name, true);
        return {
          response: result.response,
          latencyMs: result.latencyMs,
          provider: provider.name,
          fallbackUsed,
          costPer1kTokens: provider.costPer1kTokens,
          usage: result.usage,
          stream: result.stream,
        };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - started);
        if (err instanceof ProviderError) {
          lastError = err;
          const errorCode =
            err.telemetryCode ??
            (err.statusCode
              ? `provider_http_${err.statusCode}`
              : "provider_error");
          this.signalStore?.recordAttempt(provider.name, false, errorCode);
          await this.recordFailure({
            telemetry,
            resourceType,
            provider: provider.name,
            model: request.model,
            latencyMs,
            fallbackUsed,
            unitPrice: provider.costPer1kTokens,
            errorCode,
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

    const gatewayHealthy = (name: string) =>
      Boolean(this.healthStore.get(name)?.healthy);

    if (preference.preferredProvider) {
      const preferred = candidates.find(
        (provider) => provider.name === preference.preferredProvider,
      );
      if (preferred) {
        const rest = candidates.filter(
          (provider) => provider.name !== preferred.name,
        );
        const orderedRest = this.signalStore
          ? this.signalStore.orderProviders(rest, gatewayHealthy)
          : this.prioritizeHealthy(rest);
        return [preferred, ...orderedRest];
      }
    }

    if (preference.strategy === "cheapest") {
      candidates = this.sortByCost(candidates);
      if (this.signalStore) {
        return this.signalStore.orderProvidersPreservingPrimary(
          candidates,
          gatewayHealthy,
        );
      }
      return this.prioritizeHealthy(candidates);
    }

    if (preference.strategy === "fastest") {
      candidates = this.sortByLatency(candidates);
      if (this.signalStore) {
        return this.signalStore.orderProvidersPreservingPrimary(
          candidates,
          gatewayHealthy,
        );
      }
      return this.prioritizeHealthy(candidates);
    }

    if (this.signalStore) {
      return this.signalStore.orderProviders(candidates, gatewayHealthy);
    }

    return this.prioritizeHealthy(candidates);
  }

  /**
   * Skip open-circuit providers when at least one alternative is available.
   * If every capable provider is open, try them all (last resort).
   */
  private applyCircuitSkip(capable: ProviderAdapter[]): ProviderAdapter[] {
    if (!this.signalStore) return capable;

    const available = capable.filter(
      (provider) => !this.signalStore!.shouldSkip(provider.name),
    );
    return available.length > 0 ? available : capable;
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
