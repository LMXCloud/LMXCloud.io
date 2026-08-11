import type { FastifyRequest } from "fastify";

/** Set by Cloudflare at the edge; cannot be spoofed by the client. */
export const CF_CONNECTING_IP_HEADER = "cf-connecting-ip";

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Client IP for rate limiting. Prefer Cloudflare's edge-observed IP when present;
 * fall back to Fastify's derived IP (local dev, non-Cloudflare).
 */
export function getClientIpForRateLimit(request: FastifyRequest): string {
  const cfIp = headerValue(request.headers[CF_CONNECTING_IP_HEADER])?.trim();
  if (cfIp) return cfIp;
  return request.ip;
}
