import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { CreditStore } from "../credits/store.js";
import { roundCredits } from "../credits/pricing.js";
import { MIN_DEPOSIT_USDC } from "../deposits/limits.js";
import type { DepositStore } from "../deposits/store.js";

interface BalanceRouteDeps {
  creditStore: CreditStore;
  authenticate: preHandlerHookHandler;
  depositStore?: DepositStore | null;
  depositInfo?: {
    treasuryAddress: string;
    usdcContractAddress: string;
    chain: string;
    chainId: number;
    token: string;
    confirmations: number;
    minDepositUsdc: number;
    maxDepositUsdc: number;
  };
}
interface TopUpBody {
  amount?: number;
}

function validateTopUpBody(body: unknown): TopUpBody | string {
  if (body === undefined || body === null) {
    return "Request body must include amount";
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  if (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount <= 0) {
    return "Field 'amount' must be a positive number";
  }

  return { amount: b.amount };
}

export async function registerBalanceRoutes(
  app: FastifyInstance,
  deps: BalanceRouteDeps,
): Promise<void> {
  app.get(
    "/v1/balance",
    { preHandler: deps.authenticate },
    async (request) => {
      const apiKeyId = request.apiKey!.id;
      const balance = await deps.creditStore.getBalance(apiKeyId);

      return {
        object: "balance",
        api_key_id: apiKeyId,
        balance: roundCredits(balance),
        currency: "USD",
      };
    },
  );

  if (deps.depositInfo) {
    app.get(
      "/v1/billing/deposit-info",
      { preHandler: deps.authenticate },
      async (request, reply) => {
        const record = request.apiKey!;
        if (!record.wallet) {
          return reply.status(400).send({
            error: {
              message: "Deposit funding requires a wallet-linked account",
              type: "invalid_request_error",
            },
          });
        }

        return {
          object: "deposit_info",
          treasury_address: deps.depositInfo!.treasuryAddress,
          usdc_contract_address: deps.depositInfo!.usdcContractAddress,
          chain: deps.depositInfo!.chain,
          chain_id: deps.depositInfo!.chainId,
          token: deps.depositInfo!.token,
          confirmations_required: deps.depositInfo!.confirmations,
          min_deposit_usdc: deps.depositInfo!.minDepositUsdc,
          max_deposit_usdc: deps.depositInfo!.maxDepositUsdc,
          wallet: record.wallet,
          note: `Send USDC on ${deps.depositInfo!.chain} from your verified wallet. Credits appear after confirmations.`,
        };
      },
    );

    if (deps.depositStore) {
      app.get(
        "/v1/billing/deposits",
        { preHandler: deps.authenticate },
        async (request, reply) => {
          const record = request.apiKey!;
          if (!record.wallet) {
            return reply.status(400).send({
              error: {
                message: "Deposit history requires a wallet-linked account",
                type: "invalid_request_error",
              },
            });
          }

          const deposits = await deps.depositStore!.listDepositsForWallet(
            record.wallet,
            record.id,
          );

          return {
            object: "list",
            chain: deps.depositInfo!.chain,
            confirmations_required: deps.depositInfo!.confirmations,
            data: deposits.map((deposit) => ({
              object: "deposit",
              tx_hash: deposit.txHash,
              amount: roundCredits(deposit.amountUsdc),
              currency: "USD",
              status: deposit.status,
              confirmations: deposit.confirmations,
              created_at: deposit.createdAt,
              credited_at: deposit.creditedAt,
            })),
          };
        },
      );
    }
  }
  const allowSelfTopUp = process.env.CREDITS_ALLOW_SELF_TOPUP === "true";

  if (allowSelfTopUp) {
    app.post<{ Body: unknown }>(
      "/v1/credits/topup",
      { preHandler: deps.authenticate },
      async (request, reply) => {
        const validated = validateTopUpBody(request.body);

        if (typeof validated === "string") {
          return reply.status(400).send({
            error: { message: validated, type: "invalid_request_error" },
          });
        }

        const balance = await deps.creditStore.credit(
          request.apiKey!.id,
          validated.amount!,
          { source: "dev_topup" },
        );

        return reply.status(200).send({
          object: "balance",
          api_key_id: request.apiKey!.id,
          balance: roundCredits(balance),
          currency: "USD",
          credited: roundCredits(validated.amount!),
        });
      },
    );
  }
}
