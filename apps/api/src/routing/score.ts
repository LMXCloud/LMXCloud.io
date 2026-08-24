import type { CircuitState } from "./circuit-breaker.js";

/** Rolling historical rates from the 6h DB poll (may be empty). */
export interface ProviderHistoryRates {
  realAttempts: number;
  realSuccesses: number;
  syntheticAttempts: number;
  syntheticSuccesses: number;
}

export interface ProviderScoreInput {
  name: string;
  tier: number;
  gatewayHealthy: boolean;
  history: ProviderHistoryRates | null;
  circuit: CircuitState;
}

export interface ProviderScoreResult {
  name: string;
  /** Higher is better; null when only tier/gateway apply. */
  score: number | null;
  demoted: boolean;
  circuit: CircuitState;
  gatewayHealthy: boolean;
  realAttempts: number;
  realSuccesses: number;
  realSuccessRate: number | null;
  syntheticAttempts: number;
  syntheticSuccesses: number;
  syntheticSuccessRate: number | null;
}

export const ROUTING_SCORE_DEFAULTS = {
  minSamples: 5,
  successFloor: 0.2,
  realWeight: 0.7,
  syntheticWeight: 0.3,
} as const;

function rate(successes: number, attempts: number): number | null {
  if (attempts <= 0) return null;
  return successes / attempts;
}

/**
 * Compute ranking metadata for one provider.
 * Demote when real (or synthetic-as-proxy) success is below floor with enough samples.
 */
export function scoreProvider(
  input: ProviderScoreInput,
  opts: typeof ROUTING_SCORE_DEFAULTS = ROUTING_SCORE_DEFAULTS,
): ProviderScoreResult {
  const hist = input.history ?? {
    realAttempts: 0,
    realSuccesses: 0,
    syntheticAttempts: 0,
    syntheticSuccesses: 0,
  };

  const realRate = rate(hist.realSuccesses, hist.realAttempts);
  const synthRate = rate(hist.syntheticSuccesses, hist.syntheticAttempts);

  const realOk = hist.realAttempts >= opts.minSamples;
  const synthOk = hist.syntheticAttempts >= opts.minSamples;

  let demoted = false;
  if (realOk && realRate != null && realRate < opts.successFloor) {
    demoted = true;
  } else if (
    !realOk &&
    synthOk &&
    synthRate != null &&
    synthRate < opts.successFloor
  ) {
    demoted = true;
  }

  let score: number | null = null;
  if (realOk && synthOk && realRate != null && synthRate != null) {
    score = opts.realWeight * realRate + opts.syntheticWeight * synthRate;
  } else if (realOk && realRate != null) {
    score = realRate;
  } else if (synthOk && synthRate != null) {
    score = synthRate;
  }

  return {
    name: input.name,
    score,
    demoted,
    circuit: input.circuit,
    gatewayHealthy: input.gatewayHealthy,
    realAttempts: hist.realAttempts,
    realSuccesses: hist.realSuccesses,
    realSuccessRate: realRate,
    syntheticAttempts: hist.syntheticAttempts,
    syntheticSuccesses: hist.syntheticSuccesses,
    syntheticSuccessRate: synthRate,
  };
}

function compareRoutingBands(
  sa: ProviderScoreResult,
  sb: ProviderScoreResult,
): number {
  const aOpen = sa.circuit === "open" ? 1 : 0;
  const bOpen = sb.circuit === "open" ? 1 : 0;
  if (aOpen !== bOpen) return aOpen - bOpen;

  const aDemoted = sa.demoted ? 1 : 0;
  const bDemoted = sb.demoted ? 1 : 0;
  if (aDemoted !== bDemoted) return aDemoted - bDemoted;

  const aGw = sa.gatewayHealthy ? 0 : 1;
  const bGw = sb.gatewayHealthy ? 0 : 1;
  if (aGw !== bGw) return aGw - bGw;

  return 0;
}

/**
 * Sort providers for routing:
 * 1. Closed/half_open before open circuits (open last)
 * 2. Non-demoted before demoted
 * 3. Gateway-healthy before unhealthy
 * 4. Higher score first (unknown score falls back to lower tier number)
 * 5. Lower static tier as final tiebreak
 *
 * Preserves relative order of `providers` when all else equal (stable-ish via index).
 */
export function orderProvidersByScore<T extends { name: string; tier: number }>(
  providers: T[],
  scored: Map<string, ProviderScoreResult>,
): T[] {
  return [...providers]
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      const sa = scored.get(a.provider.name)!;
      const sb = scored.get(b.provider.name)!;

      const band = compareRoutingBands(sa, sb);
      if (band !== 0) return band;

      const aScore = sa.score ?? -1;
      const bScore = sb.score ?? -1;
      if (aScore !== bScore) return bScore - aScore;

      if (a.provider.tier !== b.provider.tier) {
        return a.provider.tier - b.provider.tier;
      }
      return a.index - b.index;
    })
    .map(({ provider }) => provider);
}

/**
 * Apply circuit/demote/gateway bands only — preserve caller order within each band.
 * Used after cheapest/fastest primary sorts.
 */
export function orderProvidersByBands<T extends { name: string }>(
  providers: T[],
  scored: Map<string, ProviderScoreResult>,
): T[] {
  return [...providers]
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      const band = compareRoutingBands(
        scored.get(a.provider.name)!,
        scored.get(b.provider.name)!,
      );
      if (band !== 0) return band;
      return a.index - b.index;
    })
    .map(({ provider }) => provider);
}
