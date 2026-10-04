import assert from "node:assert/strict";
import test from "node:test";

import { grade, gradedFileLines, wilsonInterval, withReconciled, type GradeSource, type GradedCall } from "./grade.js";
import { formatCategoryTable, formatSummaryTable, summarize, summarizeCategories } from "./summary.js";

const NOW = new Date("2026-10-02T16:00:00.000Z");

function row(patch: Partial<GradeSource> = {}): GradeSource {
  return {
    id: "chat",
    url: "https://seller.example/v1/chat",
    method: "POST",
    timestamp: "2026-10-02T15:00:00.000Z",
    dryRun: false,
    listedPriceUsdc: "0.001000",
    quotedPriceUsdc: "0.001000",
    scheme: "exact",
    paymentRequirements: null,
    settlementTx: null,
    settled: false,
    httpStatus: 200,
    latencyMs: 10,
    bodyTruncated: "{}",
    bodySha256: "abc",
    bodyBytes: 2,
    bodyIncomplete: false,
    bodySource: "paid",
    balanceBeforeUsdc: null,
    balanceAfterUsdc: null,
    balanceDeltaUsdc: null,
    paymentAuth: null,
    delivered: true,
    formatMatched: true,
    schemaSource: "na",
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
    runId: "run-b",
    runSpentUsdc: "0.001000",
    ...patch,
  };
}

function call(report: ReturnType<typeof grade>, id = "chat"): GradedCall {
  const found = report.calls.find((item) => item.id === id && item.role !== "canary");
  assert.ok(found);
  return found;
}

test("severities and our faults follow the rubric", () => {
  const report = grade([
    row({ id: "bare", outcome: "no_delivery", sellerFault: true, delivered: false }),
    row({
      id: "payto",
      url: "https://payto.example/x",
      listingDrift: [{ field: "payTo", listed: "0x1", live: "0x2", severity: "high" }],
    }),
    row({ id: "wrong", outcome: "assertion_failed", sellerFault: true }),
    row({ id: "empty", outcome: "empty_result", sellerFault: true }),
    row({ id: "err", outcome: "error_body", sellerFault: true }),
    row({ id: "stale", staleCache: true }),
    row({ id: "shape", outcome: "shape_mismatch", sellerFault: true }),
    row({ id: "client", outcome: "charged_for_client_error", sellerFault: true, onchainPaid: true, onchainAmountUsdc: "0.001000" }),
    row({ id: "prepay", role: "prepay", outcome: null, httpStatus: 402, finding: "validates after payment", delivered: false }),
    row({
      id: "price",
      url: "https://price.example/x",
      listingDrift: [{ field: "price", listed: "0.001000", live: "0.002000" }],
    }),
    row({ id: "dead", url: "https://dead.example/x", outcome: null, finding: "listed route is dead", httpStatus: 404 }),
    row({
      id: "moved",
      url: "https://listed.example/x",
      answeredUrl: "https://api.listed.example/x",
    }),
    row({ id: "ours", outcome: "input_fault" }),
    row({
      id: "rpc",
      outcome: "input_fault",
      assertionResults: [{ path: "result", op: "withinBlocks", pass: false, actual: null, fault: "input" }],
    }),
  ], NOW);

  assert.equal(call(report, "bare").severity, "S1");
  assert.equal(call(report, "bare").fault, "seller");
  assert.equal(call(report, "payto").severity, "S1");
  assert.equal(call(report, "wrong").severity, "S2");
  assert.equal(call(report, "empty").severity, "S2");
  assert.equal(call(report, "err").severity, "S2");
  assert.equal(call(report, "stale").severity, "S2");
  assert.equal(call(report, "shape").severity, "S3");
  assert.equal(call(report, "client").severity, "S3");
  assert.equal(call(report, "prepay").severity, null);
  assert.equal(call(report, "prepay").fault, null);
  assert.equal(call(report, "prepay").finding, "validates after payment");
  assert.equal(call(report, "prepay").reasons.includes("validates after payment"), true);
  assert.equal(call(report, "price").severity, "S4");
  assert.equal(call(report, "dead").severity, "S4");
  assert.equal(call(report, "moved").severity, null);
  assert.equal(call(report, "moved").reasons.includes("listing URL redirects"), true);
  assert.equal(call(report, "ours").fault, "ours");
  assert.equal(call(report, "ours").severity, null);
  assert.equal(call(report, "rpc").fault, "ours");
  assert.equal(call(report, "rpc").reasons[0], "head rpc");
  assert.equal(call(report, "rpc").severity, null);
  for (const line of report.lines) assert.equal(line.rubricVersion, "8");
  assert.equal(call(report, "bare").testInduced, false);
});

