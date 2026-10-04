import { keccak256, toBytes } from "viem";
import { roundCredits } from "../credits/pricing.js";

/** Version string baked into every receipt payload for future schema migrations. */
export const RECEIPT_VERSION = "lmx_receipt_v1";

export interface ReceiptInput {
  id: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  createdAt: string;
}

export type ReceiptPayload = {
  version: typeof RECEIPT_VERSION;
  id: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: string;
  latency_ms: number;
  fallback_used: boolean;
  created_at: string;
};

/** Fixed 8-decimal cost string matching `roundCredits()` storage semantics. */
export function formatCostForReceipt(cost: number): string {
  return roundCredits(cost).toFixed(8);
}

export function buildReceiptPayload(input: ReceiptInput): ReceiptPayload {
  return {
    version: RECEIPT_VERSION,
    id: input.id,
    provider: input.provider,
    model: input.model,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    cost: formatCostForReceipt(input.cost),
    latency_ms: input.latencyMs,
    fallback_used: input.fallbackUsed,
    created_at: input.createdAt,
  };
}

/**
 * Deterministic JSON with alphabetically sorted keys.
 * Shared by inference receipts and settlement receipts — do not change without bumping versions.
 */
export function canonicalizeJsonObject(value: object): string {
  const record = value as Record<string, unknown>;
  const sorted = Object.keys(record).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) {
    ordered[key] = record[key];
  }
  return JSON.stringify(ordered);
}

/** Deterministic JSON with alphabetically sorted keys — do not change without bumping version. */
export function canonicalizeReceiptPayload(payload: ReceiptPayload): string {
  return canonicalizeJsonObject(payload);
}

export function hashReceipt(input: ReceiptInput): `0x${string}` {
  const payload = buildReceiptPayload(input);
  return keccak256(toBytes(canonicalizeReceiptPayload(payload)));
}

/** Wallet-to-wallet settlement receipt. Distinct from inference `lmx_receipt_v1`. */
export const SETTLEMENT_RECEIPT_VERSION = "lmx_settlement_receipt_v1";

export interface SettlementReceiptInput {
  id: string;
  referenceId: string;
  payer: string;
  payee: string;
  amount: number;
  asset: string;
  createdAt: string;
}

export type SettlementReceiptPayload = {
  version: typeof SETTLEMENT_RECEIPT_VERSION;
  id: string;
  reference_id: string;
  payer: string;
  payee: string;
  amount: string;
  asset: string;
  created_at: string;
};

export function buildSettlementReceiptPayload(
  input: SettlementReceiptInput,
): SettlementReceiptPayload {
  return {
    version: SETTLEMENT_RECEIPT_VERSION,
    id: input.id,
    reference_id: input.referenceId,
    payer: input.payer,
    payee: input.payee,
    amount: formatCostForReceipt(input.amount),
    asset: input.asset,
    created_at: input.createdAt,
  };
}

export function canonicalizeSettlementReceipt(payload: SettlementReceiptPayload): string {
  return canonicalizeJsonObject(payload);
}

/** Hash the receipt payload exactly as it will be shown and stored. */
export function hashSettlementReceiptPayload(
  payload: SettlementReceiptPayload,
): `0x${string}` {
  return keccak256(toBytes(canonicalizeSettlementReceipt(payload)));
}

export function hashSettlementReceipt(input: SettlementReceiptInput): `0x${string}` {
  return hashSettlementReceiptPayload(buildSettlementReceiptPayload(input));
}
