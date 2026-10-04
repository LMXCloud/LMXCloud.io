import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreflight,
  dropBlockedTargets,
  DRY_RUN_MAX_AGE_MS,
  formatPreflightTable,
  type PreflightWallet,
} from "./preflight.js";
import { usdcToAtomic } from "./price.js";
import type { ProbeResult, ProbeTarget } from "./probe.js";

const NOW = new Date("2026-10-03T18:00:00.000Z");
const FRESH = new Date(NOW.getTime() - DRY_RUN_MAX_AGE_MS + 1_000).toISOString();
const STALE = new Date(NOW.getTime() - DRY_RUN_MAX_AGE_MS).toISOString();
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";

function target(patch: Partial<ProbeTarget> = {}): ProbeTarget {
  return {
    id: "chat",
    url: "https://seller.example/v1/chat",
    method: "POST",
    listedPriceUsdc: 0.001,
    paid: true,
    body: { model: "llama", messages: [{ role: "user", content: "ping" }] },
    payTo: PAY_TO,
    level: 1,
    ...patch,
  };
}

function payment(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "1000",
      payTo: PAY_TO,
    }],
    ...patch,
  };
}

function dry(patch: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id: "chat",
    url: "https://seller.example/v1/chat",
    method: "POST",
    timestamp: FRESH,
    dryRun: true,
    listedPriceUsdc: "0.001000",
    quotedPriceUsdc: "0.001000",
    scheme: "exact",
    paymentRequirements: payment(),
    settlementTx: null,
    settled: false,
    httpStatus: 402,
    latencyMs: 10,
    bodyTruncated: null,
    bodySha256: null,
    bodyBytes: null,
    bodyIncomplete: false,
    bodySource: "probe",
    balanceBeforeUsdc: null,
    balanceAfterUsdc: null,
    balanceDeltaUsdc: null,
    paymentAuth: null,
    delivered: false,
    formatMatched: "na",
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
    outcome: null,
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
    runId: "run-new",
    runSpentUsdc: "0",
    ...patch,
  };
}

const funded: PreflightWallet = {
  address: "0x2222222222222222222222222222222222222222",
  balanceAtomic: usdcToAtomic(1),
  error: null,
};

function row(report: ReturnType<typeof buildPreflight>, label: string) {
  const found = report.rows.find((item) => item.target === label);
  assert.ok(found, label);
  return found;
}

function reportFor(
  targets: ProbeTarget[],
  results: ProbeResult[],
  wallet: PreflightWallet = funded,
  spendCapUsdc = 0.25,
) {
  return buildPreflight({
    targets,
    results,
    now: NOW,
    spendCapAtomic: usdcToAtomic(spendCapUsdc),
    wallet,
  });
}

test("a fresh exact Base USDC v2 402 with complete input is ready", () => {
  const report = reportFor([target()], [dry()]);
  assert.equal(row(report, "chat").status, "ready");
  assert.equal(row(report, "chat").reason, "");
  assert.equal(row(report, `wallet ${funded.address}`).status, "ready");
  assert.equal(row(report, "canary chat").status, "ready");
  assert.equal(row(report, "canary chat").reason, "cheapest L1");
  assert.equal(row(report, "spend").status, "ready");
  assert.match(row(report, "spend").reason, /expected \$0\.003000 vs cap \$0\.250000/);
  assert.equal(report.ok, true);
});

test("404, redirect loop, and v1 block a paid target", () => {
  const report = reportFor(
    [
      target({ id: "dead", url: "https://dead.example/" }),
      target({ id: "loop", url: "https://loop.example/" }),
      target({ id: "legacy", url: "https://v1.example/" }),
    ],
    [
      dry({ id: "dead", httpStatus: 404, finding: "listed route is dead", paymentRequirements: null }),
      dry({ id: "loop", httpStatus: 302, paymentRequirements: null }),
      dry({ id: "legacy", refusal: "v1-unsupported", paymentRequirements: { x402Version: 1, accepts: [] } }),
    ],
  );
  assert.equal(row(report, "dead").reason, "404");
  assert.equal(row(report, "loop").reason, "redirect loop");
  assert.equal(row(report, "legacy").reason, "v1");
  assert.equal(report.ok, false);
});