test("a 402 on invalid input is info and a paid client error stays S3", () => {
  const info = grade([
    row({ outcome: "pass" }),
    row({
      id: "prepay",
      role: "prepay",
      outcome: null,
      httpStatus: 402,
      finding: "validates after payment",
      delivered: false,
    }),
  ], NOW);
  assert.equal(call(info, "prepay").severity, null);
  assert.equal(call(info, "prepay").fault, null);
  assert.equal(info.sellers[0]?.grade, "Pass");

  const skipped = grade([
    row({ id: "bare-get", outcome: null, role: "prepay", finding: "no required input to invalidate", delivered: false, httpStatus: 402 }),
  ], NOW);
  assert.equal(call(skipped, "bare-get").severity, null);
  assert.equal(call(skipped, "bare-get").fault, null);
  assert.equal(skipped.sellers[0]?.grade, "Pass");

  const client = grade([
    row({ outcome: "charged_for_client_error", sellerFault: true, httpStatus: 400, onchainPaid: true, onchainAmountUsdc: "0.002000" }),
  ], NOW);
  assert.equal(call(client).severity, "S3");
  assert.equal(call(client).fault, "seller");
  assert.equal(call(client).onchainPaid, true);
  assert.equal(call(client).onchainAmount, "0.002000");
  assert.equal(client.sellers[0]?.grade, "Warn");

  const free = grade([
    row({
      id: "free",
      outcome: "charged_for_client_error",
      sellerFault: true,
      httpStatus: 400,
      onchainPaid: false,
      onchainAmountUsdc: null,
    }),
  ], NOW);
  assert.equal(call(free, "free").outcome, "declined_without_charge");
  assert.equal(call(free, "free").finding, "declined without charge");
  assert.equal(call(free, "free").fault, null);
  assert.equal(call(free, "free").severity, null);
  assert.equal(call(free, "free").onchainPaid, false);
  assert.equal(call(free, "free").onchainAmount, null);

  const server = grade([
    row({
      id: "server",
      outcome: "server_error_after_payment",
      sellerFault: true,
      httpStatus: 502,
      onchainPaid: false,
    }),
  ], NOW);
  assert.equal(call(server, "server").outcome, "declined_without_charge");
  assert.equal(call(server, "server").severity, null);

  const chargedServer = grade([
    row({
      id: "charged-server",
      outcome: "server_error_after_payment",
      sellerFault: true,
      httpStatus: 502,
      onchainPaid: true,
      onchainAmountUsdc: "0.030000",
      delivered: false,
    }),
  ], NOW);
  assert.equal(call(chargedServer, "charged-server").outcome, "server_error_after_payment");
  assert.equal(call(chargedServer, "charged-server").severity, "S1");
  assert.equal(call(chargedServer, "charged-server").lossUsd, "0.030000");

  const sampleInput = grade([
    row({
      id: "sample-input",
      runId: "sample-1",
      outcome: "charged_for_client_error",
      httpStatus: 400,
      onchainPaid: false,
      bodyTruncated: "That's the sample URL from Unlisted's listing.",
    }),
  ], NOW);
  assert.equal(call(sampleInput, "sample-input").outcome, "declined_without_charge");
  assert.equal(call(sampleInput, "sample-input").fault, null);
  assert.equal(call(sampleInput, "sample-input").sampleFrame, "random");
});

