import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROVIDER_BILLING_EXHAUSTED_CODE } from "../providers/billing-errors.js";
import {
  isOperatorAttributionError,
  isOperatorAttributionHealthDetail,
  isOperatorAttributionTelemetryCode,
  providerReachableFromProbe,
} from "./operator-attribution.js";

describe("operator attribution vs provider outage", () => {
  it("treats invalid API keys as operator, not provider-down", () => {
    assert.equal(
      isOperatorAttributionError("ionet", 401, '{"detail":"Invalid API Key"}'),
      true,
    );
    assert.equal(
      isOperatorAttributionHealthDetail("http_401: Invalid API Key"),
      true,
    );
    assert.equal(
      isOperatorAttributionHealthDetail('http_401: {"detail":"Invalid API Key"}'),
      true,
    );
    assert.equal(
      isOperatorAttributionError(
        "aethir",
        412,
        JSON.stringify({ code: 412, msg: "TOKEN_INVALID" }),
      ),
      true,
    );
  });

  it("treats insufficient funds / credits as operator", () => {
    assert.equal(
      isOperatorAttributionError(
        "akash",
        402,
        JSON.stringify({
          error: { message: "Insufficient credits to complete this request" },
        }),
      ),
      true,
    );
    assert.equal(
      isOperatorAttributionHealthDetail(
        "http_402: Insufficient credits. Please add more credits to your account and retry.",
      ),
      true,
    );
    assert.equal(
      isOperatorAttributionError(
        "nosana",
        400,
        JSON.stringify({ status: "INSUFFICIENT_FUNDS" }),
      ),
      true,
    );
  });

  it("leaves real provider outages as provider-down", () => {
    assert.equal(
      isOperatorAttributionError("ionet", 502, "bad gateway"),
      false,
    );
    assert.equal(isOperatorAttributionHealthDetail("http_502: bad gateway"), false);
    assert.equal(
      isOperatorAttributionHealthDetail(
        "timeout: The operation was aborted due to timeout",
      ),
      false,
    );
    assert.equal(isOperatorAttributionHealthDetail("network: fetch failed"), false);
    assert.equal(
      isOperatorAttributionError(
        "ionet",
        429,
        JSON.stringify({
          error: { message: "Rate limit exceeded", type: "rate_limit_error" },
        }),
      ),
      false,
    );
  });

  it("maps probes to reachable for status/uptime", () => {
    assert.equal(
      providerReachableFromProbe({
        provider: "ionet",
        healthy: false,
        statusCode: 401,
        errorDetail: "Invalid API Key",
      }),
      true,
    );
    assert.equal(
      providerReachableFromProbe({
        provider: "akash",
        healthy: false,
        statusCode: 502,
        errorDetail: "bad gateway",
      }),
      false,
    );
    assert.equal(
      providerReachableFromProbe({ provider: "aethir", healthy: true, statusCode: 200 }),
      true,
    );
  });

  it("recognizes stored usage error codes", () => {
    assert.equal(isOperatorAttributionTelemetryCode(PROVIDER_BILLING_EXHAUSTED_CODE), true);
    assert.equal(isOperatorAttributionTelemetryCode("provider_http_401"), true);
    assert.equal(isOperatorAttributionTelemetryCode("provider_http_402"), true);
    assert.equal(isOperatorAttributionTelemetryCode("provider_http_502"), false);
    assert.equal(isOperatorAttributionTelemetryCode("provider_http_429"), false);
  });
});