test("price, asset, scheme, and the $0.05 ceiling block", () => {
  const pricey = payment({
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "2000", payTo: PAY_TO }],
  });
  const upto = payment({
    accepts: [{ scheme: "upto", network: "eip155:8453", asset: USDC, amount: "1000", payTo: PAY_TO }],
  });
  const other = payment({
    accepts: [{ scheme: "exact", network: "eip155:1", asset: USDC, amount: "1000", payTo: PAY_TO }],
  });
  const over = payment({
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "60000", payTo: PAY_TO }],
  });
  const report = reportFor(
    [
      target({ id: "price", listedPriceUsdc: 0.001 }),
      target({ id: "upto" }),
      target({ id: "chain" }),
      target({ id: "over", listedPriceUsdc: 0.06 }),
    ],
    [
      dry({ id: "price", paymentRequirements: pricey }),
      dry({ id: "upto", paymentRequirements: upto }),
      dry({ id: "chain", paymentRequirements: other }),
      dry({ id: "over", paymentRequirements: over }),
    ],
    funded,
    1,
  );
  assert.match(row(report, "price").reason, /quoted price differs from listed/);
  assert.match(row(report, "upto").reason, /scheme upto/);
  assert.match(row(report, "chain").reason, /not Base USDC/);
  assert.match(row(report, "over").reason, /over \$0\.05/);
});

test("payTo drift and incomplete input block", () => {
  const declared = payment({
    extensions: {
      bazaar: {
        schema: {
          properties: {
            input: {
              properties: {
                body: {
                  type: "object",
                  properties: { model: { type: "string" }, messages: { type: "array" } },
                  required: ["model", "messages"],
                },
                queryParams: {
                  type: "object",
                  properties: { name: { type: "string" } },
                  required: ["name"],
                },
              },
            },
          },
        },
      },
    },
  });
  const report = reportFor(
    [
      target({ id: "payto" }),
      target({ id: "empty", method: "POST", body: undefined }),
      target({ id: "partial", method: "POST", body: { model: "llama" }, query: { name: "" } }),
    ],
    [
      dry({
        id: "payto",
        listingDrift: [{ field: "payTo", listed: PAY_TO, live: "0x2222222222222222222222222222222222222222", severity: "high" }],
      }),
      dry({ id: "empty", refusal: "no-input", outcome: "input_fault" }),
      dry({ id: "partial", paymentRequirements: declared }),
    ],
  );
  assert.equal(row(report, "payto").reason, "payTo changed");
  assert.match(row(report, "empty").reason, /no-input/);
  assert.match(row(report, "partial").reason, /missing required query name/);
  assert.match(row(report, "partial").reason, /missing required body messages/);
});

test("example query params and a nested body field are not false blocks", () => {
  const examples = payment({
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "1000",
      payTo: PAY_TO,
      outputSchema: {
        input: {
          type: "http",
          method: "GET",
          queryParams: { min_score: "70", limit: "25" },
          required: [],
        },
      },
    }],
  });
  const nested = payment({
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "10000",
      payTo: PAY_TO,
      outputSchema: {
        input: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
      },
    }],
  });
  const report = reportFor(
    [
      target({ id: "feed", method: "GET", body: undefined, level: 0, url: "https://robinx.io/feed/new" }),
      target({
        id: "trade",
        listedPriceUsdc: 0.01,
        level: 0,
        body: { parameters: { symbol: "ETH", side: "long" } },
      }),
    ],
    [
      dry({ id: "feed", method: "GET", paymentRequirements: examples }),
      dry({ id: "trade", paymentRequirements: nested }),
    ],
  );
  assert.equal(row(report, "feed").status, "ready");
  assert.equal(row(report, "trade").status, "ready");
});