test("summary counts sellers by frame and puts Wilson intervals on those counts", () => {
  const report = summarize([
    row({ id: "pilot-paid", url: "https://pilot.example/x", runId: "run-b", outcome: "pass", onchainPaid: true, onchainAmountUsdc: "0.001000" }),
    row({
      id: "pilot-shape",
      url: "https://shape.example/x",
      runId: "run-b",
      outcome: "shape_mismatch",
      onchainPaid: true,
      onchainAmountUsdc: "0.004000",
    }),
    row({
      id: "sample-pass",
      url: "https://ok.example/x",
      runId: "sample-9",
      outcome: "pass",
      onchainPaid: true,
      onchainAmountUsdc: "0.010000",
    }),
    row({
      id: "sample-reject",
      url: "https://reject.example/x",
      runId: "sample-9",
      httpStatus: 402,
      outcome: null,
      error: "payment rejected",
      delivered: false,
      onchainPaid: false,
    }),
    row({
      id: "sample-empty-pay",
      url: "https://lost.example/x",
      runId: "sample-9",
      outcome: "no_delivery",
      onchainPaid: true,
      onchainAmountUsdc: "0.020000",
      delivered: false,
    }),
  ]);
  const pilot = report.find((frame) => frame.sampleFrame === "pilot");
  const random = report.find((frame) => frame.sampleFrame === "random");
  assert.ok(pilot);
  assert.ok(random);
  assert.equal(pilot.sellersPaid, 2);
  assert.equal(pilot.formatMismatches, 1);
  assert.equal(pilot.moneyLostUsdc, "0.000000");
  assert.equal(pilot.contractBreachUsd, "0.004000");
  assert.ok(pilot.wilson.formatMismatches);
  assert.equal(random.sellers, 3);
  assert.equal(random.sellersPaid, 2);
  assert.equal(random.paidNotDelivered, 1);
  assert.equal(random.paymentRejections, 1);
  assert.equal(random.moneyLostUsdc, "0.020000");
  assert.equal(random.testInducedUsd, "0.000000");
  assert.equal(random.contractBreachUsd, "0.000000");
  assert.ok(random.wilson.paymentRejections);
  const combined = report.find((frame) => frame.sampleFrame === "combined");
  assert.ok(combined);
  assert.equal(combined.sellers, 5);
  assert.equal(combined.sellersPaid, 4);
  assert.equal(combined.moneyLostUsdc, "0.020000");
  assert.equal(combined.contractBreachUsd, "0.004000");
  assert.match(formatSummaryTable(report), /combined/);
  assert.match(formatSummaryTable(report), /random-r3/);
  assert.match(formatSummaryTable(report), /money lost/);
  assert.match(formatSummaryTable(report), /test-induced/);
  const higher = report.find((frame) => frame.sampleFrame === "random-r3");
  assert.ok(higher);
  assert.equal(higher.sellers, 0);

  const refunded = summarize([
    row({
      id: "refunded",
      url: "https://back.example/x",
      outcome: "no_delivery",
      onchainPaid: true,
      onchainAmountUsdc: "0.020000",
      recoveredUsd: "0.020000",
      refundTx: "0xrefund",
      delivered: false,
    }),
  ]);
  const refundFrame = refunded.find((frame) => frame.sampleFrame === "pilot");
  assert.ok(refundFrame);
  assert.equal(refundFrame.moneyLostUsdc, "0.000000");
});

