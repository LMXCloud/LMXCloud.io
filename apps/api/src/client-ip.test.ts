import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest } from "fastify";
import {
  CF_CONNECTING_IP_HEADER,
  getClientIpForRateLimit,
} from "./client-ip.js";

function mockRequest(overrides: {
  ip?: string;
  headers?: Record<string, string | string[]>;
}): FastifyRequest {
  return {
    ip: overrides.ip ?? "127.0.0.1",
    headers: overrides.headers ?? {},
  } as FastifyRequest;
}

describe("getClientIpForRateLimit", () => {
  it("prefers CF-Connecting-IP over request.ip", () => {
    const request = mockRequest({
      ip: "1.2.3.4",
      headers: { [CF_CONNECTING_IP_HEADER]: "10.0.0.1" },
    });
    assert.equal(getClientIpForRateLimit(request), "10.0.0.1");
  });

  it("falls back to request.ip when CF header is absent", () => {
    const request = mockRequest({ ip: "127.0.0.1" });
    assert.equal(getClientIpForRateLimit(request), "127.0.0.1");
  });

  it("falls back when CF header is blank", () => {
    const request = mockRequest({
      ip: "127.0.0.1",
      headers: { [CF_CONNECTING_IP_HEADER]: "   " },
    });
    assert.equal(getClientIpForRateLimit(request), "127.0.0.1");
  });

  it("uses the first value when CF header is an array", () => {
    const request = mockRequest({
      ip: "1.2.3.4",
      headers: { [CF_CONNECTING_IP_HEADER]: ["10.0.0.1", "10.0.0.2"] },
    });
    assert.equal(getClientIpForRateLimit(request), "10.0.0.1");
  });
});
