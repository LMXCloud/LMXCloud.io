import assert from "node:assert/strict";
import test from "node:test";

import { paymentAuthFromPayload } from "./auth.js";
import type { ProbeResult } from "./probe.js";
import { logRangeCap, matchRefunds, mergeReconciled, minutesCovering, pairAuthorizations, pendingKeys, reconcile, resultKey, type AuthorizationUsedLog, type IncomingTransfer, type OutgoingTransfer } from "./reconcile.js";

const LABS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SELLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER = "0xcccccccccccccccccccccccccccccccccccccccc";
const NONCE_A = `0x${"11".repeat(32)}`;
const NONCE_B = `0x${"22".repeat(32)}`;
const NOW = new Date("2026-10-02T15:00:00.000Z");

function result(patch: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id: "chat",
    url: "https://api.lmxcloud.io/v1/chat/completions",
    method: "POST",
    timestamp: "2026-10-02T14:50:00.000Z",
    dryRun: false,
    listedPriceUsdc: "0.001000",
    quotedPriceUsdc: "0.001000",
    scheme: "exact",
    paymentRequirements: null,
    settlementTx: null,
    settled: true,
    httpStatus: 200,
    latencyMs: 100,
    bodyTruncated: "{\"choices\":[{\"index\":0}]}",
    bodySha256: "abc",
    bodyBytes: 24,
    bodyIncomplete: false,
    bodySource: "paid",
    balanceBeforeUsdc: "1.000000",
    balanceAfterUsdc: "0.999000",
    balanceDeltaUsdc: "-0.001000",
    paymentAuth: { scheme: "exact", authorizer: LABS, nonce: NONCE_A },
    delivered: true,
    formatMatched: true,
    schemaSource: "expected",
    errorLikeBody: false,
    noDelivery: false,
    formatFail: false,
    paidButNoDelivery: false,
    refusal: null,
    error: null,
    wouldExceedRunCap: null,
    listingDrift: [],
    finding: null,
    answeredUrl: null,
    outcome: "pass",
    sellerFault: false,
    level: 1,
    shapeIssues: [],
    shapeLenient: "na",
    shapeStrict: "na",
    assertionResults: [],
    contentTypeMatched: "na",
    dataAgeSeconds: null,
    timestampPath: null,
    staleCache: false,
    rotationIndex: null,
    checkLevel: null,
    checkName: null,
    warnings: [],
    role: "probe",
    runId: null,
    runSpentUsdc: "0.001000",
    ...patch,
  };
}

function transfer(patch: Partial<OutgoingTransfer> = {}): OutgoingTransfer {
  return {
    txHash: "0xabc",
    logIndex: 2,
    from: LABS,
    to: SELLER,
    value: 1_000n,
    ...patch,
  };
}

function authLog(patch: Partial<AuthorizationUsedLog> = {}): AuthorizationUsedLog {
  return {
    txHash: "0xabc",
    logIndex: 1,
    authorizer: LABS,
    nonce: NONCE_A,
    ...patch,
  };
}

test("exact pairs AuthorizationUsed with the next transfer in that transaction", () => {
  const { pairs, consumed } = pairAuthorizations(
    [authLog(), authLog({ nonce: NONCE_B, logIndex: 3 })],
    [
      transfer({ logIndex: 0, value: 9_999n, txHash: "0xabc" }),
      transfer({ logIndex: 2, value: 1_000n }),
      transfer({ logIndex: 4, value: 500n, to: OTHER }),
    ],
  );
  assert.equal(pairs.get(NONCE_A)?.value, 1_000n);
  assert.equal(pairs.get(NONCE_B)?.value, 500n);
  assert.equal(consumed.has("0xabc:0"), false);
  assert.equal(consumed.has("0xabc:2"), true);
});

test("exact is a nonce match, and a loose transfer is unattributed", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result()],
    authorizations: [authLog()],
    transfers: [
      transfer(),
      transfer({ txHash: "0xother", logIndex: 1, value: 4_000n, to: OTHER }),
    ],
  });

  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.paid, true);
  assert.equal(line.onchainPaid, true);
  assert.equal(line.onchainAmountUsdc, "0.001000");
  assert.equal(line.onchainTx, "0xabc");
  assert.equal(line.balanceDeltaUsdc, "-0.001000");
  assert.equal(line.delivered, true);
  assert.equal(report.unattributed, 1);
  const loose = report.lines.find((item) => "kind" in item && item.kind === "unattributed");
  assert.ok(loose && "kind" in loose);
  assert.equal(loose.onchainTx, "0xother");
  assert.equal(loose.onchainAmountUsdc, "0.004000");
});