test("a previous-run failure confirms S1, and a lone failure schedules one recheck", () => {
  const repeated = grade([
    row({ outcome: "no_delivery", sellerFault: true, runId: "run-a", timestamp: "2026-10-02T12:00:00.000Z" }),
    row({ outcome: "no_delivery", sellerFault: true, runId: "run-b", timestamp: "2026-10-02T15:00:00.000Z" }),
  ], NOW);
  assert.equal(repeated.calls[0]?.confirmed, true);
  assert.equal(repeated.rechecks.length, 0);
  assert.equal(repeated.sellers[0]?.grade, "Fail");
  assert.equal(repeated.sellers[0]?.label, "Fail (L1)");

  const first = grade([
    row({ outcome: "assertion_failed", sellerFault: true, level: 1 }),
  ], NOW);
  assert.equal(first.calls[0]?.confirmed, false);
  assert.deepEqual(first.rechecks.map((item) => item.id), ["chat"]);
  assert.equal(first.sellers[0]?.grade, "Pass");
  assert.equal(first.sellers[0]?.pendingRecheck, true);
  assert.equal(first.sellers[0]?.label, "Pass (L1)");
});

test("a recheck that fails confirms, and a recheck that passes does not", () => {
  const failed = grade([
    row({ outcome: "empty_result", sellerFault: true, timestamp: "2026-10-02T15:00:00.000Z" }),
    row({
      outcome: "empty_result",
      sellerFault: true,
      role: "recheck",
      timestamp: "2026-10-02T15:20:00.000Z",
    }),
  ], NOW);
  assert.equal(failed.calls.find((item) => item.role === "probe")?.confirmed, true);
  assert.equal(failed.rechecks.length, 0);
  assert.equal(failed.sellers[0]?.label, "Fail (L1)");

  const recovered = grade([
    row({ outcome: "error_body", sellerFault: true, timestamp: "2026-10-02T15:00:00.000Z" }),
    row({ outcome: "pass", role: "recheck", timestamp: "2026-10-02T15:20:00.000Z" }),
  ], NOW);
  assert.equal(recovered.calls.find((item) => item.role === "probe")?.confirmed, false);
  assert.equal(recovered.rechecks.length, 0);
  assert.equal(recovered.sellers[0]?.grade, "Pass");
  assert.equal(recovered.sellers[0]?.pendingRecheck, false);
});

test("seller grade uses the deepest level, and the pilot interval is on sellers", () => {
  const report = grade([
    row({ id: "l0", url: "https://low.example/x", level: 0, outcome: "shape_mismatch", sellerFault: true }),
    row({ id: "l1", url: "https://high.example/x", level: 1, outcome: "pass" }),
    row({
      id: "l1-bad",
      url: "https://bad.example/x",
      level: 1,
      outcome: "no_delivery",
      sellerFault: true,
      runId: "run-a",
      timestamp: "2026-10-02T12:00:00.000Z",
    }),
    row({
      id: "l1-bad",
      url: "https://bad.example/x",
      level: 1,
      outcome: "no_delivery",
      sellerFault: true,
      runId: "run-b",
      timestamp: "2026-10-02T15:00:00.000Z",
    }),
  ], NOW);
  const low = report.sellers.find((seller) => seller.seller === "low.example");
  const high = report.sellers.find((seller) => seller.seller === "high.example");
  const bad = report.sellers.find((seller) => seller.seller === "bad.example");
  assert.equal(low?.label, "Warn (L0)");
  assert.equal(high?.label, "Pass (L1)");
  assert.equal(bad?.label, "Fail (L1)");
  assert.equal(report.summary.sellersTestedL1, 2);
  assert.equal(report.summary.sellersConfirmedS1S2, 1);
  assert.ok(report.summary.wilson);
  assert.equal(report.summary.wilson?.z, 1.96);
  assert.equal(report.summary.secondary.label, "secondary");
  assert.equal(report.summary.secondary.calls, 3);
});

test("a canary that passes invalidates the run and is not a seller failure", () => {
  const blind = grade([
    row({ outcome: "pass" }),
    row({ id: "chat#canary", role: "canary", outcome: "pass" }),
  ], NOW);
  assert.equal(blind.summary.runInvalid, true);
  assert.equal(blind.summary.canary?.ok, false);
  assert.equal(blind.sellers[0]?.grade, "Pass");

  const sound = grade([
    row({ outcome: "pass" }),
    row({ id: "chat#canary", role: "canary", outcome: "assertion_failed" }),
  ], NOW);
  assert.equal(sound.summary.runInvalid, false);
  assert.equal(sound.summary.canary?.ok, true);
  assert.equal(sound.sellers[0]?.grade, "Pass");
});

