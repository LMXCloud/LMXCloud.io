export interface PaymentAttempt {
  header: string;
  /** Header name and the shape of the value. Signature material is lengths only. */
  headerValueShape: string;
  x402Version: number;
  facilitator: string | null;
  sellerError: string;
  /**
   * On a 402 after a signed payment: server, x-powered-by, and x402-* only.
   * A rejection that is not a 402 keeps every response header.
   */
  responseHeaders?: Record<string, string>;
  /** Response body from a payment rejection. */
  responseBody?: string;
}

const IDENTITY_HEADER = /^(?:server|x-powered-by|x402-.+)$/i;

/** Headers that name the server or the x402 library. Other headers are left out. */
export function identifyingHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!IDENTITY_HEADER.test(key)) return;
    out[key.toLowerCase()] = value;
  });
  return out;
}

const SECRET_KEY = /signature|nonce|authorization|permit/i;

function shapeOf(value: unknown, depth = 0): string {
  if (depth > 5) return "…";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SECRET_KEY.test(key)) {
        const size = typeof item === "string" ? item.length : 0;
        return `${key}(${size})`;
      }
      return `${key}:${shapeOf(item, depth + 1)}`;
    });
    return `{${parts.join(",")}}`;
  }
  if (typeof value === "string") return `str(${value.length})`;
  if (typeof value === "number") return "num";
  if (typeof value === "boolean") return "bool";
  return "null";
}

/** Name plus structure of the payment header. The signature itself is not stored. */
export function headerValueShape(name: string, value: string): string {
  let decoded: unknown = null;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    decoded = null;
  }
  if (!decoded || typeof decoded !== "object") return `${name} length ${value.length}`;
  return `${name} length ${value.length} ${shapeOf(decoded)}`;
}

function httpUrl(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function nestedFacilitator(value: unknown): string | null {
  const direct = httpUrl(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["facilitator", "facilitatorUrl", "url"]) {
    const found = httpUrl(record[key]) ?? nestedFacilitator(record[key]);
    if (found) return found;
  }
  return null;
}

/** Facilitator URL declared on the 402, if the seller put one there. */
export function facilitatorOf(payment: unknown): string | null {
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) return null;
  const record = payment as Record<string, unknown>;
  const top = nestedFacilitator(record.facilitator) ?? nestedFacilitator(record.extensions);
  if (top) return top;
  const accepts = Array.isArray(record.accepts) ? record.accepts : [];
  for (const accept of accepts) {
    if (!accept || typeof accept !== "object") continue;
    const item = accept as Record<string, unknown>;
    const found = nestedFacilitator(item.facilitator) ?? nestedFacilitator(item.extra);
    if (found) return found;
  }
  return nestedFacilitator(record.extra);
}

export function sellerErrorText(
  body: string,
  settlement: { errorMessage?: string | null; errorReason?: string | null } | null,
): string {
  const trimmed = body.trim();
  const fromSettle = (settlement?.errorMessage || settlement?.errorReason || "").trim();
  if (trimmed && trimmed !== "{}" && trimmed !== "null") return trimmed.slice(0, 500);
  if (fromSettle) return fromSettle.slice(0, 500);
  return trimmed.slice(0, 500);
}

function versionOf(payment: unknown): number | null {
  if (!payment || typeof payment !== "object") return null;
  const version = (payment as { x402Version?: unknown }).x402Version;
  return typeof version === "number" ? version : null;
}

function headerForVersion(version: number | null): string {
  if (version === 1) return "X-PAYMENT";
  if (version === 2) return "PAYMENT-SIGNATURE";
  return "unknown";
}

/** Exact seller text plus what we sent, so a compatibility miss is separable from their bug. */
export function paymentRejectionDetail(result: {
  paymentAttempt?: PaymentAttempt | null;
  paymentRequirements: unknown;
  bodyTruncated: string | null;
}): string {
  const attempt = result.paymentAttempt;
  const version = attempt?.x402Version ?? versionOf(result.paymentRequirements);
  const header = attempt?.header ?? headerForVersion(version);
  const seller = attempt ? attempt.sellerError : (result.bodyTruncated?.trim() || "");
  const facilitator = attempt ? (attempt.facilitator ?? "none") : (facilitatorOf(result.paymentRequirements) ?? "none");
  return `seller ${seller || "none"} | header ${header} | x402 ${version ?? "none"} | facilitator ${facilitator}`;
}
