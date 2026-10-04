#!/usr/bin/env tsx
/**
 * Verify a usage log or settlement receipt against the API proof endpoint and on-chain anchor.
 *
 * Usage:
 *   API_URL=http://localhost:3000 LOG_ID=<uuid> SESSION_TOKEN=eyJ... pnpm verify:receipt
 *   API_URL=http://localhost:3000 LOG_ID=<uuid> API_KEY=lmx_... pnpm verify:receipt
 *   API_URL=http://localhost:3000 SETTLEMENT_ID=<uuid> SESSION_TOKEN=eyJ... pnpm verify:receipt
 */

import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  canonicalizeReceiptPayload,
  canonicalizeSettlementReceipt,
  hashReceipt,
  hashSettlementReceipt,
  type ReceiptPayload,
  type SettlementReceiptPayload,
} from "../src/anchors/receipt.js";
import { verifyReceiptMerkleProof } from "../src/anchors/merkle.js";
import { LMX_LOG_ANCHOR_ABI } from "../src/anchors/contract.js";

const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const LOG_ID = process.env.LOG_ID?.trim();
const SETTLEMENT_ID = process.env.SETTLEMENT_ID?.trim();
const token = process.env.SESSION_TOKEN ?? process.env.API_KEY;

if (!LOG_ID && !SETTLEMENT_ID) {
  console.error("Set LOG_ID to a usage_events UUID from GET /v1/usage/logs");
  process.exit(1);
}

if (!token) {
  console.error("Set SESSION_TOKEN or API_KEY");
  process.exit(1);
}