test("a signing or RPC failure is ours, not a seller, and is not tested", () => {
  const report = grade([
    row({
      id: "rpc",
      url: "https://listed.example/x",
      answeredUrl: "https://api.listed.example/x",
      outcome: null,
      httpStatus: 402,
      delivered: false,
      error: "RPC Request failed.\nDetails: over rate limit\nbalanceOf(address)",
    }),
  ], NOW);
  const failed = call(report, "rpc");
  assert.equal(failed.outcome, "input_fault");
  assert.equal(failed.fault, "ours");
  assert.equal(failed.severity, null);
  assert.equal(failed.tested, false);
  assert.equal(failed.paid, false);
  assert.deepEqual(failed.reasons, ["not tested"]);
  assert.equal(report.sellers[0]?.grade, "Pass");
  assert.equal(report.summary.secondary.calls, 0);
  assert.equal(report.summary.sellersTestedL1, 0);
});

test("a settled 2xx is graded, and an unconfirmed payment stays pending reconcile", () => {
  const pending = grade([
    row({
      outcome: null,
      httpStatus: 200,
      settled: true,
      settlementTx: "0xabc",
      delivered: false,
      balanceDeltaUsdc: "0.000000",
      bodyBytes: 2,
    }),
  ], NOW);
  assert.equal(call(pending).outcome, "pass");
  assert.equal(call(pending).fault, null);
  assert.equal(call(pending).paid, "pending reconcile");
  assert.equal(call(pending).tested, true);

  const chain = grade(withReconciled(
    [row({ outcome: null, httpStatus: 200, settled: true, settlementTx: "0xabc", delivered: false, bodyBytes: 2 })],
    [{
      ...row({ outcome: null, httpStatus: 200, settled: true, settlementTx: "0xabc", bodyBytes: 2 }),
      onchainPaid: true,
      paid: true,
    }],
  ), NOW);
  assert.equal(call(chain).outcome, "pass");
  assert.equal(call(chain).paid, true);
  assert.equal(gradedFileLines(chain).some((line) => line.kind !== "call"), false);
  assert.equal(gradedFileLines(chain).every((line) => line.id.length > 0), true);
  assert.equal(JSON.stringify(gradedFileLines(chain)).includes('"kind":"summary"'), false);
});

test("a signed payment the chain has not found yet stays pending", () => {
  const source = row({
    paymentAuth: { scheme: "exact", authorizer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nonce: `0x${"ab".repeat(32)}` },
    outcome: "pass",
    settled: false,
    balanceDeltaUsdc: null,
  });
  const graded = grade(withReconciled([source], [{
    ...source,
    onchainPaid: false,
    paid: false,
    settlementPending: true,
  }]), NOW);
  assert.equal(call(graded).paid, "pending reconcile");
  assert.equal(call(graded).outcome, "pass");
  assert.equal(call(graded).fault, null);
});

test("null-typed fields are unconstrained and a redirect is info unless a paid POST redirect breaks", () => {
  const report = grade([
    row({
      id: "null-type",
      outcome: "shape_mismatch",
      sellerFault: true,
      shapeIssues: [{ path: "$.choices.0.message.reasoning_content", kind: "type", expected: "null", actual: "string" }],
    }),
    row({
      id: "redirect",
      method: "GET",
      url: "https://listed.example/x",
      answeredUrl: "https://www.listed.example/x",
      outcome: "pass",
    }),
    row({
      id: "post-redirect",
      method: "POST",
      httpStatus: 302,
      url: "https://post.example/x",
      answeredUrl: "https://post.example/other",
      outcome: null,
      delivered: false,
    }),
    row({
      id: "rejected",
      method: "GET",
      url: "https://m2m.example/x",
      answeredUrl: "https://www.m2m.example/x",
      httpStatus: 402,
      outcome: null,
      error: "payment rejected",
      delivered: false,
    }),
  ], NOW);
  assert.equal(call(report, "null-type").outcome, "pass");
  assert.equal(call(report, "null-type").severity, null);
  assert.equal(call(report, "null-type").fault, null);
  assert.equal(call(report, "redirect").severity, null);
  assert.equal(call(report, "redirect").fault, null);
  assert.equal(call(report, "redirect").reasons.includes("listing URL redirects"), true);
  assert.equal(call(report, "post-redirect").severity, "S4");
  assert.equal(call(report, "post-redirect").fault, "seller");
  assert.equal(call(report, "post-redirect").reasons.includes("POST redirect changed method"), true);
  assert.equal(call(report, "rejected").fault, "indeterminate");
  assert.equal(call(report, "rejected").severity, null);
  assert.deepEqual(call(report, "rejected").reasons, [
    "listing URL redirects",
    "payment rejected",
    "seller {} | header unknown | x402 none | facilitator none",
  ]);
});

