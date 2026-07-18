export type PaymentEventStatus =
  | "quoted"
  | "verified"
  | "fulfilling"
  | "settled"
  | "completed"
  | "failed"
  | "refunded";

export interface PaymentEvent {
  id: string;
  usageEventId: string | null;
  apiKeyId: string | null;
  payerWallet: string;
  quotedAmount: number;
  settledAmount: number | null;
  refundedAmount: number;
  chainId: number;
  txHash: string | null;
  paymentPayloadHash: string;
  facilitatorRef: string | null;
  model: string;
  route: string;
  estimatedTokens: number | null;
  status: PaymentEventStatus;
  failureReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
}

export interface CreateQuotedPaymentInput {
  payerWallet: string;
  quotedAmount: number;
  chainId: number;
  paymentPayloadHash: string;
  model: string;
  route?: string;
  estimatedTokens?: number;
  apiKeyId?: string;
}

export interface PaymentsListQuery {
  limit: number;
  cursor?: string;
  days?: number;
}

export interface PaymentsListResult {
  data: PaymentEvent[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Sprint 2 implements this against the CDP facilitator. */
export interface PaymentVerifier {
  verify(
    payload: unknown,
    requirements: unknown,
  ): Promise<{ valid: boolean; invalidReason?: string }>;
  settle(
    payload: unknown,
    requirements: unknown,
  ): Promise<{ txHash: string; facilitatorRef?: string }>;
}