test("a balance drop without the signed nonce is not paid", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({ delivered: true, balanceDeltaUsdc: "-0.001000" })],
    authorizations: [],
    transfers: [transfer({ txHash: "0xelsewhere" })],
  });
  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.onchainPaid, false);
  assert.equal(line.paid, false);
  assert.equal(line.delivered, false);
  assert.equal(line.balanceDeltaUsdc, "-0.001000");
  assert.equal(report.unattributed, 1);
});

test("upto matches the one Transfer to payTo within the max, for the settled amount", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({
      scheme: "upto",
      paymentAuth: { scheme: "upto", payTo: SELLER, maxAmountAtomic: "1000", permitNonce: "99" },
    })],
    authorizations: [],
    transfers: [transfer({ value: 400n })],
  });
  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.onchainPaid, true);
  assert.equal(line.onchainAmountUsdc, "0.000400");
  assert.equal(report.unattributed, 0);
});

test("two identical upto transfers are not guessed apart", () => {
  const shared = { scheme: "upto" as const, payTo: SELLER, maxAmountAtomic: "1000", permitNonce: "1" };
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [
      result({ id: "a", paymentAuth: { ...shared, permitNonce: "1" } }),
      result({ id: "b", paymentAuth: { ...shared, permitNonce: "2" } }),
    ],
    authorizations: [],
    transfers: [
      transfer({ txHash: "0x1", logIndex: 1 }),
      transfer({ txHash: "0x2", logIndex: 1 }),
    ],
  });
  assert.equal(report.onchainPaid, 0);
  assert.equal(report.unattributed, 2);
  for (const line of report.lines) {
    if (!("kind" in line)) assert.equal(line.paid, false);
  }
});

test("an exact transfer is not also spent against an upto result", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [
      result({ id: "exact" }),
      result({
        id: "upto",
        paymentAuth: { scheme: "upto", payTo: SELLER, maxAmountAtomic: "1000", permitNonce: "7" },
      }),
    ],
    authorizations: [authLog()],
    transfers: [transfer()],
  });
  const exact = report.lines.find((line) => !("kind" in line) && line.id === "exact");
  const upto = report.lines.find((line) => !("kind" in line) && line.id === "upto");
  assert.ok(exact && !("kind" in exact));
  assert.ok(upto && !("kind" in upto));
  assert.equal(exact.onchainPaid, true);
  assert.equal(upto.onchainPaid, false);
  assert.equal(report.unattributed, 0);
});

test("chain paid with an error body is no-delivery, and an old result is left out", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [
      result({
        errorLikeBody: true,
        delivered: false,
        formatMatched: false,
        bodyTruncated: "{\"error\":\"nope\"}",
      }),
      result({ id: "old", timestamp: "2026-10-02T13:00:00.000Z" }),
    ],
    authorizations: [authLog()],
    transfers: [transfer()],
  });
  assert.equal(report.lines.filter((line) => !("kind" in line)).length, 1);
  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.onchainPaid, true);
  assert.equal(line.delivered, false);
  assert.equal(line.noDelivery, true);
  assert.equal(line.formatFail, true);
  assert.equal(line.paidButNoDelivery, true);
  assert.equal(line.balanceDeltaUsdc, "-0.001000");
});

test("a transfer above the upto max is unattributed", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({
      paymentAuth: { scheme: "upto", payTo: SELLER, maxAmountAtomic: "1000", permitNonce: "3" },
    })],
    authorizations: [],
    transfers: [transfer({ value: 50_000n })],
  });
  assert.equal(report.onchainPaid, 0);
  assert.equal(report.unattributed, 1);
});