test("null values are not a type failure, and a sample empty result is not empty_result", () => {
  const nullValue = grade([
    row({
      id: "null-value",
      outcome: "shape_mismatch",
      sellerFault: true,
      shapeIssues: [{ path: "$.price", kind: "type", expected: "number", actual: "null" }],
    }),
  ], NOW);
  const sampleEmpty = grade([
    row({
      id: "sample-empty",
      runId: "sample-1",
      outcome: "empty_result",
      sellerFault: true,
      formatMatched: true,
    }),
  ], NOW);
  const pilotEmpty = grade([
    row({
      id: "pilot-empty",
      outcome: "empty_result",
      sellerFault: true,
    }),
  ], NOW);
  assert.equal(call(nullValue, "null-value").outcome, "pass");
  assert.equal(call(nullValue, "null-value").severity, null);
  assert.equal(call(sampleEmpty, "sample-empty").outcome, "pass");
  assert.equal(call(sampleEmpty, "sample-empty").severity, null);
  assert.equal(call(pilotEmpty, "pilot-empty").outcome, "empty_result");
  assert.equal(call(pilotEmpty, "pilot-empty").severity, "S2");
});

test("a payment rejection records the seller text, header, version, and facilitator", () => {
  const report = grade([
    row({
      id: "retcg",
      url: "https://www.retcg.xyz/api/appraise/1",
      httpStatus: 402,
      outcome: null,
      error: "payment rejected",
      delivered: false,
      bodyTruncated: "{}",
      paymentRequirements: { x402Version: 2, accepts: [{ extra: { facilitator: "https://facilitator.example/x402" } }] },
      paymentAttempt: {
        header: "PAYMENT-SIGNATURE",
        headerValueShape: "PAYMENT-SIGNATURE length 12",
        x402Version: 2,
        facilitator: null,
        sellerError: "Payment required",
      },
    }),
    row({
      id: "stored",
      httpStatus: 402,
      outcome: null,
      error: "payment rejected",
      delivered: false,
      bodyTruncated: "{}",
      paymentRequirements: {
        x402Version: 2,
        accepts: [{ extra: { facilitatorUrl: "https://facilitator.example/x402" } }],
      },
    }),
  ], NOW);
  const reasons = call(report, "retcg").reasons;
  assert.equal(reasons.includes("payment rejected"), true);
  assert.equal(
    reasons.includes("seller Payment required | header PAYMENT-SIGNATURE | x402 2 | facilitator none"),
    true,
  );
  assert.equal(
    call(report, "stored").reasons.includes(
      "seller {} | header PAYMENT-SIGNATURE | x402 2 | facilitator https://facilitator.example/x402",
    ),
    true,
  );
});

