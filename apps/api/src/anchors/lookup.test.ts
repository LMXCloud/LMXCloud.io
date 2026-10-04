import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSettlementProofKey } from "./lookup.js";

const ID = "2c6b2361-2e78-43d1-9f3f-dc7106df9df3";
const HASH = "0xf003cfe6d998c98ff71a7e225b8f8e5175a9e82b6df24fd820ca642e288110d9";

describe("parseSettlementProofKey", () => {
  it("accepts a settlement id", () => {
    assert.deepEqual(parseSettlementProofKey(`  ${ID.toUpperCase()}  `), {
      kind: "id",
      value: ID.toUpperCase(),
    });
  });

  it("accepts a receipt hash and normalizes case", () => {
    assert.deepEqual(parseSettlementProofKey(HASH.toUpperCase()), {
      kind: "receipt_hash",
      value: HASH,
    });
  });

  it("rejects anything that is neither", () => {
    assert.equal(parseSettlementProofKey(""), null);
    assert.equal(parseSettlementProofKey("not-a-receipt"), null);
    assert.equal(parseSettlementProofKey("0xabc"), null);
    assert.equal(parseSettlementProofKey(`${ID}-extra`), null);
  });
});
