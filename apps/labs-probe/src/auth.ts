import type { PaymentPayload } from "@x402/core/types";

/** Identity captured at sign time so reconcile can find the chain movement. */
export type PaymentAuth =
  | {
      scheme: "exact";
      /** EIP-3009 authorizer. The Labs wallet. */
      authorizer: string;
      /** EIP-3009 authorization nonce (bytes32). */
      nonce: string;
    }
  | {
      scheme: "upto";
      payTo: string;
      /** Permit2 permitted amount, atomic USDC. The chain transfer may be smaller. */
      maxAmountAtomic: string;
      /** Permit2 unordered nonce, decimal uint256. */
      permitNonce: string;
    };

export interface SignedPayment {
  headers: Record<string, string>;
  auth: PaymentAuth;
}

export function isSignedPayment(value: unknown): value is SignedPayment {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!record.headers || typeof record.headers !== "object" || Array.isArray(record.headers)) return false;
  if (!record.auth || typeof record.auth !== "object" || Array.isArray(record.auth)) return false;
  const scheme = (record.auth as { scheme?: unknown }).scheme;
  return scheme === "exact" || scheme === "upto";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** bytes32 hex, lowercased, so chain topics and signed nonces compare equal. */
export function normalizeNonce(nonce: string): string {
  const trimmed = nonce.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`EIP-3009 nonce must be 32 bytes, got ${nonce}`);
  }
  return `0x${hex}`;
}

/**
 * Pull the reconciliation key out of the payload that was just signed.
 * exact keeps the EIP-3009 nonce. upto keeps payTo, the max amount, and the Permit2 nonce.
 */
export function paymentAuthFromPayload(payload: PaymentPayload): PaymentAuth {
  const scheme = payload.accepted?.scheme;
  const body = asRecord(payload.payload);
  if (!body) throw new Error("Signed payload has no body");

  if (scheme === "exact") {
    const authorization = asRecord(body.authorization);
    if (!authorization || typeof authorization.from !== "string" || typeof authorization.nonce !== "string") {
      throw new Error("Exact payload is missing the EIP-3009 authorization nonce");
    }
    return {
      scheme: "exact",
      authorizer: authorization.from,
      nonce: normalizeNonce(authorization.nonce),
    };
  }

  if (scheme === "upto") {
    const permit = asRecord(body.permit2Authorization);
    const permitted = asRecord(permit?.permitted);
    const witness = asRecord(permit?.witness);
    const amount = permitted?.amount;
    if (
      !permit ||
      typeof permit.nonce !== "string" ||
      (typeof amount !== "string" && typeof amount !== "number") ||
      typeof witness?.to !== "string"
    ) {
      throw new Error("Upto payload is missing payTo, max amount, or the Permit2 nonce");
    }
    return {
      scheme: "upto",
      payTo: witness.to,
      maxAmountAtomic: String(amount),
      permitNonce: permit.nonce,
    };
  }

  throw new Error(`Cannot record a reconciliation key for scheme ${scheme ?? "unknown"}`);
}
