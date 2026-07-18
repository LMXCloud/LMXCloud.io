import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ApiKeyStore } from "../auth/store.js";
import { roundCredits } from "../credits/pricing.js";
import type { PaymentEvent } from "../payments/types.js";
import type { PaymentStore } from "../payments/store.js";

interface PaymentRouteDeps {
  paymentStore: PaymentStore | null;
  apiKeyStore: ApiKeyStore;
  authenticate: preHandlerHookHandler;
  x402Enabled: boolean;
}

function parseDays(value: unknown): number {
  const parsed = Number(value ?? 30);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(Math.floor(parsed), 90);
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(Math.floor(parsed), 100);
}

function serializePayment(event: PaymentEvent) {
  return {
    object: "payment" as const,
    id: event.id,
    usage_event_id: event.usageEventId,
    api_key_id: event.apiKeyId,
    payer_wallet: event.payerWallet,
    quoted_amount: roundCredits(event.quotedAmount),
    settled_amount:
      event.settledAmount === null ? null : roundCredits(event.settledAmount),
    refunded_amount: roundCredits(event.refundedAmount),
    chain_id: event.chainId,
    tx_hash: event.txHash,
    model: event.model,
    route: event.route,
    estimated_tokens: event.estimatedTokens,
    status: event.status,
    failure_reason: event.failureReason,
    created_at: event.createdAt,
    verified_at: event.verifiedAt,
    settled_at: event.settledAt,
    completed_at: event.completedAt,
  };
}

export async function registerPaymentRoutes(
  app: FastifyInstance,
  deps: PaymentRouteDeps,
): Promise<void> {
  app.get<{ Querystring: { limit?: string; cursor?: string; days?: string } }>(
    "/v1/billing/payments",
    { preHandler: deps.authenticate },
    async (request) => {
      const limit = parseLimit(request.query.limit);
      const cursor = request.query.cursor?.trim() || undefined;
      const daysRaw = request.query.days;
      const days =
        daysRaw !== undefined && daysRaw !== ""
          ? parseDays(daysRaw)
          : undefined;

      if (!deps.paymentStore) {
        return {
          object: "list",
          x402_enabled: false,
          days: days ?? null,
          data: [],
          has_more: false,
          next_cursor: null,
        };
      }

      const keys = await deps.apiKeyStore.listForRecord(request.apiKey!);
      const apiKeyIds = keys.map((key) => key.id);
      const payerWallets = [
        ...new Set(
          keys
            .map((key) => key.wallet?.toLowerCase())
            .filter((wallet): wallet is string => Boolean(wallet)),
        ),
      ];

      const result = await deps.paymentStore.listForAccount(
        payerWallets,
        apiKeyIds,
        { limit, cursor, days },
      );

      return {
        object: "list",
        x402_enabled: deps.x402Enabled,
        days: days ?? null,
        data: result.data.map(serializePayment),
        has_more: result.hasMore,
        next_cursor: result.nextCursor,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/billing/payments/:id",
    async (request, reply) => {
      if (!deps.paymentStore) {
        return reply.status(503).send({
          error: {
            message: "x402 payments are not configured on this server",
            type: "configuration_error",
          },
        });
      }

      const payment = await deps.paymentStore.findById(request.params.id);
      if (!payment) {
        return reply.status(404).send({
          error: {
            message: "Payment not found",
            type: "invalid_request_error",
          },
        });
      }

      return serializePayment(payment);
    },
  );
}