test("payment auth is read from the signed exact and upto payloads", () => {
  const nonce = `0x${"ab".repeat(32)}`;
  const exact = paymentAuthFromPayload({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "1000",
      payTo: SELLER,
      maxTimeoutSeconds: 60,
      extra: {},
    },
    payload: {
      authorization: {
        from: LABS,
        to: SELLER,
        value: "1000",
        validAfter: "0",
        validBefore: "999",
        nonce,
      },
    },
  });
  assert.deepEqual(exact, { scheme: "exact", authorizer: LABS, nonce });

  const upto = paymentAuthFromPayload({
    x402Version: 2,
    accepted: {
      scheme: "upto",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "1000",
      payTo: SELLER,
      maxTimeoutSeconds: 60,
      extra: {},
    },
    payload: {
      permit2Authorization: {
        from: LABS,
        permitted: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "1000" },
        spender: "0x1111111111111111111111111111111111111111",
        nonce: "42",
        deadline: "999",
        witness: { to: SELLER, facilitator: OTHER, validAfter: "0" },
      },
    },
  });
  assert.deepEqual(upto, {
    scheme: "upto",
    payTo: SELLER,
    maxAmountAtomic: "1000",
    permitNonce: "42",
  });
});

test("exact must settle equal to the quote and upto must settle at or under it", () => {
  const exact = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({ outcome: "pass" })],
    authorizations: [authLog()],
    transfers: [transfer({ value: 2_000n })],
  });
  const exactLine = exact.lines[0];
  assert.ok(exactLine && !("kind" in exactLine));
  assert.equal(exactLine.overcharged, true);
  assert.equal(exactLine.outcome, "overcharged");
  assert.equal(exactLine.sellerFault, true);
  assert.match(exactLine.overchargeReason ?? "", /exact settled 0.002000 != quoted 0.001000/);

  const under = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({
      scheme: "upto",
      quotedPriceUsdc: "0.005000",
      paymentAuth: { scheme: "upto", payTo: SELLER, maxAmountAtomic: "5000", permitNonce: "9" },
    })],
    authorizations: [],
    transfers: [transfer({ value: 1_000n })],
  });
  const underLine = under.lines[0];
  assert.ok(underLine && !("kind" in underLine));
  assert.equal(underLine.overcharged, false);
  assert.equal(underLine.outcome, "pass");

  const over = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({
      scheme: "upto",
      quotedPriceUsdc: "0.001000",
      outcome: "error_body",
      sellerFault: true,
      paymentAuth: { scheme: "upto", payTo: SELLER, maxAmountAtomic: "5000", permitNonce: "9" },
    })],
    authorizations: [],
    transfers: [transfer({ value: 1_500n })],
  });
  const overLine = over.lines[0];
  assert.ok(overLine && !("kind" in overLine));
  assert.equal(overLine.onchainPaid, true);
  assert.equal(overLine.outcome, "error_body");
  assert.equal(overLine.overcharged, true);
  assert.match(overLine.overchargeReason ?? "", /upto settled 0.001500 above quoted 0.001000/);
});

test("more than one transfer for one call is a double charge on the reconciled line", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({ outcome: "pass" })],
    authorizations: [authLog()],
    transfers: [
      transfer({ value: 1_000n, logIndex: 2 }),
      transfer({ value: 1_000n, logIndex: 4 }),
    ],
  });
  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.overcharged, true);
  assert.equal(line.outcome, "overcharged");
  assert.match(line.overchargeReason ?? "", /double charge: 2 transfers/);
  assert.equal(report.unattributed, 0);
});

test("an input fault stays an input fault when the settled amount also mismatches", () => {
  const report = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [result({ outcome: "input_fault", sellerFault: false })],
    authorizations: [authLog()],
    transfers: [transfer({ value: 2_000n })],
  });
  const line = report.lines[0];
  assert.ok(line && !("kind" in line));
  assert.equal(line.outcome, "input_fault");
  assert.equal(line.sellerFault, false);
  assert.equal(line.overcharged, true);
  assert.equal(line.paidButNoDelivery, false);
});

