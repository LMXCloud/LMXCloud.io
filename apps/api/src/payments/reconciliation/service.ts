import type { CreditStore } from "../../credits/store.js";
import { getPool } from "../../db/pool.js";
import type { PaymentStore } from "../store.js";
import type { PaymentEvent } from "../types.js";
import {
  balanceCreditBackIdempotencyKey,
  planX402Reconciliation,
  x402RefundIdempotencyKey,
} from "./logic.js";
import type { ReconciliationStore } from "./store.js";
import type { TreasuryRefundClient } from "./treasury-wallet.js";
import type { ReconciliationConfig } from "./types.js";

export interface PaymentReconcilerDeps {
  paymentStore: PaymentStore | null;
  creditStore: CreditStore;
  reconciliationStore: ReconciliationStore | null;
  treasuryWallet: TreasuryRefundClient | null;
  config: ReconciliationConfig;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export class PaymentReconciler {
  constructor(private readonly deps: PaymentReconcilerDeps) {}

  async reconcileBalanceCreditBack(input: {
    apiKeyId: string;
    amount: number;
    reason: string;
    requestId: string;
    usageEventId?: string;
  }): Promise<void> {
    if (!this.deps.config.enabled || input.amount <= 0) return;
    if (!this.deps.reconciliationStore) return;

    const idempotencyKey = balanceCreditBackIdempotencyKey(
      input.apiKeyId,
      input.requestId,
    );
    const existing = await this.deps.reconciliationStore.findByIdempotencyKey(
      idempotencyKey,
    );
    if (existing?.status === "completed") return;

    const record =
      existing ??
      (await this.deps.reconciliationStore.create({
        kind: "balance_credit_back",
        apiKeyId: input.apiKeyId,
        usageEventId: input.usageEventId,
        amount: input.amount,
        reason: input.reason,
        idempotencyKey,
        status: "processing",
      }));

    if (record.status === "completed") return;

    try {
      await this.deps.reconciliationStore.updateStatus(record.id, "processing");
      const balanceAfter = await this.deps.creditStore.credit(
        input.apiKeyId,
        input.amount,
        { source: "delivery_failure_refund", detail: input.reason },
      );
      await this.deps.reconciliationStore.updateStatus(record.id, "completed");
      this.deps.log?.("balance credit-back completed", {
        apiKeyId: input.apiKeyId,
        amount: input.amount,
        balanceAfter,
        idempotencyKey,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.deps.reconciliationStore.updateStatus(record.id, "failed", {
        failureDetail: detail,
      });
      this.deps.log?.("balance credit-back failed", {
        apiKeyId: input.apiKeyId,
        amount: input.amount,
        error: detail,
      });
    }
  }

  async reconcileX402Failure(
    paymentId: string,
    reason: string,
    deliveryFailed = true,
  ): Promise<void> {
    if (!this.deps.config.enabled || !this.deps.paymentStore) return;
    if (!this.deps.reconciliationStore) return;

    const payment = await this.deps.paymentStore.findById(paymentId);
    if (!payment) return;

    const usageSuccessful = await this.loadUsageSuccess(payment);
    const plan = planX402Reconciliation(
      payment,
      reason,
      this.deps.config,
      this.deps.treasuryWallet != null,
      usageSuccessful,
      deliveryFailed,
    );

    if (plan.action === "none") return;

    const idempotencyKey = x402RefundIdempotencyKey(paymentId);
    const existing = await this.deps.reconciliationStore.findByIdempotencyKey(
      idempotencyKey,
    );
    if (existing?.status === "completed") return;

    if (plan.action === "mark_failed") {
      await this.deps.paymentStore.markFailed(paymentId, plan.reason);
      if (!existing) {
        await this.deps.reconciliationStore.create({
          kind: "x402_refund",
          paymentEventId: paymentId,
          amount: 0,
          reason: plan.reason,
          idempotencyKey,
          status: "completed",
        });
      } else {
        await this.deps.reconciliationStore.updateStatus(existing.id, "completed");
      }
      return;
    }

    const record =
      existing ??
      (await this.deps.reconciliationStore.create({
        kind: "x402_refund",
        paymentEventId: paymentId,
        amount: plan.amount,
        reason: plan.reason,
        idempotencyKey,
        status: plan.auto ? "pending" : "manual_required",
      }));

    if (record.status === "completed") return;

    if (!plan.auto) {
      if (record.status !== "manual_required") {
        await this.deps.reconciliationStore.updateStatus(
          record.id,
          "manual_required",
        );
      }
      this.deps.log?.("x402 refund queued for manual approval", {
        paymentId,
        amount: plan.amount,
      });
      return;
    }

    await this.executeX402Refund(record.id, payment, plan.amount);
  }

  async executeManualReconciliation(reconciliationId: string): Promise<{
    status: "completed" | "failed";
    refundTxHash?: string;
    error?: string;
  }> {
    if (!this.deps.reconciliationStore || !this.deps.paymentStore) {
      return { status: "failed", error: "reconciliation store unavailable" };
    }
    if (!this.deps.treasuryWallet) {
      return { status: "failed", error: "treasury wallet not configured" };
    }

    const record = await this.deps.reconciliationStore.findById(reconciliationId);
    if (!record) {
      return { status: "failed", error: "reconciliation not found" };
    }
    if (record.status === "completed") {
      return { status: "completed", refundTxHash: record.refundTxHash ?? undefined };
    }
    if (record.kind !== "x402_refund" || !record.paymentEventId) {
      return { status: "failed", error: "only x402 refunds can be executed manually" };
    }

    const payment = await this.deps.paymentStore.findById(record.paymentEventId);
    if (!payment) {
      return { status: "failed", error: "payment not found" };
    }

    try {
      const txHash = await this.executeX402Refund(
        record.id,
        payment,
        record.amount,
      );
      return { status: "completed", refundTxHash: txHash };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { status: "failed", error };
    }
  }

  private async executeX402Refund(
    reconciliationId: string,
    payment: PaymentEvent,
    amount: number,
  ): Promise<string> {
    if (!this.deps.paymentStore || !this.deps.reconciliationStore) {
      throw new Error("stores unavailable");
    }
    if (!this.deps.treasuryWallet) {
      throw new Error("treasury wallet not configured");
    }

    await this.deps.reconciliationStore.updateStatus(
      reconciliationId,
      "processing",
    );

    try {
      const to = payment.payerWallet as `0x${string}`;
      const txHash = await this.deps.treasuryWallet.transferUsdc(to, amount);
      const refunded = await this.deps.paymentStore.markRefunded(
        payment.id,
        amount,
        txHash,
      );
      if (!refunded) {
        throw new Error(`payment ${payment.id} could not be marked refunded`);
      }
      await this.deps.reconciliationStore.updateStatus(
        reconciliationId,
        "completed",
        { refundTxHash: txHash },
      );
      this.deps.log?.("x402 on-chain refund completed", {
        paymentId: payment.id,
        amount,
        txHash,
      });
      return txHash;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.deps.reconciliationStore.updateStatus(
        reconciliationId,
        "failed",
        { failureDetail: detail },
      );
      throw err;
    }
  }

  private async loadUsageSuccess(
    payment: PaymentEvent,
  ): Promise<boolean | null> {
    if (!payment.usageEventId || !process.env.DATABASE_URL) return null;

    const result = await getPool().query<{ success: boolean }>(
      `SELECT success FROM usage_events WHERE id = $1`,
      [payment.usageEventId],
    );
    return result.rows[0]?.success ?? null;
  }
}

export function createPaymentReconciler(
  deps: PaymentReconcilerDeps,
): PaymentReconciler {
  return new PaymentReconciler(deps);
}
