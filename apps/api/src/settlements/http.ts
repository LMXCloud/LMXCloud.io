import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { SettleResultContext } from "@x402/core/server";
import {
  buildSettlementReceiptPayload,
  canonicalizeSettlementReceipt,
  hashSettlementReceipt,
  type SettlementReceiptPayload,
} from "../anchors/receipt.js";
import {
  SETTLEMENT_PATH,
  SettlementRequestError,
  assertPaymentMatchesIntent,
  atomicUsdcToDecimal,
  parseSettlementBody,
  type SettlementIntent,
} from "./parse.js";
import type { AnchorStore } from "../anchors/store.js";
import type { SettlementReceiptProofResult } from "../anchors/proof.js";
import type { SettlementStore } from "./store.js";

export interface SettlementReceiptResponse {
  object: "settlement_receipt";
  receipt: SettlementReceiptPayload;
  receipt_hash: `0x${string}`;
  tx_hash: string | null;
  chain_id: number;
}

const intents = new WeakMap<FastifyRequest, SettlementIntent>();
const results = new WeakMap<
  FastifyRequest,
  SettlementReceiptResponse | { error: string }
>();

function payerFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const body = payload as {
    permit2Authorization?: { from?: string };
    authorization?: { from?: string };
  };
  const from = body.permit2Authorization?.from ?? body.authorization?.from;
  return from?.toLowerCase();
}

function requestFromTransport(transportContext: unknown): FastifyRequest | undefined {
  const http = transportContext as {
    request?: { adapter?: { request?: FastifyRequest } };
  };
  return http?.request?.adapter?.request;
}

export async function persistSettledReceipt(
  store: SettlementStore,
  context: SettleResultContext,
  options: {
    chainId: number;
    usdcContractAddress: string;
    log: (err: unknown, msg: string) => void;
  },
): Promise<void> {
  if (!context.result.success) return;

  const request = requestFromTransport(context.transportContext);
  if (!request) {
    options.log(new Error("missing request"), "settlement receipt request missing");
    return;
  }

  const intent = intents.get(request);
  if (!intent) {
    options.log(new Error("missing intent"), "settlement receipt intent missing");
    results.set(request, { error: "Settlement request was missing its payment details" });
    return;
  }

  try {
    assertPaymentMatchesIntent(
      intent,
      context.requirements,
      options.usdcContractAddress,
    );
  } catch (err) {
    options.log(err, "settled payment did not match the staged intent");
    results.set(request, { error: "Settled payment did not match the request" });
    return;
  }

  const atomic = context.result.amount ?? context.requirements.amount;
  const payer = (
    context.result.payer ?? payerFromPayload(context.paymentPayload.payload)
  )?.toLowerCase();
  if (!payer || !atomic) {
    options.log(new Error("missing payer or amount"), "settlement receipt missing payer or amount");
    results.set(request, { error: "Settlement result was missing payer or amount" });
    return;
  }

  const createdAt = new Date().toISOString();
  const input = {
    id: randomUUID(),
    referenceId: intent.reference,
    payer,
    payee: getAddress(context.requirements.payTo).toLowerCase(),
    amount: atomicUsdcToDecimal(atomic),
    asset: intent.asset,
    createdAt,
  };
  const receipt = buildSettlementReceiptPayload(input);
  const payloadJson = canonicalizeSettlementReceipt(receipt);
  const receiptHash = hashSettlementReceipt(input);
  const txHash = context.result.transaction || null;

  try {
    await store.insert({
      id: input.id,
      referenceId: input.referenceId,
      payer: input.payer,
      payee: input.payee,
      amount: input.amount,
      asset: input.asset,
      createdAt,
      payloadJson,
      receiptHash,
      txHash,
      chainId: options.chainId,
    });
  } catch (err) {
    options.log(err, "settlement receipt insert failed");
    results.set(request, { error: "Settlement receipt could not be stored" });
    return;
  }

  results.set(request, {
    object: "settlement_receipt",
    receipt,
    receipt_hash: receiptHash,
    tx_hash: txHash,
    chain_id: options.chainId,
  });
}

function replaceJson(reply: FastifyReply, status: number, body: unknown): string {
  const json = JSON.stringify(body);
  reply.status(status);
  reply.type("application/json");
  reply.header("content-length", Buffer.byteLength(json));
  return json;
}

