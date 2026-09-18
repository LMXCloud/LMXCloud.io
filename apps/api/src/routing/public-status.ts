import type { CircuitState } from "./circuit-breaker.js";
import { ROUTING_SCORE_DEFAULTS } from "./score.js";
import {
  ROUTING_HISTORY_WINDOW_HOURS,
  type RealTrafficSnapshot,
} from "./signal-store.js";

export function emptyRealTraffic(
  windowHours = ROUTING_HISTORY_WINDOW_HOURS,
): RealTrafficSnapshot {
  return {
    attempts: 0,
    successes: 0,
    successRate: null,
    windowHours,
  };
}

/**
 * Public `healthy` for /v1/status: real chat outcomes first, gateway ping only
 * when the rolling window has no samples.
 */
export function providerHealthyForPublicStatus(input: {
  gatewayUp: boolean;
  realAttempts: number;
  realSuccesses: number;
  circuit?: CircuitState;
}): boolean {
  if (input.circuit === "open") return false;
  if (input.realAttempts <= 0) return input.gatewayUp;
  if (input.realSuccesses <= 0) return false;

  const minSamples = ROUTING_SCORE_DEFAULTS.minSamples;
  const floor = ROUTING_SCORE_DEFAULTS.successFloor;
  if (input.realAttempts < minSamples) {
    return input.gatewayUp;
  }
  return input.realSuccesses / input.realAttempts >= floor;
}

export function aggregateRealTraffic(
  rows: RealTrafficSnapshot[],
  windowHours = ROUTING_HISTORY_WINDOW_HOURS,
): RealTrafficSnapshot {
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const successes = rows.reduce((sum, row) => sum + row.successes, 0);
  return {
    attempts,
    successes,
    successRate: attempts > 0 ? successes / attempts : null,
    windowHours,
  };
}