test("a retest inherits the seller sample frame and invalid input is a test-induced charge", () => {
  const origin = row({
    id: "api.aurelianflo.com-get-api-ofac-wallet-screen-:address",
    url: "https://api.aurelianflo.com/api/ofac-wallet-screen/example",
    runId: "sample-r3-1791078097889",
    timestamp: "2026-10-04T01:45:33.804Z",
    sampleCategory: "onchain/crypto-data",
    outcome: "pass",
    onchainPaid: true,
    onchainAmountUsdc: "0.010000",
  });
  const induced = row({
    id: "aurelianflo-not-an-address",
    url: "https://api.aurelianflo.com/api/ofac-wallet-screen/not-an-address?asset=ETH",
    runId: "aurelianflo-1791079413210",
    timestamp: "2026-10-04T02:04:02.894Z",
    outcome: "assertion_failed",
    sellerFault: true,
    onchainPaid: true,
    onchainAmountUsdc: "0.010000",
  });
  const valid = row({
    id: "aurelianflo-sdn-eth",
    url: "https://api.aurelianflo.com/api/ofac-wallet-screen/0x9697?asset=ETH",
    runId: "aurelianflo-1791079413210",
    timestamp: "2026-10-04T02:04:06.711Z",
    outcome: "pass",
    onchainPaid: true,
    onchainAmountUsdc: "0.010000",
  });
  const pilotSameHost = row({
    id: "pilot-host",
    url: "https://api.aurelianflo.com/other",
    runId: "2026-10-03T19:04:24.072Z",
    timestamp: "2026-10-03T19:04:24.072Z",
    outcome: "no_delivery",
    onchainPaid: true,
    onchainAmountUsdc: "0.005000",
    delivered: false,
  });
  const graded = grade([origin, induced, valid], NOW);
  assert.equal(call(graded, "aurelianflo-not-an-address").sampleFrame, "random-r3");
  assert.equal(call(graded, "aurelianflo-not-an-address").testInduced, true);
  assert.equal(call(graded, "aurelianflo-not-an-address").lossUsd, "0.010000");
  assert.equal(call(graded, "aurelianflo-sdn-eth").sampleFrame, "random-r3");
  assert.equal(call(graded, "aurelianflo-sdn-eth").testInduced, false);

  const report = summarize([origin, induced, valid, pilotSameHost]);
  const higher = report.find((frame) => frame.sampleFrame === "random-r3");
  const pilot = report.find((frame) => frame.sampleFrame === "pilot");
  const combined = report.find((frame) => frame.sampleFrame === "combined");
  assert.ok(higher);
  assert.ok(pilot);
  assert.ok(combined);
  assert.equal(higher.moneyLostUsdc, "0.000000");
  assert.equal(higher.testInducedUsd, "0.010000");
  assert.equal(pilot.moneyLostUsdc, "0.005000");
  assert.equal(pilot.testInducedUsd, "0.000000");
  assert.equal(combined.moneyLostUsdc, "0.005000");
  assert.equal(combined.testInducedUsd, "0.010000");

  const categories = summarizeCategories([origin, induced, valid]);
  const onchain = categories.find((item) => item.category === "onchain/crypto-data");
  assert.ok(onchain);
  assert.equal(onchain.moneyLostUsdc, "0.000000");
  assert.equal(onchain.testInducedUsd, "0.010000");
  assert.match(formatCategoryTable(categories), /test-induced/);

  const marks = grade([
    row({ id: "skip", role: "prepay", finding: "no required input to invalidate", outcome: null, delivered: false }),
    row({ id: "blanked", role: "prepay", finding: "validates after payment", outcome: null, httpStatus: 402, delivered: false }),
  ], NOW);
  assert.equal(call(marks, "skip").testInduced, false);
  assert.equal(call(marks, "blanked").testInduced, true);
});

test("wilson interval is empty without trials and stays inside 0 and 1", () => {
  assert.equal(wilsonInterval(0, 0), null);
  const one = wilsonInterval(1, 1);
  assert.ok(one);
  assert.ok(Math.abs(one.low - 0.2065) < 0.02);
  assert.ok(Math.abs(one.high - 1) < 0.001);
  const none = wilsonInterval(0, 10);
  assert.ok(none);
  assert.equal(none.low, 0);
  assert.ok(none.high > 0.2 && none.high < 0.35);
});
