import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../providers/types.js";
import {
  formatGatewayHealthErrorDetail,
  formatSyntheticHealthErrorDetail,
} from "./error-detail.js";

describe("formatGatewayHealthErrorDetail", () => {
  it("returns undefined for healthy probes", () => {
    assert.equal(
      formatGatewayHealthErrorDetail({ healthy: true, latencyMs: 12 }),
      undefined,
    );
  });

  it("formats non-2xx with body", () => {
    assert.equal(
      formatGatewayHealthErrorDetail({
        healthy: false,
        latencyMs: 40,
        statusCode: 502,
        errorDetail: "bad gateway",
      }),
      "http_502: bad gateway",
    );
  });

  it("classifies timeouts without status", () => {
    assert.equal(
      formatGatewayHealthErrorDetail({
        healthy: false,
        latencyMs: null,
        errorDetail: "The operation was aborted due to timeout",
      }),
      "timeout: The operation was aborted due to timeout",
    );
  });

  it("classifies network failures without status", () => {
    assert.equal(
      formatGatewayHealthErrorDetail({
        healthy: false,
        latencyMs: null,
        errorDetail: "fetch failed",
      }),
      "network: fetch failed",
    );
  });
});

describe("formatSyntheticHealthErrorDetail", () => {
  it("formats upstream HTTP failures", () => {
    const err = new ProviderError(
      "io.net returned 429: rate limited",
      "io.net",
      429,
    );
    assert.equal(
      formatSyntheticHealthErrorDetail(err),
      "http_429: rate limited",
    );
  });

  it("classifies transport timeouts", () => {
    const err = new ProviderError(
      "Failed to reach Akash API",
      "akash",
      undefined,
      new Error("The operation was aborted due to timeout"),
    );
    assert.equal(
      formatSyntheticHealthErrorDetail(err),
      "timeout: The operation was aborted due to timeout",
    );
  });

  it("classifies transport network failures", () => {
    const err = new ProviderError(
      "Failed to reach Akash API",
      "akash",
      undefined,
      new Error("fetch failed"),
    );
    assert.equal(
      formatSyntheticHealthErrorDetail(err),
      "network: fetch failed",
    );
  });
});
