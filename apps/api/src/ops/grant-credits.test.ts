import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiKeyRecord, ApiKeyStore } from "../auth/store.js";
import type { CreditMeta, CreditStore } from "../credits/store.js";
import {
  classifyIdentifier,
  grantOpsCredits,
  parseGrantCreditsBody,
} from "./grant-credits.js";

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: "key-1",
    keyHash: "hash",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockKeyStore(
  overrides: Partial<ApiKeyStore> = {},
): ApiKeyStore {
  return {
    create: async () => ({ record: record(), plainKey: "lmx_test" }),
    findByPlainKey: async () => null,
    findById: async () => null,
    findPrimaryKeyForEmail: async () => null,
    findPrimaryKeyForWallet: async () => null,
    linkWallet: async () => ({ ok: false, code: "not_found", message: "no" }),
    touchLastUsed: async () => undefined,
    listForRecord: async () => [],
    revoke: async () => false,
    emailHasAccount: async () => false,
    walletHasAccount: async () => false,
    ...overrides,
  };
}

function mockCreditStore(balances: Map<string, number>): CreditStore {
  return {
    getBalance: async (id) => balances.get(id) ?? 0,
    hasMinimumBalance: async (id, min) => (balances.get(id) ?? 0) >= min,
    deduct: async () => true,
    credit: async (id, amount, _meta?: CreditMeta) => {
      const next = (balances.get(id) ?? 0) + amount;
      balances.set(id, next);
      return next;
    },
    reserve: async () => true,
    settleReservation: async () => true,
    releaseReservation: async () => undefined,
  };
}

describe("parseGrantCreditsBody", () => {
  it("accepts identifier + amount", () => {
    const parsed = parseGrantCreditsBody({
      identifier: " tester@lmxcloud.io ",
      amount: 10,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.identifier, "tester@lmxcloud.io");
      assert.equal(parsed.value.amount, 10);
    }
  });

  it("accepts api_key_id, email, or wallet aliases", () => {
    assert.equal(
      parseGrantCreditsBody({ api_key_id: "abc", amount: 1 }).ok,
      true,
    );
    assert.equal(
      parseGrantCreditsBody({ email: "a@b.co", amount: 1 }).ok,
      true,
    );
    assert.equal(
      parseGrantCreditsBody({
        wallet: "0x0000000000000000000000000000000000000001",
        amount: 1,
      }).ok,
      true,
    );
  });

  it("rejects missing identifier, non-positive amount, and oversized grants", () => {
    assert.equal(parseGrantCreditsBody({ amount: 10 }).ok, false);
    assert.equal(parseGrantCreditsBody({ identifier: "abc", amount: 0 }).ok, false);
    assert.equal(
      parseGrantCreditsBody({ identifier: "abc", amount: 10_001 }).ok,
      false,
    );
  });
});

describe("classifyIdentifier", () => {
  it("detects email, wallet, and api key id", () => {
    assert.equal(classifyIdentifier("you@example.com"), "email");
    assert.equal(
      classifyIdentifier("0x0000000000000000000000000000000000000001"),
      "wallet",
    );
    assert.equal(classifyIdentifier("550e8400-e29b-41d4-a716-446655440000"), "api_key_id");
  });
});

describe("grantOpsCredits", () => {
  it("credits the primary key for an email and returns the new balance", async () => {
    const target = record({ id: "key-email", email: "beta@lmxcloud.io" });
    const balances = new Map<string, number>([["key-email", 1]]);
    const result = await grantOpsCredits({
      apiKeyStore: mockKeyStore({
        findPrimaryKeyForEmail: async (email) =>
          email.toLowerCase() === "beta@lmxcloud.io" ? target : null,
      }),
      creditStore: mockCreditStore(balances),
      identifier: "beta@lmxcloud.io",
      amount: 5,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.id, "key-email");
      assert.equal(result.kind, "email");
      assert.equal(result.credited, 5);
      assert.equal(result.balance, 6);
    }
  });

  it("returns 404 when the account does not exist", async () => {
    const result = await grantOpsCredits({
      apiKeyStore: mockKeyStore(),
      creditStore: mockCreditStore(new Map()),
      identifier: "missing@lmxcloud.io",
      amount: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
    }
  });
});
