import {
  RECEIPT_VERSION,
  SETTLEMENT_RECEIPT_VERSION,
  buildReceiptPayload,
  buildSettlementReceiptPayload,
  hashReceipt,
  hashSettlementReceipt,
  type ReceiptPayload,
  type SettlementReceiptPayload,
} from "./receipt.js";
import { buildReceiptMerkleTree } from "./merkle.js";
import type { AnchorBatchRecord } from "./store.js";

export type UsageLogProofStatus = "no_receipt" | "pending" | "anchored";

export interface UsageLogProofResult {
  logId: string;
  status: UsageLogProofStatus;
  receiptVersion: typeof RECEIPT_VERSION;
  receipt?: ReceiptPayload;
  receiptHash?: `0x${string}`;
  leafIndex?: number;
  merkleProof?: `0x${string}`[];
  merkleRoot?: `0x${string}`;
  anchor?: {
    chainId: number;
    contractAddress: `0x${string}` | null;
    txHash: string;
    blockNumber: string | null;
    anchoredAt: string | null;
  };
}

export interface UsageEventForProof {
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
  receiptHash: string | null;
  leafIndex: number | null;
}

export function buildUsageLogProof(
  event: UsageEventForProof,
  batch: AnchorBatchRecord | null,
  batchReceiptHashes: `0x${string}`[],
  contractAddress: `0x${string}`,
): UsageLogProofResult {
  const base: Pick<UsageLogProofResult, "logId" | "receiptVersion"> = {
    logId: event.id,
    receiptVersion: RECEIPT_VERSION,
  };

  if (!event.receiptHash) {
    return { ...base, status: "no_receipt" };
  }

  const receiptInput = {
    id: event.id,
    provider: event.provider,
    model: event.model,
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    totalTokens: event.totalTokens,
    cost: event.cost,
    latencyMs: event.latencyMs,
    fallbackUsed: event.fallbackUsed,
    createdAt: event.createdAt,
  };

  const receipt = buildReceiptPayload(receiptInput);
  const receiptHash = hashReceipt(receiptInput);

  if (receiptHash !== event.receiptHash) {
    throw new Error(`Stored receipt hash mismatch for log ${event.id}`);
  }

  if (!batch || batch.status !== "anchored" || event.leafIndex === null) {
    return {
      ...base,
      status: "pending",
      receipt,
      receiptHash,
      leafIndex: event.leafIndex ?? undefined,
    };
  }

  const tree = buildReceiptMerkleTree(batchReceiptHashes);
  if (tree.root !== batch.merkleRoot) {
    throw new Error(`Merkle root mismatch for batch ${batch.id}`);
  }

  return {
    ...base,
    status: "anchored",
    receipt,
    receiptHash,
    leafIndex: event.leafIndex,
    merkleProof: tree.getProof(event.leafIndex),
    merkleRoot: batch.merkleRoot,
    anchor: {
      chainId: batch.chainId,
      contractAddress,
      txHash: batch.txHash ?? "0x0",
      blockNumber: batch.blockNumber?.toString() ?? null,
      anchoredAt: batch.anchoredAt,
    },
  };
}

export interface SettlementReceiptProofResult {
  settlementId: string;
  status: UsageLogProofStatus;
  receiptVersion: typeof SETTLEMENT_RECEIPT_VERSION;
  receipt?: SettlementReceiptPayload;
  receiptHash?: `0x${string}`;
  leafIndex?: number;
  merkleProof?: `0x${string}`[];
  merkleRoot?: `0x${string}`;
  anchor?: UsageLogProofResult["anchor"];
}

export interface SettlementReceiptForProof {
  id: string;
  referenceId: string;
  payer: string;
  payee: string;
  amount: number;
  asset: string;
  createdAt: string;
  receiptHash: string | null;
  leafIndex: number | null;
}

export function buildSettlementReceiptProof(
  receiptRow: SettlementReceiptForProof,
  batch: AnchorBatchRecord | null,
  batchReceiptHashes: `0x${string}`[],
): SettlementReceiptProofResult {
  const base: Pick<SettlementReceiptProofResult, "settlementId" | "receiptVersion"> = {
    settlementId: receiptRow.id,
    receiptVersion: SETTLEMENT_RECEIPT_VERSION,
  };

  if (!receiptRow.receiptHash) {
    return { ...base, status: "no_receipt" };
  }

  const receiptInput = {
    id: receiptRow.id,
    referenceId: receiptRow.referenceId,
    payer: receiptRow.payer,
    payee: receiptRow.payee,
    amount: receiptRow.amount,
    asset: receiptRow.asset,
    createdAt: receiptRow.createdAt,
  };

  const receipt = buildSettlementReceiptPayload(receiptInput);
  const receiptHash = hashSettlementReceipt(receiptInput);

  if (receiptHash !== receiptRow.receiptHash) {
    throw new Error(`Stored receipt hash mismatch for settlement ${receiptRow.id}`);
  }

  if (!batch || batch.status !== "anchored" || receiptRow.leafIndex === null) {
    return {
      ...base,
      status: "pending",
      receipt,
      receiptHash,
      leafIndex: receiptRow.leafIndex ?? undefined,
    };
  }

  const tree = buildReceiptMerkleTree(batchReceiptHashes);
  if (tree.root !== batch.merkleRoot) {
    throw new Error(`Merkle root mismatch for batch ${batch.id}`);
  }

  return {
    ...base,
    status: "anchored",
    receipt,
    receiptHash,
    leafIndex: receiptRow.leafIndex,
    merkleProof: tree.getProof(receiptRow.leafIndex),
    merkleRoot: batch.merkleRoot,
    anchor: {
      chainId: batch.chainId,
      contractAddress: batch.contractAddress,
      txHash: batch.txHash ?? "0x0",
      blockNumber: batch.blockNumber?.toString() ?? null,
      anchoredAt: batch.anchoredAt,
    },
  };
}