test("a signed miss stays pending for that run, and a later pass can still see it", () => {
  const signed = result({ runId: "sample-1", timestamp: "2026-10-02T12:00:00.000Z" });
  const held = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    pendingRunId: "sample-1",
    results: [signed],
    authorizations: [],
    transfers: [],
    alsoInclude: (item) => item.runId === "sample-1",
  });
  const pending = held.lines[0];
  assert.ok(pending && !("kind" in pending));
  assert.equal(pending.onchainPaid, false);
  assert.equal(pending.settlementPending, true);
  assert.equal(held.pending, 1);
  assert.equal(pendingKeys(held.lines).has(resultKey(signed)), true);

  const finalized = reconcile({
    now: NOW,
    sinceMinutes: 30,
    labsAddress: LABS,
    results: [signed],
    authorizations: [],
    transfers: [],
    alsoInclude: (item) => pendingKeys(held.lines).has(resultKey(item)),
  });
  const unpaid = finalized.lines[0];
  assert.ok(unpaid && !("kind" in unpaid));
  assert.equal(unpaid.onchainPaid, false);
  assert.equal(unpaid.settlementPending, undefined);
  assert.equal(finalized.pending, 0);
});

test("a full reconcile keeps earlier runs and a short pass does not drop them", () => {
  const pilot = { ...result({ id: "pilot", runId: "pilot-run", timestamp: "2026-10-03T19:00:00.000Z" }), onchainPaid: true, onchainTx: "0xabc", paid: true, onchainAmountUsdc: "0.001000", reconciledAt: NOW.toISOString(), overcharged: false, overchargeReason: null };
  const sample = { ...result({ id: "sample", runId: "sample-1", timestamp: "2026-10-04T00:00:00.000Z" }), onchainPaid: true, onchainTx: "0xdef", paid: true, onchainAmountUsdc: "0.002000", reconciledAt: NOW.toISOString(), overcharged: false, overchargeReason: null };
  const kept = mergeReconciled([pilot], [sample], true);
  assert.equal(kept.filter((line) => !("kind" in line) && line.id === "pilot").length, 1);
  assert.equal(kept.filter((line) => !("kind" in line) && line.id === "sample").length, 1);
  const revised = { ...sample, onchainAmountUsdc: "0.003000" };
  const updated = mergeReconciled(kept, [revised], false);
  const amounts = updated.filter((line): line is typeof revised => !("kind" in line) && line.id === "sample");
  assert.equal(amounts.length, 1);
  assert.equal(amounts[0]?.onchainAmountUsdc, "0.003000");
  assert.equal(updated.filter((line) => !("kind" in line) && line.id === "pilot").length, 1);
  assert.equal(minutesCovering([
    { timestamp: "2026-10-03T19:00:00.000Z" },
    { timestamp: "2026-10-04T00:00:00.000Z" },
  ], new Date("2026-10-04T01:00:00.000Z")), 370);
});

test("a payTo refund within 30 minutes reduces that call and a later one does not", () => {
  const payTo = "0x2222222222222222222222222222222222222222";
  const labs = "0x90B11fc7846B13C981502a02f3A7ED8CD4586787";
  const inbound = (tx: string, seconds: number): IncomingTransfer => ({
    txHash: tx,
    logIndex: 1,
    from: payTo,
    to: labs,
    value: 10_000n,
    blockTimestamp: seconds,
  });
  const matched = matchRefunds(
    [
      { payTo, timestamp: "2026-10-04T01:00:00.000Z" },
      { payTo, timestamp: "2026-10-04T02:00:00.000Z" },
    ],
    [
      inbound("0xearly", Math.floor(Date.parse("2026-10-04T01:10:00.000Z") / 1000)),
      inbound("0xlate", Math.floor(Date.parse("2026-10-04T02:40:00.000Z") / 1000)),
    ],
    labs,
  );
  assert.equal(matched[0]?.recoveredAtomic, 10_000n);
  assert.equal(matched[0]?.refundTx, "0xearly");
  assert.equal(matched[1]?.recoveredAtomic, 0n);
  assert.equal(matched[1]?.refundTx, null);
});

test("a getLogs range error reports the block cap, and other errors do not", () => {
  const limited = new Error("Invalid parameters were provided to the RPC method.");
  Object.assign(limited, { details: "eth_getLogs is limited to 0 - 50 blocks range" });
  assert.equal(logRangeCap(limited), 50n);
  assert.equal(logRangeCap(new Error("over rate limit")), null);
  assert.equal(logRangeCap(new Error("query returned more than 10000 results")), 0n);
});