test("a stale dry run and a target missing from the latest run are blocked", () => {
  const report = reportFor(
    [target({ id: "stale" }), target({ id: "absent" })],
    [
      dry({ id: "other", timestamp: FRESH, runId: "run-new" }),
      dry({ id: "stale", timestamp: STALE, runId: "run-old" }),
      dry({ id: "absent", timestamp: STALE, runId: "run-old" }),
    ],
  );
  assert.equal(row(report, "stale").reason, "no dry-run result");
  assert.equal(row(report, "absent").reason, "no dry-run result");

  const old = reportFor([target()], [dry({ timestamp: STALE })]);
  assert.equal(row(old, "chat").reason, "dry run is older than 2 hours");
});

test("wallet balance must cover the spend cap, and worst-case spend includes rechecks", () => {
  const thin = reportFor([target()], [dry()], {
    address: funded.address,
    balanceAtomic: usdcToAtomic(0.1),
    error: null,
  });
  assert.equal(row(thin, `wallet ${funded.address}`).status, "blocked");
  assert.match(row(thin, `wallet ${funded.address}`).reason, /below spend cap/);

  const expensive = reportFor(
    [target({ id: "a", listedPriceUsdc: 0.05, level: 0 }), target({ id: "b", listedPriceUsdc: 0.05, level: 1 })],
    [dry({ id: "a" }), dry({ id: "b" })],
    funded,
    0.2,
  );
  assert.equal(row(expensive, "spend").status, "blocked");
  assert.match(row(expensive, "spend").reason, /expected \$0\.250000 exceeds cap \$0\.200000/);
  assert.match(row(expensive, "canary b").reason, /^cheapest L1/);
});

test("a missing key is blocked without the secret appearing in the table", () => {
  const secret = `0x${"ab".repeat(32)}`;
  const report = reportFor([target()], [dry()], {
    address: null,
    balanceAtomic: null,
    error: "LMX_LABS_WALLET_PRIVATE_KEY is required",
  });
  const table = formatPreflightTable(report.rows);
  assert.match(table, /wallet\s+blocked\s+LMX_LABS_WALLET_PRIVATE_KEY is required/);
  assert.equal(table.includes(secret), false);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.match(table, /target\s+status\s+reason/);
});

test("drop-blocked sets paid false and records the reason", () => {
  const raw = [
    { id: "chat", url: "https://seller.example/v1/chat", paid: true, body: { model: "llama" }, _note: "keep" },
    { id: "ok", url: "https://ok.example/", paid: true },
  ];
  const report = reportFor(
    [target(), target({ id: "ok", url: "https://ok.example/", method: "GET", body: undefined, level: 0 })],
    [
      dry({ httpStatus: 404, finding: "listed route is dead", paymentRequirements: null }),
      dry({ id: "ok", method: "GET" }),
    ],
  );
  const dropped = dropBlockedTargets(raw, report.rows);
  assert.deepEqual(dropped.dropped, ["chat"]);
  const chat = dropped.targets[0] as Record<string, unknown>;
  const ok = dropped.targets[1] as Record<string, unknown>;
  assert.equal(chat.paid, false);
  assert.equal(chat.unpaidReason, "404");
  assert.deepEqual(dropBlockedTargets(
    [{ id: "ochinimus.app-get-api-liquidations", paid: true }, { id: "aidress.ai-get-pay-agent-edgar", paid: true }],
    [
      { kind: "target", target: "ochinimus.app-get-api-liquidations", status: "blocked", reason: "404" },
      { kind: "target", target: "aidress.ai-get-pay-agent-edgar", status: "blocked", reason: "Expected 402 Payment Required, got 200" },
    ],
  ).targets.map((item) => (item as { unpaidReason: string }).unpaidReason), [
    "url-unverified: 404",
    "url-unverified: serves website HTML, not x402",
  ]);
  assert.equal(chat._note, "keep");
  assert.equal(ok.paid, true);
  assert.equal("unpaidReason" in ok, false);
});
