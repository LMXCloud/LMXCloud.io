import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReceiptMerkleTree } from "@lmxcloud/api/anchors/merkle";
import {
  buildSettlementReceiptPayload,
  hashSettlementReceipt,
  SETTLEMENT_RECEIPT_VERSION,
  type SettlementReceiptPayload,
} from "@lmxcloud/api/anchors/receipt";
import {
  verifySettlementProof,
  type SettlementProofResponse,
} from "./verify.ts";

const SETTLEMENT = {
  id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  referenceId: "ref-agent-trade-1",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amount: 0.001,
  asset: "USDC",
  createdAt: "2026-09-22T20:00:00.000Z",
};

const TX = `0x${"ab".repeat(32)}`;
const CONTRACT = "0x51d2a68a5f43e44dff6cbf1b5231270a6fb4ca03" as `0x${string}`;

function anchoredResponse(
  leaves: `0x${string}`[],
  leafIndex: number,
  receipt: SettlementReceiptPayload = buildSettlementReceiptPayload(SETTLEMENT),
): SettlementProofResponse {
  const tree = buildReceiptMerkleTree(leaves);
  return {
    object: "settlement_receipt_proof",
    settlement_id: receipt.id,
    status: "anchored",
    receipt_version: receipt.version,
    receipt,
    receipt_hash: leaves[leafIndex] ?? null,
    leaf_index: leafIndex,
    merkle_proof: tree.getProof(leafIndex),
    merkle_root: tree.root,
    anchor: {
      chain_id: 84532,
      contract_address: CONTRACT,
      tx_hash: TX,
      block_number: "123",
      anchored_at: "2026-09-22T21:00:00.000Z",
    },
  };
}

describe("verifySettlementProof", () => {
  it("verifies an anchored settlement and names the trust tier", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const result = verifySettlementProof(
      anchoredResponse(
        [
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          receiptHash,
        ],
        1,
      ),
    );

    assert.equal(result.verdict.id, "verified");
    assert.equal(result.verdict.label, "Verified");
    assert.deepEqual(result.trustTier, {
      id: "grid_witnessed_settlement",
      label: "Grid-witnessed settlement",
    });
    assert.equal(result.hash.status, "pass");
    assert.equal(result.hash.recomputed, result.hash.claimed);
    assert.equal(result.merkle.status, "pass");
    assert.equal(result.anchor.state, "present");
    assert.equal(result.anchor.chainLabel, "Base Sepolia");
    assert.equal(result.anchor.chainId, 84532);
    assert.equal(result.anchor.contractAddress, CONTRACT);
    assert.equal(result.anchor.anchoredAt, "2026-09-22T21:00:00.000Z");
    assert.equal(result.anchor.txUrl, `https://sepolia.basescan.org/tx/${TX}`);
    assert.equal(
      result.anchor.contractUrl,
      `https://sepolia.basescan.org/address/${CONTRACT}`,
    );
  });

  it("labels Base mainnet from the chain id on the anchor", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.anchor!.chain_id = 8453;
    const result = verifySettlementProof(proof);
    assert.equal(result.anchor.chainLabel, "Base");
    assert.equal(result.anchor.txUrl, `https://basescan.org/tx/${TX}`);
  });

  it("accepts a single-leaf proof", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const result = verifySettlementProof(anchoredResponse([receiptHash], 0));
    assert.equal(result.verdict.id, "verified");
    assert.equal(result.merkle.status, "pass");
  });

  it("stays pending when the batch is not anchored yet", () => {
    const receipt = buildSettlementReceiptPayload(SETTLEMENT);
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const result = verifySettlementProof({
      object: "settlement_receipt_proof",
      settlement_id: SETTLEMENT.id,
      status: "pending",
      receipt_version: SETTLEMENT_RECEIPT_VERSION,
      receipt,
      receipt_hash: receiptHash,
      leaf_index: 0,
      merkle_proof: null,
      merkle_root: null,
      anchor: null,
    });

    assert.equal(result.verdict.id, "pending");
    assert.equal(result.verdict.label, "Pending");
    assert.equal(result.hash.status, "pass");
    assert.equal(result.merkle.status, "pending");
    assert.equal(result.anchor.state, "pending");
    assert.equal(result.trustTier.id, "grid_witnessed_settlement");
  });

  it("fails the hash check when the receipt payload was altered", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.receipt = proof.receipt
      ? { ...proof.receipt, payer: "0x3333333333333333333333333333333333333333" }
      : null;

    const result = verifySettlementProof(proof);
    assert.equal(result.verdict.id, "does_not_verify");
    assert.equal(result.hash.status, "fail");
    assert.notEqual(result.hash.recomputed, result.hash.claimed);
    assert.equal(result.trustTier.label, "Grid-witnessed settlement");
  });

  it("fails when the amount string is not the canonical payload", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.receipt = proof.receipt ? { ...proof.receipt, amount: "0.001" } : null;
    const result = verifySettlementProof(proof);
    assert.equal(result.hash.status, "fail");
    assert.equal(result.verdict.id, "does_not_verify");
  });

  it("fails a Merkle proof that does not match the batch root", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.merkle_proof = [
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ];
    const result = verifySettlementProof(proof);
    assert.equal(result.hash.status, "pass");
    assert.equal(result.merkle.status, "fail");
    assert.equal(result.verdict.id, "does_not_verify");
  });

  it("does not verify a settlement with no receipt", () => {
    const result = verifySettlementProof({
      object: "settlement_receipt_proof",
      settlement_id: SETTLEMENT.id,
      status: "no_receipt",
      receipt_version: SETTLEMENT_RECEIPT_VERSION,
      receipt: null,
      receipt_hash: null,
      leaf_index: null,
      merkle_proof: null,
      merkle_root: null,
      anchor: null,
    });

    assert.equal(result.verdict.id, "does_not_verify");
    assert.equal(result.hash.status, "fail");
    assert.equal(result.receipt, null);
  });

  it("does not label an unknown receipt version as grid-witnessed", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.receipt_version = "lmx_other_v1";
    if (proof.receipt) {
      proof.receipt = {
        ...proof.receipt,
        version: "lmx_other_v1" as SettlementReceiptPayload["version"],
      };
    }

    const result = verifySettlementProof(proof);
    assert.equal(result.trustTier.id, "unknown");
    assert.notEqual(result.trustTier.label, "Grid-witnessed settlement");
    assert.equal(result.verdict.id, "does_not_verify");
  });

  it("does not verify an anchored batch that has no transaction to inspect", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = anchoredResponse([receiptHash], 0);
    proof.anchor!.tx_hash = "0x0";
    const result = verifySettlementProof(proof);
    assert.equal(result.hash.status, "pass");
    assert.equal(result.merkle.status, "pass");
    assert.equal(result.anchor.state, "missing");
    assert.equal(result.anchor.txUrl, null);
    assert.equal(result.verdict.id, "does_not_verify");
  });
});
