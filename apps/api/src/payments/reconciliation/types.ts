export type ReconciliationKind = "x402_refund" | "balance_credit_back";

export type ReconciliationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "manual_required";

export interface ReconciliationEvent {
  id: string;
  kind: ReconciliationKind;
  paymentEventId: string | null;
  apiKeyId: string | null;
  usageEventId: string | null;
  amount: number;
  status: ReconciliationStatus;
  reason: string;
  failureDetail: string | null;
  refundTxHash: string | null;
  idempotencyKey: string;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateReconciliationInput {
  kind: ReconciliationKind;
  paymentEventId?: string;
  apiKeyId?: string;
  usageEventId?: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  status?: ReconciliationStatus;
  failureDetail?: string;
}

export interface ReconciliationConfig {
  enabled: boolean;
  autoMaxUsdc: number;
  pollIntervalMs: number;
  graceMinutes: number;
  treasuryPrivateKey?: `0x${string}`;
  rpcUrl?: string;
  usdcContractAddress?: `0x${string}`;
  chainId?: number;
}