interface ProofResponse {
  object: string;
  log_id: string;
  status: "no_receipt" | "pending" | "anchored";
  receipt_version: string;
  receipt: ReceiptPayload | null;
  receipt_hash: `0x${string}` | null;
  leaf_index: number | null;
  merkle_proof: `0x${string}`[] | null;
  merkle_root: `0x${string}` | null;
  anchor: {
    chain_id: number;
    contract_address: `0x${string}`;
    tx_hash: string;
    block_number: string | null;
    anchored_at: string | null;
  } | null;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

interface SettlementProofResponse {
  object: string;
  settlement_id: string;
  status: "no_receipt" | "pending" | "anchored";
  receipt_version: string;
  receipt: SettlementReceiptPayload | null;
  receipt_hash: `0x${string}` | null;
  leaf_index: number | null;
  merkle_proof: `0x${string}`[] | null;
  merkle_root: `0x${string}` | null;
  anchor: ProofResponse["anchor"];
}

if (SETTLEMENT_ID) {
  const res = await fetch(`${API_URL}/v1/settlements/${SETTLEMENT_ID}/proof`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(await parseError(res));
    process.exit(1);
  }

  const proof = (await res.json()) as SettlementProofResponse;
  console.log("Proof status:", proof.status);

  if (proof.status === "no_receipt") {
    console.error("This settlement has no receipt hash — it may predate anchoring.");
    process.exit(1);
  }

  if (proof.status === "pending") {
    console.error("Receipt exists but is not anchored on-chain yet. Try again shortly.");
    process.exit(2);
  }

  if (!proof.receipt || !proof.receipt_hash || proof.merkle_proof === null || !proof.merkle_root || !proof.anchor) {
    console.error("Incomplete anchored proof payload from API");
    process.exit(1);
  }

  const recomputed = hashSettlementReceipt({
    id: proof.receipt.id,
    referenceId: proof.receipt.reference_id,
    payer: proof.receipt.payer,
    payee: proof.receipt.payee,
    amount: Number(proof.receipt.amount),
    asset: proof.receipt.asset,
    createdAt: proof.receipt.created_at,
  });

  if (recomputed !== proof.receipt_hash) {
    console.error("Receipt hash mismatch");
    console.error("  API:       ", proof.receipt_hash);
    console.error("  Recomputed:", recomputed);
    process.exit(1);
  }

  console.log("Receipt hash OK:", proof.receipt_hash);

  const merkleOk = verifyReceiptMerkleProof(
    proof.merkle_root,
    proof.receipt_hash,
    proof.merkle_proof,
  );

  if (!merkleOk) {
    console.error("Merkle proof verification failed");
    process.exit(1);
  }

  console.log("Merkle proof OK — root:", proof.merkle_root);

  const chain = proof.anchor.chain_id === baseSepolia.id ? baseSepolia : base;
  const client = createPublicClient({
    chain,
    transport: http(process.env.BASE_RPC_URL ?? chain.rpcUrls.default.http[0]),
  });

  const anchoredAt = await client.readContract({
    address: proof.anchor.contract_address,
    abi: LMX_LOG_ANCHOR_ABI,
    functionName: "anchoredAt",
    args: [proof.merkle_root],
  });

  if (anchoredAt === 0n) {
    console.error("Root is not anchored on-chain at", proof.anchor.contract_address);
    process.exit(1);
  }

  console.log("On-chain anchor OK — anchoredAt:", anchoredAt.toString());
  console.log("\nVerified:", canonicalizeSettlementReceipt(proof.receipt));
  process.exit(0);
}

if (!LOG_ID) {
  console.error("Set LOG_ID to a usage_events UUID from GET /v1/usage/logs");
  process.exit(1);
}

const res = await fetch(`${API_URL}/v1/usage/logs/${LOG_ID}/proof`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
  console.error(await parseError(res));
  process.exit(1);
}

const proof = (await res.json()) as ProofResponse;
console.log("Proof status:", proof.status);

if (proof.status === "no_receipt") {
  console.error("This log has no receipt hash — it may predate anchoring.");
  process.exit(1);
}

if (proof.status === "pending") {
  console.error("Receipt exists but is not anchored on-chain yet. Try again shortly.");
  process.exit(2);
}

if (!proof.receipt || !proof.receipt_hash || proof.merkle_proof === null || !proof.merkle_root || !proof.anchor) {
  console.error("Incomplete anchored proof payload from API");
  process.exit(1);
}

const recomputed = hashReceipt({
  id: proof.receipt.id,
  provider: proof.receipt.provider,
  model: proof.receipt.model,
  promptTokens: proof.receipt.prompt_tokens,
  completionTokens: proof.receipt.completion_tokens,
  totalTokens: proof.receipt.total_tokens,
  cost: Number(proof.receipt.cost),
  latencyMs: proof.receipt.latency_ms,
  fallbackUsed: proof.receipt.fallback_used,
  createdAt: proof.receipt.created_at,
});

if (recomputed !== proof.receipt_hash) {
  console.error("Receipt hash mismatch");
  console.error("  API:       ", proof.receipt_hash);
  console.error("  Recomputed:", recomputed);
  process.exit(1);
}

console.log("Receipt hash OK:", proof.receipt_hash);

const merkleOk = verifyReceiptMerkleProof(
  proof.merkle_root,
  proof.receipt_hash,
  proof.merkle_proof,
);

if (!merkleOk) {
  console.error("Merkle proof verification failed");
  process.exit(1);
}

console.log("Merkle proof OK — root:", proof.merkle_root);

const chain = proof.anchor.chain_id === baseSepolia.id ? baseSepolia : base;
const client = createPublicClient({
  chain,
  transport: http(process.env.BASE_RPC_URL ?? chain.rpcUrls.default.http[0]),
});

const anchoredAt = await client.readContract({
  address: proof.anchor.contract_address,
  abi: LMX_LOG_ANCHOR_ABI,
  functionName: "anchoredAt",
  args: [proof.merkle_root],
});

if (anchoredAt === 0n) {
  console.error("Root is not anchored on-chain at", proof.anchor.contract_address);
  process.exit(1);
}

console.log("On-chain anchor OK — anchoredAt:", anchoredAt.toString());
console.log("\nVerified:", canonicalizeReceiptPayload(proof.receipt));
