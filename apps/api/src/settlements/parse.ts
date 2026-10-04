import { getAddress, isAddress } from "viem";
import { roundCredits } from "../credits/pricing.js";

export const SETTLEMENT_PATH = "/v1/settlements";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const USDC_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const MAX_REFERENCE_LENGTH = 128;
const MAX_USDC = 1_000_000;

export interface SettlementIntent {
  /** Checksummed destination wallet. */
  payee: `0x${string}`;
  /** USDC amount in decimal units, at most 6 fractional digits. */
  amount: number;
  asset: "USDC";
  reference: string;
}

export interface PaymentMatchInput {
  scheme?: string;
  payTo?: string;
  amount?: string;
  asset?: string;
}

export class SettlementRequestError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly code: string;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = "SettlementRequestError";
    this.code = code;
    this.type = "invalid_request_error";
    this.statusCode = statusCode;
  }
}

export function isSettlementRequestError(
  error: unknown,
): error is SettlementRequestError {
  if (error instanceof SettlementRequestError) return true;
  if (typeof error !== "object" || error === null) return false;
  return (error as { name?: unknown }).name === "SettlementRequestError";
}

export function settlementErrorPayload(error: SettlementRequestError): {
  message: string;
  type: string;
  code: string;
} {
  return {
    message: error.message,
    type: error.type || "invalid_request_error",
    code: error.code || "invalid_request",
  };
}

function parseUsdcAmount(value: unknown): number {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new SettlementRequestError(
        "amount must be a positive USDC value with at most 6 decimal places",
        "invalid_amount",
      );
    }
    text = value.toFixed(6).replace(/\.?0+$/, "");
    if (Math.abs(value - Number(text)) > 1e-9) {
      throw new SettlementRequestError(
        "amount must be a positive USDC value with at most 6 decimal places",
        "invalid_amount",
      );
    }
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw new SettlementRequestError(
      "amount must be a positive USDC value with at most 6 decimal places",
      "invalid_amount",
    );
  }

  if (!USDC_AMOUNT.test(text)) {
    throw new SettlementRequestError(
      "amount must be a positive USDC value with at most 6 decimal places",
      "invalid_amount",
    );
  }

  const amount = roundCredits(Number(text));
  if (amount < 0.000001 || amount > MAX_USDC) {
    throw new SettlementRequestError(
      "amount must be between 0.000001 and 1000000 USDC",
      "invalid_amount",
    );
  }
  return amount;
}

export function parseSettlementBody(body: unknown): SettlementIntent {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new SettlementRequestError(
      "Request body must be a JSON object with payee, amount, asset, and reference",
      "invalid_body",
    );
  }

  const record = body as Record<string, unknown>;

  if (typeof record.payee !== "string" || !isAddress(record.payee)) {
    throw new SettlementRequestError(
      "payee must be an Ethereum address",
      "invalid_payee",
    );
  }
  const payee = getAddress(record.payee);
  if (payee.toLowerCase() === ZERO_ADDRESS) {
    throw new SettlementRequestError(
      "payee must not be the zero address",
      "invalid_payee",
    );
  }

  const amount = parseUsdcAmount(record.amount);

  if (typeof record.asset !== "string" || record.asset.trim().toUpperCase() !== "USDC") {
    throw new SettlementRequestError("asset must be USDC", "invalid_asset");
  }

  if (typeof record.reference !== "string") {
    throw new SettlementRequestError(
      "reference must be a non-empty string",
      "invalid_reference",
    );
  }
  const reference = record.reference.trim();
  if (reference.length === 0 || reference.length > MAX_REFERENCE_LENGTH) {
    throw new SettlementRequestError(
      `reference must be 1-${MAX_REFERENCE_LENGTH} characters`,
      "invalid_reference",
    );
  }

  return { payee, amount, asset: "USDC", reference };
}

/** USDC decimal amount as atomic units (6 decimals). */
export function usdcToAtomic(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function atomicUsdcToDecimal(atomic: string): number {
  return roundCredits(Number(atomic) / 1_000_000);
}

/**
 * The receipt must describe the payment requirements the client actually signed,
 * not a second reading of the body that could diverge.
 */
export function assertPaymentMatchesIntent(
  intent: SettlementIntent,
  requirements: PaymentMatchInput,
  usdcContractAddress: string,
): void {
  if (requirements.scheme !== "exact") {
    throw new SettlementRequestError(
      "Settlement payments must use the exact scheme",
      "scheme_mismatch",
    );
  }

  if (!requirements.payTo || !isAddress(requirements.payTo)) {
    throw new SettlementRequestError(
      "Payment requirements are missing a destination wallet",
      "payee_mismatch",
    );
  }
  if (getAddress(requirements.payTo) !== intent.payee) {
    throw new SettlementRequestError(
      "Payment destination does not match payee",
      "payee_mismatch",
    );
  }

  if (!requirements.amount || !/^\d+$/.test(requirements.amount)) {
    throw new SettlementRequestError(
      "Payment requirements are missing an amount",
      "amount_mismatch",
    );
  }
  if (BigInt(requirements.amount) !== usdcToAtomic(intent.amount)) {
    throw new SettlementRequestError(
      "Payment amount does not match the requested amount",
      "amount_mismatch",
    );
  }

  const expectedAsset = usdcContractAddress.toLowerCase();
  if (!requirements.asset || requirements.asset.toLowerCase() !== expectedAsset) {
    throw new SettlementRequestError(
      "Payment asset is not USDC on this network",
      "asset_mismatch",
    );
  }
}
