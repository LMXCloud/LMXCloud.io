import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROVIDER_BILLING_EXHAUSTED_CODE } from "../providers/billing-errors.js";
import {
  CircuitBreaker,
  DEFAULT_CIRCUIT_CONFIG,
} from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("stays closed below minAttempts even with all failures", () => {
    const breaker = new CircuitBreaker(DEFAULT_CIRCUIT_CONFIG);
    for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.minAttempts - 1; i++) {
      breaker.recordAttempt("ionet", false, "provider_http_500");
    }
    assert.equal(breaker.getState("ionet"), "closed");
    assert.equal(breaker.shouldSkip("ionet"), false);
  });

  it("opens when recent success rate is below floor with enough samples", () => {
    const breaker = new CircuitBreaker(DEFAULT_CIRCUIT_CONFIG);
    // 1 success + 4 failures = 20% exactly — floor is strict < 0.2, so not open yet
    breaker.recordAttempt("ionet", true);
    for (let i = 0; i < 4; i++) {
      breaker.recordAttempt("ionet", false, "provider_http_500");
    }
    assert.equal(breaker.getState("ionet"), "closed");

    breaker.recordAttempt("ionet", false, "provider_http_500");
    // 1/6 ≈ 16.7% < 20%
    assert.equal(breaker.getState("ionet"), "open");
    assert.equal(breaker.shouldSkip("ionet"), true);
  });

  it("opens after consecutive billing_exhausted failures", () => {
    const breaker = new CircuitBreaker(DEFAULT_CIRCUIT_CONFIG);
    for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.billingConsecutiveLimit; i++) {
      breaker.recordAttempt("akash", false, PROVIDER_BILLING_EXHAUSTED_CODE);
    }
    assert.equal(breaker.getState("akash"), "open");
  });

  it("transitions to half_open after cooldown and closes on success", () => {
    let now = 1_000;
    const breaker = new CircuitBreaker(DEFAULT_CIRCUIT_CONFIG, () => now);

    for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.billingConsecutiveLimit; i++) {
      breaker.recordAttempt("akash", false, PROVIDER_BILLING_EXHAUSTED_CODE);
    }
    assert.equal(breaker.getState("akash"), "open");

    now += DEFAULT_CIRCUIT_CONFIG.cooldownMs;
    assert.equal(breaker.getState("akash"), "half_open");
    assert.equal(breaker.shouldSkip("akash"), false);

    breaker.recordAttempt("akash", true);
    assert.equal(breaker.getState("akash"), "closed");
  });

  it("re-opens from half_open on failure", () => {
    let now = 1_000;
    const breaker = new CircuitBreaker(DEFAULT_CIRCUIT_CONFIG, () => now);

    for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.billingConsecutiveLimit; i++) {
      breaker.recordAttempt("akash", false, PROVIDER_BILLING_EXHAUSTED_CODE);
    }
    now += DEFAULT_CIRCUIT_CONFIG.cooldownMs;
    assert.equal(breaker.getState("akash"), "half_open");

    breaker.recordAttempt("akash", false, PROVIDER_BILLING_EXHAUSTED_CODE);
    assert.equal(breaker.getState("akash"), "open");
  });
});
