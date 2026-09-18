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

/** Rolling window used for routing history polls and public real-traffic status. */
export const ROUTING_HISTORY_WINDOW_HOURS = 6;

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

export interface RealTrafficSnapshot {
  attempts: number;
  successes: number;
  successRate: number | null;
  windowHours: number;
}

/**
 * Combines rolling DB history + live circuit breaker for routing decisions.
 */
export class RoutingSignalStore {
  private readonly history = new Map<string, ProviderHistoryRates>();
  readonly circuitBreaker: CircuitBreaker;
  readonly historyWindowHours: number;

  constructor(
    circuitConfig?: CircuitBreakerConfig,
    historyWindowHours: number = ROUTING_HISTORY_WINDOW_HOURS,
  ) {
    this.circuitBreaker = new CircuitBreaker(circuitConfig);
    this.historyWindowHours = historyWindowHours;
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

  /**
   * Real chat outcomes for public status: 6h DB history when present,
   * otherwise the in-process circuit-breaker ring (process lifetime).
   */
  getReportedRealTraffic(provider: string): RealTrafficSnapshot {
    const hist = this.history.get(provider);
    if (hist && hist.realAttempts > 0) {
      return {
        attempts: hist.realAttempts,
        successes: hist.realSuccesses,
        successRate: hist.realSuccesses / hist.realAttempts,
        windowHours: this.historyWindowHours,
      };
    }

    const live = this.circuitBreaker.snapshot(provider);
    if (live.recentAttempts > 0) {
      return {
        attempts: live.recentAttempts,
        successes: live.recentSuccesses,
        successRate: live.recentSuccesses / live.recentAttempts,
        windowHours: this.historyWindowHours,
      };
    }

    return {
      attempts: 0,
      successes: 0,
      successRate: null,
      windowHours: this.historyWindowHours,
    };
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
