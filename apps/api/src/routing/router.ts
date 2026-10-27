import { resolveModelAlias, type ChatCompletionRequest } from "@lmxcloud/shared";
import { expectedProviderModelId } from "../providers/model-maps.js";
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
  /** Non-streaming: executed model reported by the provider (header first, then body). */
  executedModel?: { id: string; source: ModelIdSource };
  /** Streaming: executed model seen so far on the stream. */
  streamExecutedModel?: () => { id: string; source: ModelIdSource } | undefined;
}

/** Where the executed model id was read from. Header wins over the body. */
export type ModelIdSource = "header" | "body";

/** Caller-facing evidence for which model actually ran. */
export interface ExecutedModelReport {
  /** Model id the provider says it ran, when known. */
  executed?: string;
  /** provider-header = provider's X-Model-Executed; response-body = model field; unknown = neither. */
  source: "provider-header" | "response-body" | "unknown";
  /** Upstream id the router asked the provider to run, when the router maps one. */
  expected?: string;
  /** true/false when both ids are known, otherwise unknown. */
  substitution: "true" | "false" | "unknown";
}

/**
 * Builds the caller-facing executed-model report for one routed request.
 * `model` is the canonical LMX model id (after alias resolution).
 */
export function describeExecutedModel(
  provider: string,
  model: string,
  executed: { id: string; source: ModelIdSource } | undefined,
): ExecutedModelReport {
  const expected = expectedProviderModelId(provider, model);
  if (!executed) {
    return { source: "unknown", substitution: "unknown", ...(expected ? { expected } : {}) };
  }
  return {
    executed: executed.id,
    source: executed.source === "header" ? "provider-header" : "response-body",
    ...(expected ? { expected } : {}),
    substitution: expected ? (executed.id === expected ? "false" : "true") : "unknown",
  };
}

/** Response headers for an executed-model report. Unknown values are stated, never guessed. */
export function executedModelHeaders(report: ExecutedModelReport): Record<string, string> {
  return {
    ...(report.executed ? { "x-lmx-model-executed": report.executed } : {}),
    "x-lmx-model-executed-source": report.source,
    ...(report.expected ? { "x-lmx-model-expected": report.expected } : {}),
    "x-lmx-substitution": report.substitution,
  };
}

/**
 * Provider returned a different model than the ID we asked it to run.
 * Logged only. The response is still returned to the caller.
 */
export function logModelSubstitution(
  provider: string,
  requested: string,
  returned: string | undefined,
  options?: { streaming?: boolean; source?: ModelIdSource },
): void {
  if (!returned) return;
  const expected = expectedProviderModelId(provider, requested);
  if (!expected || returned === expected) return;
  console.info(
    JSON.stringify({
      msg: "model_substitution",
      provider,
      requested,
      expected,
      returned,
      source: options?.source ?? "body",
      ...(options?.streaming ? { streaming: true } : {}),
    }),
  );
}

/**
 * Executed model id for substitution checks.
 * X-Model-Executed wins when the provider sent it, including when the body
 * model field disagrees. A blank header is ignored.
 */
export function selectExecutedModel(
  headerModel: string | null | undefined,
  bodyModel: string | null | undefined,
): { id: string; source: ModelIdSource } | undefined {
  const header = headerModel?.trim();
  if (header) return { id: header, source: "header" };
  const body = bodyModel?.trim();
  if (body) return { id: body, source: "body" };
  return undefined;
}

/** First model id seen on a relayed stream. Later chunks are not checked again. */
export function observeStreamedModel(
  provider: string,
  requested: string,
  returned: string | undefined,
  state: { noted: boolean },
  source: ModelIdSource = "body",
): void {
  if (state.noted || !returned) return;
  state.noted = true;
  logModelSubstitution(provider, requested, returned, { streaming: true, source });
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
    const canonical = resolveModelAlias(request.model);
    if (canonical !== request.model) {
      request = { ...request, model: canonical };
    }

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
        let executedModel = result.executedModel;
        if (!result.stream) {
          executedModel ??= selectExecutedModel(undefined, result.response.model);
          logModelSubstitution(
            provider.name,
            request.model,
            executedModel?.id,
            { source: executedModel?.source ?? "body" },
          );
        }
        return {
          response: result.response,
          latencyMs: result.latencyMs,
          provider: provider.name,
          fallbackUsed,
          costPer1kTokens: provider.costPer1kTokens,
          usage: result.usage,
          stream: result.stream,
          ...(executedModel && !result.stream ? { executedModel } : {}),
          ...(result.streamExecutedModel
            ? { streamExecutedModel: result.streamExecutedModel }
            : {}),
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
