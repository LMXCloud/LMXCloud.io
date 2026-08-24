import { PROVIDER_BILLING_EXHAUSTED_CODE } from "../providers/billing-errors.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Ring buffer capacity for recent attempts. */
  windowSize: number;
  /** Minimum attempts in the ring before rate-based open. */
  minAttempts: number;
  /** Open when recent success rate is strictly below this (0–1). */
  successFloor: number;
  /** Consecutive billing_exhausted failures that force open. */
  billingConsecutiveLimit: number;
  /** Ms to wait before half-open probe after opening. */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  windowSize: 20,
  minAttempts: 5,
  successFloor: 0.2,
  billingConsecutiveLimit: 3,
  cooldownMs: 120_000,
};

interface AttemptRecord {
  success: boolean;
  errorCode?: string;
  at: number;
}

interface ProviderCircuit {
  attempts: AttemptRecord[];
  consecutiveBilling: number;
  state: CircuitState;
  openedAt: number | null;
}

/**
 * Per-provider in-memory circuit breaker.
 * Open circuits are skipped by the router unless every capable provider is open.
 */
export class CircuitBreaker {
  private readonly circuits = new Map<string, ProviderCircuit>();

  constructor(
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {}

  recordAttempt(
    provider: string,
    success: boolean,
    errorCode?: string,
  ): CircuitState {
    const circuit = this.ensure(provider);
    this.maybeTransitionToHalfOpen(circuit);

    if (circuit.state === "half_open") {
      if (success) {
        this.resetClosed(circuit);
      } else {
        this.open(circuit);
      }
      this.pushAttempt(circuit, success, errorCode);
      return circuit.state;
    }

    this.pushAttempt(circuit, success, errorCode);

    if (success) {
      circuit.consecutiveBilling = 0;
      return circuit.state;
    }

    if (errorCode === PROVIDER_BILLING_EXHAUSTED_CODE) {
      circuit.consecutiveBilling += 1;
    } else {
      circuit.consecutiveBilling = 0;
    }

    if (this.shouldOpen(circuit)) {
      this.open(circuit);
    }

    return circuit.state;
  }

  /**
   * Whether the router should skip this provider on the current attempt.
   * Only fully open circuits are skipped; half-open is eligible for a probe.
   */
  shouldSkip(provider: string): boolean {
    return this.getState(provider) === "open";
  }

  getState(provider: string): CircuitState {
    const circuit = this.ensure(provider);
    this.maybeTransitionToHalfOpen(circuit);
    return circuit.state;
  }

  /** Snapshot for status / tests. */
  snapshot(provider: string): {
    state: CircuitState;
    recentAttempts: number;
    recentSuccesses: number;
    consecutiveBilling: number;
  } {
    const circuit = this.ensure(provider);
    this.maybeTransitionToHalfOpen(circuit);
    const recentSuccesses = circuit.attempts.filter((a) => a.success).length;
    return {
      state: circuit.state,
      recentAttempts: circuit.attempts.length,
      recentSuccesses,
      consecutiveBilling: circuit.consecutiveBilling,
    };
  }

  /** Test helper — clear all state. */
  reset(): void {
    this.circuits.clear();
  }

  private ensure(provider: string): ProviderCircuit {
    let circuit = this.circuits.get(provider);
    if (!circuit) {
      circuit = {
        attempts: [],
        consecutiveBilling: 0,
        state: "closed",
        openedAt: null,
      };
      this.circuits.set(provider, circuit);
    }
    return circuit;
  }

  private pushAttempt(
    circuit: ProviderCircuit,
    success: boolean,
    errorCode?: string,
  ): void {
    circuit.attempts.push({ success, errorCode, at: this.now() });
    while (circuit.attempts.length > this.config.windowSize) {
      circuit.attempts.shift();
    }
  }

  private shouldOpen(circuit: ProviderCircuit): boolean {
    if (circuit.consecutiveBilling >= this.config.billingConsecutiveLimit) {
      return true;
    }
    const n = circuit.attempts.length;
    if (n < this.config.minAttempts) return false;
    const successes = circuit.attempts.filter((a) => a.success).length;
    return successes / n < this.config.successFloor;
  }

  private open(circuit: ProviderCircuit): void {
    circuit.state = "open";
    circuit.openedAt = this.now();
  }

  private resetClosed(circuit: ProviderCircuit): void {
    circuit.state = "closed";
    circuit.openedAt = null;
    circuit.consecutiveBilling = 0;
  }

  private maybeTransitionToHalfOpen(circuit: ProviderCircuit): void {
    if (circuit.state !== "open" || circuit.openedAt == null) return;
    if (this.now() - circuit.openedAt < this.config.cooldownMs) return;
    circuit.state = "half_open";
  }
}
