/**
 * Settle a USDC payment from one test wallet to another through Grid.
 *
 * Phase 1 (no --pay): expects HTTP 402 naming the payee and amount.
 * Phase 2 (--pay): signs an exact x402 payment, expects a settlement receipt
 * whose hash matches the canonical payload, and checks the payee balance.
 *
 * Usage:
 *   pnpm test:x402:settlement
 *   API_URL=http://localhost:3000 PAYER_PRIVATE_KEY=0x... pnpm test:x402:settlement -- --pay
 *
 * PAYEE_ADDRESS is optional. When omitted, --pay generates a fresh payee key
 * and prints only the address.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, formatUnits, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { hashSettlementReceipt } from "../src/anchors/receipt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 84532);
const NETWORK = `eip155:${CHAIN_ID}` as const;
const RPC_URL = process.env.BASE_RPC_URL;
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS as `0x${string}` | undefined;
const PAY = process.argv.includes("--pay");
const AMOUNT = process.env.SETTLEMENT_AMOUNT_USDC ?? "0.001";
const REFERENCE =
  process.env.SETTLEMENT_REFERENCE ?? `grid-settlement-${Date.now()}`;

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function chainForId(chainId: number) {
  return chainId === 84532 ? baseSepolia : base;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "PAYER_PRIVATE_KEY must be 64 hex characters (with or without 0x prefix)",
    );
  }
  return `0x${hex}`;
}

function settlementBody(payee: string): string {
  return JSON.stringify({
    payee,
    amount: AMOUNT,
    asset: "USDC",
    reference: REFERENCE,
  });
}

async function postSettlement(
  payee: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${API_URL}/v1/settlements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: settlementBody(payee),
  });
}

interface SettlementReceiptResponse {
  object: string;
  receipt: {
    id: string;
    reference_id: string;
    payer: string;
    payee: string;
    amount: string;
    asset: string;
    created_at: string;
  };
  receipt_hash: `0x${string}`;
  tx_hash: string | null;
  chain_id: number;
}

function isReceipt(value: unknown): value is SettlementReceiptResponse {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Partial<SettlementReceiptResponse>;
  return body.object === "settlement_receipt" && typeof body.receipt_hash === "string";
}

async function unpaid(payee: string): Promise<void> {
  const response = await postSettlement(payee);
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ status: response.status, body }, null, 2));
  if (response.status !== 402) {
    throw new Error(`Expected 402 from POST /v1/settlements, got ${response.status}`);
  }
  console.log("x402 settlement challenge: OK");
}

async function usdcBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

async function paid(): Promise<void> {
  const privateKeyRaw = process.env.PAYER_PRIVATE_KEY;
  if (!privateKeyRaw) throw new Error("PAYER_PRIVATE_KEY is required for --pay");
  if (!RPC_URL) throw new Error("BASE_RPC_URL is required for --pay");
  if (!USDC_ADDRESS) throw new Error("USDC_CONTRACT_ADDRESS is required for --pay");

  const payerAccount = privateKeyToAccount(normalizePrivateKey(privateKeyRaw));
  const payeeAccount = process.env.PAYEE_ADDRESS
    ? { address: process.env.PAYEE_ADDRESS as `0x${string}` }
    : privateKeyToAccount(generatePrivateKey());
  const payee = payeeAccount.address;

  const chain = chainForId(CHAIN_ID);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const payerBalance = await usdcBalance(publicClient, USDC_ADDRESS, payerAccount.address);
  const payeeBefore = await usdcBalance(publicClient, USDC_ADDRESS, payee);
  const required = BigInt(Math.round(Number(AMOUNT) * 1_000_000));

  console.log(
    JSON.stringify({
      payer: payerAccount.address,
      payee,
      payerUsdc: formatUnits(payerBalance, 6),
      payeeUsdcBefore: formatUnits(payeeBefore, 6),
      amount: AMOUNT,
      reference: REFERENCE,
    }),
  );

  if (payerBalance < required) {
    throw new Error(
      `Payer needs at least ${AMOUNT} USDC on ${chain.name}. Balance is ${formatUnits(payerBalance, 6)}.`,
    );
  }

  const signer = toClientEvmSigner(
    {
      address: payerAccount.address,
      signTypedData: (msg) => payerAccount.signTypedData(msg),
    },
    publicClient,
  );
  const client = new x402Client();
  client.register(NETWORK, new ExactEvmScheme(signer));
  const httpClient = new x402HTTPClient(client);

  const initial = await postSettlement(payee);
  const initialBody = await initial.json().catch(() => ({}));
  if (initial.status !== 402) {
    throw new Error(
      `Expected 402, got ${initial.status}: ${JSON.stringify(initialBody)}`,
    );
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name),
    initialBody,
  );
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const paidResponse = await postSettlement(payee, paymentHeaders);
  const paidBody: unknown = await paidResponse.json().catch(() => ({}));
  let settlement: unknown = null;
  try {
    settlement = httpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
  } catch {
    settlement = null;
  }

  console.log(
    JSON.stringify(
      {
        status: paidResponse.status,
        settlement,
        body: paidBody,
      },
      null,
      2,
    ),
  );

  if (paidResponse.status !== 200 || !isReceipt(paidBody)) {
    throw new Error(`Paid settlement failed with ${paidResponse.status}`);
  }

  const recomputed = hashSettlementReceipt({
    id: paidBody.receipt.id,
    referenceId: paidBody.receipt.reference_id,
    payer: paidBody.receipt.payer,
    payee: paidBody.receipt.payee,
    amount: Number(paidBody.receipt.amount),
    asset: paidBody.receipt.asset,
    createdAt: paidBody.receipt.created_at,
  });
  if (recomputed !== paidBody.receipt_hash) {
    throw new Error(
      `Receipt hash mismatch.\n  response: ${paidBody.receipt_hash}\n  recomputed: ${recomputed}`,
    );
  }
  if (paidBody.receipt.payer !== payerAccount.address.toLowerCase()) {
    throw new Error(`Receipt payer ${paidBody.receipt.payer} is not the signing wallet`);
  }
  if (paidBody.receipt.payee !== payee.toLowerCase()) {
    throw new Error(`Receipt payee ${paidBody.receipt.payee} is not the destination wallet`);
  }
  if (paidBody.receipt.reference_id !== REFERENCE) {
    throw new Error("Receipt reference does not match the request");
  }
  if (!paidBody.tx_hash?.startsWith("0x")) {
    throw new Error("Settlement response is missing the facilitator transaction hash");
  }

  const storedResponse = await fetch(`${API_URL}/v1/settlements/${paidBody.receipt.id}`);
  const stored: unknown = await storedResponse.json().catch(() => ({}));
  if (storedResponse.status !== 200 || !isReceipt(stored)) {
    throw new Error(`Stored receipt lookup failed with ${storedResponse.status}`);
  }
  if (stored.receipt_hash !== paidBody.receipt_hash) {
    throw new Error("Stored receipt hash does not match the response");
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: paidBody.tx_hash as `0x${string}`,
  });
  if (receipt.status !== "success") {
    throw new Error(`Settlement transaction ${paidBody.tx_hash} did not succeed`);
  }

  const payeeAfter = await usdcBalance(publicClient, USDC_ADDRESS, payee);
  const gained = payeeAfter - payeeBefore;
  console.log(
    JSON.stringify({
      receiptHash: paidBody.receipt_hash,
      txHash: paidBody.tx_hash,
      payeeUsdcAfter: formatUnits(payeeAfter, 6),
      payeeGained: formatUnits(gained, 6),
    }),
  );
  if (gained < required) {
    throw new Error(
      `Payee balance increased by ${formatUnits(gained, 6)} USDC, expected at least ${AMOUNT}`,
    );
  }

  console.log("x402 wallet settlement: OK");
}

async function main(): Promise<void> {
  if (PAY) {
    await paid();
    return;
  }

  const payee =
    process.env.PAYEE_ADDRESS ?? "0x2222222222222222222222222222222222222222";
  await unpaid(payee);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
