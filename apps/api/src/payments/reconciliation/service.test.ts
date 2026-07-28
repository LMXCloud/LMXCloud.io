import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaymentEvent } from "../types.js";
import {
  balanceCreditBackIdempotencyKey,
  paymentWasSettledOnChain,
  planX402Reconciliation,
  x402RefundIdempotencyKey,
} from "./logic.js";
import { PaymentReconciler } from "./service.js";
import type { ReconciliationEvent } from "./types.js";

function basePayment(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    id: "pay-1",
    usageEventId: null,
    apiKeyId: null,
    payerWallet: "0xabc1234567890123456789012345678901234567",
    quotedAmount: 0.01,
    settledAmount: null,
    refundedAmount: 0,
    chainId: 8453,
    txHash: null,
    paymentPayloadHash: "hash",
    facilitatorRef: null,
    model: "llama-3-70b",
    route: "chat/completions",
    estimatedTokens: 100,
    status: "fulfilling",
    failureReason: null,
    createdAt: new Date().toISOString(),
    verifiedAt: null,
    settledAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("paymentWasSettledOnChain", () => {
  it("is false when no settlement fields exist", () => {
    assert.equal(paymentWasSettledOnChain(basePayment()), false);
  });

  it("is true when settled with tx hash", () => {
    assert.equal(
      paymentWasSettledOnChain(
        basePayment({
          status: "settled",
          settledAmount: 0.01,
          txHash: "0xdead",
        }),
      ),
      true,
    );
  });
});

describe("planX402Reconciliation", () => {
  it("marks fulfilling payments as failed without on-chain refund", () => {
    const plan = planX402Reconciliation(
      basePayment({ status: "fulfilling" }),
      "inference_failed",
      { autoMaxUsdc: 5 },
      true,
      null,
      true,
    );
    assert.deepEqual(plan, {
      action: "mark_failed",
      reason: "inference_failed",
    });
  });

  it("queues on-chain refund for settled payments without successful usage", () => {
    const plan = planX402Reconciliation(
      basePayment({
        status: "settled",
        settledAmount: 0.02,
        txHash: "0xbeef",
      }),
      "delivery_failed",
      { autoMaxUsdc: 5 },
      true,
      false,
      true,
    );
    assert.deepEqual(plan, {
      action: "on_chain_refund",
      amount: 0.02,
      auto: true,
      reason: "delivery_failed",
    });
  });

  it("requires manual approval above auto max", () => {
    const plan = planX402Reconciliation(
      basePayment({
        status: "settled",
        settledAmount: 10,
        txHash: "0xbeef",
      }),
      "delivery_failed",
      { autoMaxUsdc: 5 },
      true,
      false,
      true,
    );
    assert.equal(plan.action, "on_chain_refund");
    if (plan.action === "on_chain_refund") {
      assert.equal(plan.auto, false);
    }
  });

  it("does not refund settled payments without confirmed delivery failure", () => {
    const plan = planX402Reconciliation(
      basePayment({
        status: "settled",
        settledAmount: 0.02,
        txHash: "0xbeef",
      }),
      "settled_without_usage",
      { autoMaxUsdc: 5 },
      true,
      null,
      false,
    );
    assert.deepEqual(plan, {
      action: "none",
      reason: "delivery_outcome_unknown",
    });
  });

  it("skips when usage was successful", () => {
    const plan = planX402Reconciliation(
      basePayment({
        status: "completed",
        usageEventId: "usage-1",
        settledAmount: 0.01,
        txHash: "0xbeef",
      }),
      "delivery_failed",
      { autoMaxUsdc: 5 },
      true,
      true,
      true,
    );
    assert.deepEqual(plan, { action: "none", reason: "usage_successful" });
  });
});

describe("idempotency keys", () => {
  it("stabilizes balance and x402 keys", () => {
    assert.equal(
      balanceCreditBackIdempotencyKey("key-1", "req-9"),
      "balance:key-1:req-9",
    );
    assert.equal(x402RefundIdempotencyKey("pay-1"), "x402:pay-1");
  });
});

describe("PaymentReconciler balance credit-back", () => {
  it("credits balance and marks reconciliation completed", async () => {
    const credits: Array<{ apiKeyId: string; amount: number }> = [];
    const records = new Map<string, ReconciliationEvent>();

    const reconciler = new PaymentReconciler({
      paymentStore: null,
      creditStore: {
        getBalance: async () => 1,
        hasMinimumBalance: async () => true,
        deduct: async () => true,
        credit: async (apiKeyId, amount) => {
          credits.push({ apiKeyId, amount });
          return 1 + amount;
        },
      },
      reconciliationStore: {
        findByIdempotencyKey: async (key) => records.get(key) ?? null,
        findById: async (id) =>
          [...records.values()].find((r) => r.id === id) ?? null,
        create: async (input) => {
          const event: ReconciliationEvent = {
            id: `rec-${records.size + 1}`,
            kind: input.kind,
            paymentEventId: input.paymentEventId ?? null,
            apiKeyId: input.apiKeyId ?? null,
            usageEventId: input.usageEventId ?? null,
            amount: input.amount,
            status: input.status ?? "pending",
            reason: input.reason,
            failureDetail: null,
            refundTxHash: null,
            idempotencyKey: input.idempotencyKey,
            createdAt: new Date().toISOString(),
            completedAt: null,
          };
          records.set(event.idempotencyKey, event);
          return event;
        },
        updateStatus: async (id, status, fields) => {
          const event = [...records.values()].find((r) => r.id === id);
          if (!event) return null;
          event.status = status;
          if (fields?.refundTxHash) event.refundTxHash = fields.refundTxHash;
          if (fields?.failureDetail) event.failureDetail = fields.failureDetail;
          if (status === "completed") event.completedAt = new Date().toISOString();
          return event;
        },
        listPendingManual: async () => [],
        listRecent: async () => [...records.values()],
      },
      treasuryWallet: null,
      config: {
        enabled: true,
        autoMaxUsdc: 5,
        pollIntervalMs: 60_000,
        graceMinutes: 2,
      },
    });

    await reconciler.reconcileBalanceCreditBack({
      apiKeyId: "key-1",
      amount: 0.004,
      reason: "stream_error",
      requestId: "req-42",
    });

    assert.deepEqual(credits, [{ apiKeyId: "key-1", amount: 0.004 }]);
    const stored = records.get("balance:key-1:req-42");
    assert.equal(stored?.status, "completed");
  });
});

describe("PaymentReconciler x402 refund", () => {
  it("calls markRefunded after treasury transfer", async () => {
    let refunded: { id: string; amount: number; txHash?: string } | null = null;
    const records = new Map<string, ReconciliationEvent>();

    const payment = basePayment({
      id: "pay-99",
      status: "settled",
      settledAmount: 0.01,
      txHash: "0xsettle",
    });

    const reconciler = new PaymentReconciler({
      paymentStore: {
        createQuoted: async () => payment,
        findByPayloadHash: async () => payment,
        findById: async () => payment,
        listForAccount: async () => ({ data: [], hasMore: false, nextCursor: null }),
        markVerified: async () => payment,
        markSettled: async () => payment,
        tryClaimForFulfillment: async () => payment,
        markCompleted: async () => payment,
        markFailed: async () => payment,
        markRefunded: async (id, amount, txHash) => {
          refunded = { id, amount, txHash };
          return { ...payment, status: "refunded", refundedAmount: amount, txHash: txHash ?? null };
        },
      },
      creditStore: {
        getBalance: async () => 0,
        hasMinimumBalance: async () => false,
        deduct: async () => false,
        credit: async () => 0,
      },
      reconciliationStore: {
        findByIdempotencyKey: async (key) => records.get(key) ?? null,
        findById: async (id) =>
          [...records.values()].find((r) => r.id === id) ?? null,
        create: async (input) => {
          const event: ReconciliationEvent = {
            id: "rec-x402",
            kind: input.kind,
            paymentEventId: input.paymentEventId ?? null,
            apiKeyId: null,
            usageEventId: null,
            amount: input.amount,
            status: input.status ?? "pending",
            reason: input.reason,
            failureDetail: null,
            refundTxHash: null,
            idempotencyKey: input.idempotencyKey,
            createdAt: new Date().toISOString(),
            completedAt: null,
          };
          records.set(event.idempotencyKey, event);
          return event;
        },
        updateStatus: async (id, status, fields) => {
          const event = [...records.values()].find((r) => r.id === id);
          if (!event) return null;
          event.status = status;
          if (fields?.refundTxHash) event.refundTxHash = fields.refundTxHash;
          return event;
        },
        listPendingManual: async () => [],
        listRecent: async () => [...records.values()],
      },
      treasuryWallet: {
        transferUsdc: async () => "0xrefund" as `0x${string}`,
      },
      config: {
        enabled: true,
        autoMaxUsdc: 5,
        pollIntervalMs: 60_000,
        graceMinutes: 2,
      },
    });

    await reconciler.reconcileX402Failure("pay-99", "inference_failed");

    assert.deepEqual(refunded, {
      id: "pay-99",
      amount: 0.01,
      txHash: "0xrefund",
    });
    assert.equal(records.get("x402:pay-99")?.status, "completed");
    assert.equal(records.get("x402:pay-99")?.refundTxHash, "0xrefund");
  });

  it("calls markFailed when settlement never happened", async () => {
    let failedReason: string | null = null;
    const payment = basePayment({ id: "pay-100", status: "fulfilling" });
    const records = new Map<string, ReconciliationEvent>();

    const reconciler = new PaymentReconciler({
      paymentStore: {
        createQuoted: async () => payment,
        findByPayloadHash: async () => payment,
        findById: async () => payment,
        listForAccount: async () => ({ data: [], hasMore: false, nextCursor: null }),
        markVerified: async () => payment,
        markSettled: async () => payment,
        tryClaimForFulfillment: async () => payment,
        markCompleted: async () => payment,
        markFailed: async (_id, reason) => {
          failedReason = reason;
          return payment;
        },
        markRefunded: async () => payment,
      },
      creditStore: {
        getBalance: async () => 0,
        hasMinimumBalance: async () => false,
        deduct: async () => false,
        credit: async () => 0,
      },
      reconciliationStore: {
        findByIdempotencyKey: async (key) => records.get(key) ?? null,
        findById: async () => null,
        create: async (input) => {
          const event: ReconciliationEvent = {
            id: "rec-fail",
            kind: input.kind,
            paymentEventId: input.paymentEventId ?? null,
            apiKeyId: null,
            usageEventId: null,
            amount: input.amount,
            status: input.status ?? "pending",
            reason: input.reason,
            failureDetail: null,
            refundTxHash: null,
            idempotencyKey: input.idempotencyKey,
            createdAt: new Date().toISOString(),
            completedAt: null,
          };
          records.set(event.idempotencyKey, event);
          return event;
        },
        updateStatus: async () => null,
        listPendingManual: async () => [],
        listRecent: async () => [],
      },
      treasuryWallet: null,
      config: {
        enabled: true,
        autoMaxUsdc: 5,
        pollIntervalMs: 60_000,
        graceMinutes: 2,
      },
    });

    await reconciler.reconcileX402Failure("pay-100", "provider_error");

    assert.equal(failedReason, "provider_error");
    assert.equal(records.get("x402:pay-100")?.status, "completed");
  });
});
