import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import {
  SettlementRequestError,
  assertPaymentMatchesIntent,
  parseSettlementBody,
  usdcToAtomic,
} from "./parse.js";

const PAYEE = getAddress("0x2222222222222222222222222222222222222222");
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const BODY = {
  payee: PAYEE,
  amount: "0.001",
  asset: "USDC",
  reference: "ref-1",
};

describe("parseSettlementBody", () => {
  it("accepts a USDC payment to a checksummed payee", () => {
    const intent = parseSettlementBody(BODY);
    assert.equal(intent.payee, PAYEE);
    assert.equal(intent.amount, 0.001);
    assert.equal(intent.asset, "USDC");
    assert.equal(intent.reference, "ref-1");
    assert.equal(usdcToAtomic(intent.amount), 1000n);
  });

  it("rejects a non-address payee and a non-USDC asset", () => {
    assert.throws(
      () => parseSettlementBody({ ...BODY, payee: "not-a-wallet" }),
      (err: unknown) => err instanceof SettlementRequestError && err.code === "invalid_payee",
    );
    assert.throws(
      () => parseSettlementBody({ ...BODY, asset: "ETH" }),
      (err: unknown) => err instanceof SettlementRequestError && err.code === "invalid_asset",
    );
  });
});

describe("assertPaymentMatchesIntent", () => {
  it("accepts requirements that match the signed exact USDC payment", () => {
    const intent = parseSettlementBody(BODY);
    assert.doesNotThrow(() =>
      assertPaymentMatchesIntent(
        intent,
        {
          scheme: "exact",
          payTo: PAYEE,
          amount: "1000",
          asset: USDC,
        },
        USDC,
      ),
    );
  });

  it("rejects a payment addressed to a different wallet", () => {
    const intent = parseSettlementBody(BODY);
    assert.throws(
      () =>
        assertPaymentMatchesIntent(
          intent,
          {
            scheme: "exact",
            payTo: getAddress("0x3333333333333333333333333333333333333333"),
            amount: "1000",
            asset: USDC,
          },
          USDC,
        ),
      (err: unknown) => err instanceof SettlementRequestError && err.code === "payee_mismatch",
    );
  });
});
