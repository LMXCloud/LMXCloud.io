import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProviderTelemetryErrorCode,
  isProviderBillingExhaustedError,
  isProviderBillingTelemetryCode,
  PROVIDER_BILLING_EXHAUSTED_CODE,
} from "./billing-errors.js";
import { detectIrregularities } from "../ops/irregularities.js";

describe("provider billing error classification", () => {
  it("classifies AkashML HTTP 402 as billing exhausted", () => {
    const body = JSON.stringify({
      error: {
        message: "Insufficient credits to complete this request",
        type: "invalid_request_error",
      },
    });
    assert.equal(
      isProviderBillingExhaustedError("akash", 402, body),
      true,
    );
    assert.equal(
      classifyProviderTelemetryErrorCode("akash", 402, body),
      PROVIDER_BILLING_EXHAUSTED_CODE,
    );
  });

  it("classifies io.net sub-key credit cap HTTP 429", () => {
    const body = JSON.stringify({
      error: {
        message: "Sub-key credit limit exceeded; key is blocked until limit is raised",
        type: "rate_limit_error",
      },
    });
    assert.equal(isProviderBillingExhaustedError("ionet", 429, body), true);
  });

  it("classifies io.net HTTP 402 payment_required", () => {
    const body = JSON.stringify({
      error: {
        message: "Insufficient credits. Please add more credits to your account and retry.",
        type: "payment_required",
        code: 402,
      },
    });
    assert.equal(isProviderBillingExhaustedError("ionet", 402, body), true);
  });

  it("does not classify io.net plain rate limit 429 as billing", () => {
    const body = JSON.stringify({
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
      },
    });
    assert.equal(isProviderBillingExhaustedError("ionet", 429, body), false);
    assert.equal(
      classifyProviderTelemetryErrorCode("ionet", 429, body),
      "provider_http_429",
    );
  });

  it("does not classify Aethir TOKEN_INVALID as billing", () => {
    const body = JSON.stringify({ code: 412, msg: "TOKEN_INVALID" });
    assert.equal(isProviderBillingExhaustedError("aethir", 401, body), false);
  });

  it("classifies Aethir credit exhaustion messages", () => {
    const body = JSON.stringify({
      error: {
        message: "Insufficient balance to run inference",
        type: "payment_required",
        code: "insufficient_credits",
      },
    });
    assert.equal(isProviderBillingExhaustedError("aethir", 403, body), true);
  });

  it("classifies Nosana INSUFFICIENT_FUNDS", () => {
    const body = JSON.stringify({
      status: "INSUFFICIENT_FUNDS",
      message: "Not enough credits to post job",
    });
    assert.equal(isProviderBillingExhaustedError("nosana", 400, body), true);
  });

  it("recognizes telemetry billing code helper", () => {
    assert.equal(
      isProviderBillingTelemetryCode(PROVIDER_BILLING_EXHAUSTED_CODE),
      true,
    );
    assert.equal(isProviderBillingTelemetryCode("provider_http_502"), false);
  });
});

describe("detectIrregularities provider billing exhaustion", () => {
  const baseInput = {
    windowDays: 7,
    storage: "postgres" as const,
    x402Enabled: false,
    paymentStoreReady: true,
    healthyCount: 2,
    providerCount: 3,
    unhealthyProviders: [],
    paymentStatusCounts: {},
    stuckPayments: [],
    pendingReconciliations: [],
    usageSummary: {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      fallbackCount: 0,
      avgLatencyMs: null,
      uniquePayers: 0,
      uniqueApiKeys: 0,
    },
    usageHistory: [],
    mcpEvents: [],
    recentPayments: [],
  };

  it("fires critical billing irregularity when failures are billing-dominated", () => {
    const recentUsage = [
      {
        id: "1",
        channel: "balance" as const,
        provider: "akash",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 120,
        fallbackUsed: false,
        success: false,
        errorCode: PROVIDER_BILLING_EXHAUSTED_CODE,
        unitPrice: 0.0001,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "2",
        channel: "balance" as const,
        provider: "akash",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 90,
        fallbackUsed: false,
        success: false,
        errorCode: PROVIDER_BILLING_EXHAUSTED_CODE,
        unitPrice: 0.0001,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:01:00.000Z",
      },
      {
        id: "3",
        channel: "balance" as const,
        provider: "akash",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 95,
        fallbackUsed: true,
        success: false,
        errorCode: PROVIDER_BILLING_EXHAUSTED_CODE,
        unitPrice: 0.0001,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:02:00.000Z",
      },
    ];

    const irregularities = detectIrregularities({
      ...baseInput,
      recentUsage,
    });

    const billing = irregularities.find(
      (item) => item.id === "health.provider_billing_exhausted.akash",
    );
    assert.ok(billing);
    assert.equal(billing?.severity, "critical");
    assert.equal(billing?.category, "health");
  });

  it("does not fire when billing failures are a minority", () => {
    const recentUsage = [
      {
        id: "1",
        channel: "balance" as const,
        provider: "ionet",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 120,
        fallbackUsed: false,
        success: false,
        errorCode: PROVIDER_BILLING_EXHAUSTED_CODE,
        unitPrice: 0.0002,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "2",
        channel: "balance" as const,
        provider: "ionet",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 90,
        fallbackUsed: false,
        success: false,
        errorCode: "provider_http_502",
        unitPrice: 0.0002,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:01:00.000Z",
      },
      {
        id: "3",
        channel: "balance" as const,
        provider: "ionet",
        model: "llama-3-70b",
        resourceType: "chat",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 95,
        fallbackUsed: false,
        success: false,
        errorCode: "provider_http_502",
        unitPrice: 0.0002,
        payerWallet: null,
        apiKeyId: "key-1",
        paymentEventId: null,
        createdAt: "2026-08-01T00:02:00.000Z",
      },
    ];

    const irregularities = detectIrregularities({
      ...baseInput,
      recentUsage,
    });

    assert.equal(
      irregularities.some((item) =>
        item.id.startsWith("health.provider_billing_exhausted."),
      ),
      false,
    );
  });
});