export function registerSettlementRoutes(
  app: FastifyInstance,
  deps: { store: SettlementStore; usdcContractAddress: string },
): void {
  app.post(SETTLEMENT_PATH, async (request) => {
    if (!request.x402Context) {
      throw new SettlementRequestError(
        "Payment required",
        "x402_payment_required",
        402,
      );
    }

    const intent = parseSettlementBody(request.body);
    assertPaymentMatchesIntent(
      intent,
      request.x402Context.paymentRequirements,
      deps.usdcContractAddress,
    );
    intents.set(request, intent);
    return { object: "settlement_receipt", status: "settling" };
  });

  app.get<{ Params: { id: string } }>(
    `${SETTLEMENT_PATH}/:id`,
    async (request, reply) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          request.params.id,
        )
      ) {
        return reply.status(404).send({
          error: {
            message: "Settlement receipt not found",
            type: "not_found",
            code: "not_found",
          },
        });
      }

      const row = await deps.store.getById(request.params.id);
      if (!row) {
        return reply.status(404).send({
          error: {
            message: "Settlement receipt not found",
            type: "not_found",
            code: "not_found",
          },
        });
      }

      const body: SettlementReceiptResponse = {
        object: "settlement_receipt",
        receipt: row.payload,
        receipt_hash: row.receiptHash,
        tx_hash: row.txHash,
        chain_id: row.chainId,
      };
      return body;
    },
  );

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "POST") return payload;
    if (request.url.split("?")[0] !== SETTLEMENT_PATH) return payload;
    if (reply.statusCode !== 200) return payload;

    const staged = results.get(request);
    if (!staged || "error" in staged) {
      const message =
        staged && "error" in staged
          ? staged.error
          : "Settlement receipt was not produced";
      return replaceJson(reply, 500, {
        error: {
          message,
          type: "internal_error",
          code: "receipt_failed",
        },
      });
    }

    return replaceJson(reply, 200, staged);
  });
}

function serializeSettlementProof(proof: SettlementReceiptProofResult) {
  return {
    object: "settlement_receipt_proof" as const,
    settlement_id: proof.settlementId,
    status: proof.status,
    receipt_version: proof.receiptVersion,
    receipt: proof.receipt ?? null,
    receipt_hash: proof.receiptHash ?? null,
    leaf_index: proof.leafIndex ?? null,
    merkle_proof: proof.merkleProof ?? null,
    merkle_root: proof.merkleRoot ?? null,
    anchor: proof.anchor
      ? {
          chain_id: proof.anchor.chainId,
          contract_address: proof.anchor.contractAddress,
          tx_hash: proof.anchor.txHash,
          block_number: proof.anchor.blockNumber,
          anchored_at: proof.anchor.anchoredAt,
        }
      : null,
  };
}

function isAnchorTxHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

async function contractAddressFromAnchorTx(
  txHash: `0x${string}`,
  chainId: number,
  rpcUrl: string,
): Promise<`0x${string}` | null> {
  const chain = chainId === baseSepolia.id ? baseSepolia : chainId === base.id ? base : null;
  if (!chain) return null;

  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const tx = await client.getTransaction({ hash: txHash });
  if (!tx.to || !isAddress(tx.to)) return null;
  return getAddress(tx.to);
}

export async function registerSettlementProofRoute(
  app: FastifyInstance,
  deps: {
    anchorStore?: AnchorStore | null;
    anchorContractAddress?: `0x${string}`;
    rpcUrl?: string;
  },
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    // Settlement UUID or receipt hash (0x + 64 hex). Public, no auth.
    `${SETTLEMENT_PATH}/:id/proof`,
    async (request, reply) => {
      if (!deps.anchorStore) {
        return reply.status(503).send({
          error: {
            message: "Proof lookup requires Postgres storage on this server",
            type: "configuration_error",
          },
        });
      }

      const proof = await deps.anchorStore.getSettlementProof(request.params.id);

      if (!proof) {
        return reply.status(404).send({
          error: {
            message: "Settlement receipt not found",
            type: "invalid_request_error",
          },
        });
      }

      if (
        proof.anchor &&
        !proof.anchor.contractAddress &&
        deps.rpcUrl &&
        isAnchorTxHash(proof.anchor.txHash)
      ) {
        try {
          const recorded = await contractAddressFromAnchorTx(
            proof.anchor.txHash,
            proof.anchor.chainId,
            deps.rpcUrl,
          );
          if (recorded) {
            proof.anchor.contractAddress = recorded;
            await deps.anchorStore.recordBatchContractAddress(proof.anchor.txHash, recorded);
          }
        } catch (err) {
          request.log.warn(
            { err },
            "Could not read the contract address from the anchor transaction",
          );
        }
      }

      return {
        ...serializeSettlementProof(proof),
        anchoring_enabled: Boolean(deps.anchorContractAddress),
      };
    },
  );
}
