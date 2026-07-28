import type { PaymentEvent } from "../types.js";
import type { ReconciliationConfig } from "./types.js";

export type X402ReconciliationPlan =
  | { action: "none"; reason: string }
  | { action: "mark_failed"; reason: string }
  | { action: "on_chain_refund"; amount: number; auto: boolean; reason: string };

export function paymentWasSettledOnChain(payment: PaymentEvent): boolean {
  return (
    payment.settledAmount != null &&
    payment.settledAmount > 0 &&
    payment.txHash != null &&
    (payment.status === "settled" || payment.status === "completed")
  );
}

export function planX402Reconciliation(
  payment: PaymentEvent,
  reason: string,
  config: Pick<ReconciliationConfig, "autoMaxUsdc">,
  treasuryWalletReady: boolean,
  usageSuccessful: boolean | null,
  deliveryFailed: boolean,
): X402ReconciliationPlan {
  if (payment.status === "refunded") {
    return { action: "none", reason: "already_refunded" };
  }

  if (usageSuccessful === true) {
    return { action: "none", reason: "usage_successful" };
  }

  if (!deliveryFailed) {
    return { action: "none", reason: "delivery_outcome_unknown" };
  }

  if (!paymentWasSettledOnChain(payment)) {
    if (payment.status === "failed") {
      return { action: "none", reason: "already_failed" };
    }
    return { action: "mark_failed", reason };
  }

  const amount = payment.settledAmount ?? payment.quotedAmount;
  const auto = amount <= config.autoMaxUsdc && treasuryWalletReady;
  return { action: "on_chain_refund", amount, auto, reason };
}

export function balanceCreditBackIdempotencyKey(
  apiKeyId: string,
  requestId: string,
): string {
  return `balance:${apiKeyId}:${requestId}`;
}

export function x402RefundIdempotencyKey(paymentId: string): string {
  return `x402:${paymentId}`;
}
