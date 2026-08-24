import {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from "./circuit-breaker.js";
import {
  orderProvidersByBands,
  orderProvidersByScore,
  scoreProvider,
  type ProviderHistoryRates,
  type ProviderScoreResult,
  ROUTING_SCORE_DEFAULTS,
} from "./score.js";

export type { ProviderHistoryRates, ProviderScoreResult };

export interface RoutingSignalSnapshot {
  provider: string;
  circuit: CircuitState;
  demoted: boolean;
  score: number | null;
  effectivePriority: number;
  realAttempts: number;
  realSuccesses: number;
  realSuccessRate: number | null;
  syntheticAttempts: number;
  syntheticSuccesses: number;
  syntheticSuccessRate: number | null;
  gatewayHealthy: boolean;
}

/**
 * Combines rolling DB history + live circuit breaker for routing decisions.
 */
export class RoutingSignalStore {
  private readonly history = new Map<string, ProviderHistoryRates>();
  readonly circuitBreaker: CircuitBreaker;

  constructor(circuitConfig?: CircuitBreakerConfig) {
    this.circuitBreaker = new CircuitBreaker(circuitConfig);
  }

  applyHistory(rows: Array<{ provider: string } & ProviderHistoryRates>): void {
    this.history.clear();
    for (const row of rows) {
      this.history.set(row.provider, {
        realAttempts: row.realAttempts,
        realSuccesses: row.realSuccesses,
        syntheticAttempts: row.syntheticAttempts,
        syntheticSuccesses: row.syntheticSuccesses,
      });
    }
  }

  getHistory(provider: string): ProviderHistoryRates | null {
    return this.history.get(provider) ?? null;
  }

  recordAttempt(
    provider: string,
    success: boolean,
    errorCode?: string,
  ): CircuitState {
    return this.circuitBreaker.recordAttempt(provider, success, errorCode);
  }

  shouldSkip(provider: string): boolean {
    return this.circuitBreaker.shouldSkip(provider);
  }

  getCircuitState(provider: string): CircuitState {
    return this.circuitBreaker.getState(provider);
  }

  scoreAll(
    providers: Array<{ name: string; tier: number }>,
    gatewayHealthy: (name: string) => boolean,
  ): Map<string, ProviderScoreResult> {
    const out = new Map<string, ProviderScoreResult>();
    for (const provider of providers) {
      out.set(
        provider.name,
        scoreProvider({
          name: provider.name,
          tier: provider.tier,
          gatewayHealthy: gatewayHealthy(provider.name),
          history: this.history.get(provider.name) ?? null,
          circuit: this.circuitBreaker.getState(provider.name),
        }),
      );
    }
    return out;
  }

  /**
   * Full score-based order (default strategy / effective fallback chain).
   */
  orderProviders<T extends { name: string; tier: number }>(
    providers: T[],
    gatewayHealthy: (name: string) => boolean,
  ): T[] {
    const scored = this.scoreAll(providers, gatewayHealthy);
    return orderProvidersByScore(providers, scored);
  }

  /**
   * Circuit/demote/gateway bands only — keeps cheapest/fastest primary order.
   */
  orderProvidersPreservingPrimary<T extends { name: string; tier: number }>(
    providers: T[],
    gatewayHealthy: (name: string) => boolean,
  ): T[] {
    const scored = this.scoreAll(providers, gatewayHealthy);
    return orderProvidersByBands(providers, scored);
  }

  /**
   * Effective fallback chain + per-provider routing snapshot for /v1/status.
   */
  getRoutingSnapshots(
    providers: Array<{ name: string; tier: number }>,
    gatewayHealthy: (name: string) => boolean,
  ): {
    effectiveChain: string[];
    byProvider: Record<string, RoutingSignalSnapshot>;
  } {
    const ordered = this.orderProviders(providers, gatewayHealthy);
    const scored = this.scoreAll(providers, gatewayHealthy);
    const byProvider: Record<string, RoutingSignalSnapshot> = {};

    for (let i = 0; i < ordered.length; i++) {
      const name = ordered[i]!.name;
      const s = scored.get(name)!;
      byProvider[name] = {
        provider: name,
        circuit: s.circuit,
        demoted: s.demoted,
        score: s.score,
        effectivePriority: i,
        realAttempts: s.realAttempts,
        realSuccesses: s.realSuccesses,
        realSuccessRate: s.realSuccessRate,
        syntheticAttempts: s.syntheticAttempts,
        syntheticSuccesses: s.syntheticSuccesses,
        syntheticSuccessRate: s.syntheticSuccessRate,
        gatewayHealthy: s.gatewayHealthy,
      };
    }

    // Include any providers missing from ordered (shouldn't happen)
    for (const provider of providers) {
      if (byProvider[provider.name]) continue;
      const s = scored.get(provider.name)!;
      byProvider[provider.name] = {
        provider: provider.name,
        circuit: s.circuit,
        demoted: s.demoted,
        score: s.score,
        effectivePriority: ordered.length,
        realAttempts: s.realAttempts,
        realSuccesses: s.realSuccesses,
        realSuccessRate: s.realSuccessRate,
        syntheticAttempts: s.syntheticAttempts,
        syntheticSuccesses: s.syntheticSuccesses,
        syntheticSuccessRate: s.syntheticSuccessRate,
        gatewayHealthy: s.gatewayHealthy,
      };
    }

    return {
      effectiveChain: ordered.map((p) => p.name),
      byProvider,
    };
  }
}

export { ROUTING_SCORE_DEFAULTS };
