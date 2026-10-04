import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECEIPT_VERSION,
  SETTLEMENT_RECEIPT_VERSION,
  buildReceiptPayload,
  buildSettlementReceiptPayload,
  canonicalizeReceiptPayload,
  canonicalizeSettlementReceipt,
  formatCostForReceipt,
  hashReceipt,
  hashSettlementReceipt,
  hashSettlementReceiptPayload,
} from "./receipt.js";

const FIXTURE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  provider: "ionet",
  model: "llama-3-70b",
  promptTokens: 12,
  completionTokens: 48,
  totalTokens: 60,
  cost: 0.00001234,
  latencyMs: 842,
  fallbackUsed: false,
  createdAt: "2026-07-07T15:30:00.000Z",
};

describe("formatCostForReceipt", () => {
  it("rounds to 8 decimal places as a fixed-width string", () => {
    assert.equal(formatCostForReceipt(0.00001234567), "0.00001235");
    assert.equal(formatCostForReceipt(1), "1.00000000");
    assert.equal(formatCostForReceipt(0), "0.00000000");
  });
});

describe("buildReceiptPayload", () => {
  it("uses snake_case field names and receipt version", () => {
    const payload = buildReceiptPayload(FIXTURE);
    assert.equal(payload.version, RECEIPT_VERSION);
    assert.equal(payload.id, FIXTURE.id);
    assert.equal(payload.provider, "ionet");
    assert.equal(payload.prompt_tokens, 12);
    assert.equal(payload.cost, "0.00001234");
    assert.equal(payload.fallback_used, false);
    assert.equal(payload.created_at, FIXTURE.createdAt);
  });
});

describe("canonicalizeReceiptPayload", () => {
  it("sorts keys alphabetically for stable serialization", () => {
    const payload = buildReceiptPayload(FIXTURE);
    const json = canonicalizeReceiptPayload(payload);
    assert.equal(
      json,
      '{"completion_tokens":48,"cost":"0.00001234","created_at":"2026-07-07T15:30:00.000Z","fallback_used":false,"id":"550e8400-e29b-41d4-a716-446655440000","latency_ms":842,"model":"llama-3-70b","prompt_tokens":12,"provider":"ionet","total_tokens":60,"version":"lmx_receipt_v1"}',
    );
  });

  it("produces identical output regardless of object construction order", () => {
    const a = buildReceiptPayload(FIXTURE);
    const b: typeof a = {
      created_at: FIXTURE.createdAt,
      version: RECEIPT_VERSION,
      id: FIXTURE.id,
      provider: FIXTURE.provider,
      model: FIXTURE.model,
      prompt_tokens: FIXTURE.promptTokens,
      completion_tokens: FIXTURE.completionTokens,
      total_tokens: FIXTURE.totalTokens,
      cost: formatCostForReceipt(FIXTURE.cost),
      latency_ms: FIXTURE.latencyMs,
      fallback_used: FIXTURE.fallbackUsed,
    };
    assert.equal(canonicalizeReceiptPayload(a), canonicalizeReceiptPayload(b));
  });
});

describe("hashReceipt", () => {
  it("returns a 32-byte hex hash with 0x prefix", () => {
    const hash = hashReceipt(FIXTURE);
    assert.match(hash, /^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    assert.equal(hashReceipt(FIXTURE), hashReceipt(FIXTURE));
  });

  it("changes when any field changes", () => {
    const baseline = hashReceipt(FIXTURE);
    assert.notEqual(
      baseline,
      hashReceipt({ ...FIXTURE, provider: "akash" }),
    );
    assert.notEqual(
      baseline,
      hashReceipt({ ...FIXTURE, cost: FIXTURE.cost + 0.00000001 }),
    );
    assert.notEqual(
      baseline,
      hashReceipt({ ...FIXTURE, createdAt: "2026-07-07T15:30:00.001Z" }),
    );
  });
});

const SETTLEMENT_FIXTURE = {
  id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  referenceId: "ref-agent-trade-1",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amount: 0.001,
  asset: "USDC",
  createdAt: "2026-09-22T20:00:00.000Z",
};

describe("buildSettlementReceiptPayload", () => {
  it("records payer, payee, amount, asset, timestamp, and reference", () => {
    const payload = buildSettlementReceiptPayload(SETTLEMENT_FIXTURE);
    assert.equal(payload.version, SETTLEMENT_RECEIPT_VERSION);
    assert.equal(payload.payer, SETTLEMENT_FIXTURE.payer);
    assert.equal(payload.payee, SETTLEMENT_FIXTURE.payee);
    assert.equal(payload.amount, "0.00100000");
    assert.equal(payload.asset, "USDC");
    assert.equal(payload.reference_id, SETTLEMENT_FIXTURE.referenceId);
    assert.equal(payload.created_at, SETTLEMENT_FIXTURE.createdAt);
    assert.equal("provider" in payload, false);
    assert.equal("model" in payload, false);
  });
});

describe("canonicalizeSettlementReceipt", () => {
  it("sorts keys alphabetically", () => {
    const payload = buildSettlementReceiptPayload(SETTLEMENT_FIXTURE);
    assert.equal(
      canonicalizeSettlementReceipt(payload),
      '{"amount":"0.00100000","asset":"USDC","created_at":"2026-09-22T20:00:00.000Z","id":"6ba7b810-9dad-11d1-80b4-00c04fd430c8","payee":"0x2222222222222222222222222222222222222222","payer":"0x1111111111111111111111111111111111111111","reference_id":"ref-agent-trade-1","version":"lmx_settlement_receipt_v1"}',
    );
  });
});

describe("hashSettlementReceipt", () => {
  it("is a deterministic 32-byte hash and changes when the payee changes", () => {
    const hash = hashSettlementReceipt(SETTLEMENT_FIXTURE);
    assert.match(hash, /^0x[0-9a-f]{64}$/);
    assert.equal(hash, hashSettlementReceipt(SETTLEMENT_FIXTURE));
    assert.notEqual(
      hash,
      hashSettlementReceipt({
        ...SETTLEMENT_FIXTURE,
        payee: "0x3333333333333333333333333333333333333333",
      }),
    );
    assert.notEqual(hash, hashReceipt(FIXTURE));
    assert.equal(
      hash,
      hashSettlementReceiptPayload(buildSettlementReceiptPayload(SETTLEMENT_FIXTURE)),
    );
  });
});
