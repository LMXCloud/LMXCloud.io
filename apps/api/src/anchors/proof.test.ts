import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReceiptMerkleTree, verifyReceiptMerkleProof } from "./merkle.js";
import { buildSettlementReceiptProof, buildUsageLogProof } from "./proof.js";
import { hashReceipt, hashSettlementReceipt } from "./receipt.js";
import type { AnchorBatchRecord } from "./store.js";

const EVENT = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  provider: "ionet",
  model: "llama-3-70b",
  promptTokens: 12,
  completionTokens: 48,
  totalTokens: 60,
  cost: 0.00001234,
  latencyMs: 842,
  fallbackUsed: false,
  createdAt: "2026-07-07T16:25:11.000Z",
};

describe("buildUsageLogProof", () => {
  it("returns pending when batch is not anchored", () => {
    const receiptHash = hashReceipt(EVENT);
    const proof = buildUsageLogProof(
      { ...EVENT, receiptHash, leafIndex: 0 },
      {
        id: "batch-1",
        merkleRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
        eventCount: 1,
        status: "submitting",
        txHash: null,
        blockNumber: null,
        chainId: 84532,
        contractAddress: null,
        createdAt: EVENT.createdAt,
        anchoredAt: null,
      },
      [receiptHash],
      "0x2222222222222222222222222222222222222222",
    );

    assert.equal(proof.status, "pending");
    assert.equal(proof.receiptHash, receiptHash);
    assert.equal(proof.merkleProof, undefined);
  });

  it("returns anchored proof that verifies", () => {
    const receiptHash = hashReceipt(EVENT);
    const leaves = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      receiptHash,
    ] as `0x${string}`[];

    const tree = buildReceiptMerkleTree(leaves);
    const batch: AnchorBatchRecord = {
      id: "batch-2",
      merkleRoot: tree.root,
      eventCount: 2,
      status: "anchored",
      txHash: "0xabc",
      blockNumber: 123n,
      chainId: 84532,
      contractAddress: null,
      createdAt: EVENT.createdAt,
      anchoredAt: EVENT.createdAt,
    };

    const proof = buildUsageLogProof(
      { ...EVENT, receiptHash, leafIndex: 1 },
      batch,
      leaves,
      "0x2222222222222222222222222222222222222222",
    );

    assert.equal(proof.status, "anchored");
    assert.ok(proof.merkleProof);
    assert.equal(
      verifyReceiptMerkleProof(proof.merkleRoot!, proof.receiptHash!, proof.merkleProof!),
      true,
    );
  });
});

const SETTLEMENT = {
  id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  referenceId: "ref-agent-trade-1",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amount: 0.001,
  asset: "USDC",
  createdAt: "2026-09-22T20:00:00.000Z",
};

describe("buildSettlementReceiptProof", () => {
  it("returns pending when batch is not anchored", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const proof = buildSettlementReceiptProof(
      { ...SETTLEMENT, receiptHash, leafIndex: 0 },
      {
        id: "batch-1",
        merkleRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
        eventCount: 1,
        status: "submitting",
        txHash: null,
        blockNumber: null,
        chainId: 84532,
        contractAddress: null,
        createdAt: SETTLEMENT.createdAt,
        anchoredAt: null,
      },
      [receiptHash],
    );

    assert.equal(proof.status, "pending");
    assert.equal(proof.receiptHash, receiptHash);
    assert.equal(proof.settlementId, SETTLEMENT.id);
    assert.equal(proof.merkleProof, undefined);
  });

  it("returns anchored proof that verifies", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const leaves = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      receiptHash,
    ] as `0x${string}`[];

    const tree = buildReceiptMerkleTree(leaves);
    const batch: AnchorBatchRecord = {
      id: "batch-2",
      merkleRoot: tree.root,
      eventCount: 2,
      status: "anchored",
      txHash: "0xabc",
      blockNumber: 123n,
      chainId: 84532,
      contractAddress: "0x51d2a68a5f43e44dff6cbf1b5231270a6fb4ca03",
      createdAt: SETTLEMENT.createdAt,
      anchoredAt: SETTLEMENT.createdAt,
    };

    const proof = buildSettlementReceiptProof(
      { ...SETTLEMENT, receiptHash, leafIndex: 1 },
      batch,
      leaves,
    );

    assert.equal(proof.status, "anchored");
    assert.equal(proof.receipt?.payee, SETTLEMENT.payee);
    assert.equal(proof.anchor?.contractAddress, batch.contractAddress);
    assert.ok(proof.merkleProof);
    assert.equal(
      verifyReceiptMerkleProof(proof.merkleRoot!, proof.receiptHash!, proof.merkleProof!),
      true,
    );
  });

  it("leaves the contract unset when the batch has no recorded address", () => {
    const receiptHash = hashSettlementReceipt(SETTLEMENT);
    const tree = buildReceiptMerkleTree([receiptHash]);
    const proof = buildSettlementReceiptProof(
      { ...SETTLEMENT, receiptHash, leafIndex: 0 },
      {
        id: "batch-3",
        merkleRoot: tree.root,
        eventCount: 1,
        status: "anchored",
        txHash: "0xabc",
        blockNumber: 1n,
        chainId: 84532,
        contractAddress: null,
        createdAt: SETTLEMENT.createdAt,
        anchoredAt: SETTLEMENT.createdAt,
      },
      [receiptHash],
    );

    assert.equal(proof.anchor?.contractAddress, null);
  });
});
