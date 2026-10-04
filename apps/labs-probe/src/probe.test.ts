import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentRequired } from "@x402/core/types";

import type { SignedPayment } from "./auth.js";
import { invalidInputTarget, probeTarget, settlementWaitSeconds, type ProbeOptions, type ProbeTarget, type SpendLedger } from "./probe.js";
import { usdcToAtomic } from "./price.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const target: ProbeTarget = {
  id: "chat",
  url: "https://api.lmxcloud.io/v1/chat/completions",
  method: "POST",
  listedPriceUsdc: 0.001,
  body: { model: "llama-3-70b", messages: [{ role: "user", content: "ping" }] },
  expectedSchema: {
    type: "object",
    required: ["choices"],
    properties: { choices: { type: "array", minItems: 1 } },
  },
};

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function requirement(amount: string, scheme = "exact") {
  return {
    scheme,
    network: "eip155:8453",
    asset: USDC,
    amount,
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function paymentHeader(accepts: unknown[]): string {
  return b64({
    x402Version: 2,
    resource: { url: target.url, description: "chat" },
    accepts,
  });
}

function challenge(accepts: unknown[] = [requirement("1000")]): Response {
  return new Response(JSON.stringify({ error: "payment required" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": paymentHeader(accepts),
    },
  });
}

function paidResponse(status: number, body: unknown, settlement?: Record<string, unknown>): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (settlement) headers.set("PAYMENT-RESPONSE", b64(settlement));
  return new Response(JSON.stringify(body), { status, headers });
}

function ledger(capUsdc = 0.25): SpendLedger {
  return { spentAtomic: 0n, capAtomic: usdcToAtomic(capUsdc) };
}

test("canonicalUrl is fetched directly and the listing URL is not", async () => {
  const seen: string[] = [];
  const result = await probeTarget(
    {
      ...target,
      method: "GET",
      body: undefined,
      query: { q: "1" },
      url: "https://listed.example/v1",
      canonicalUrl: "https://www.listed.example/v1",
    },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async (input) => {
        seen.push(String(input));
        return challenge();
      },
    },
  );
  assert.deepEqual(seen, ["https://www.listed.example/v1?q=1"]);
  assert.equal(result.url, "https://listed.example/v1");
  assert.equal(result.answeredUrl, "https://www.listed.example/v1?q=1");
});

test("dry-run fetches the 402 once and does not sign", async () => {
  let calls = 0;
  let signs = 0;
  const result = await probeTarget(target, {
    dryRun: true,
    ledger: ledger(),
    signPayment: async () => {
      signs += 1;
      return { "PAYMENT-SIGNATURE": "nope" };
    },
    fetchImpl: async () => {
      calls += 1;
      return challenge();
    },
    now: () => new Date("2026-10-02T15:00:00.000Z"),
  });

  assert.equal(calls, 1);
  assert.equal(signs, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.quotedPriceUsdc, "0.001000");
  assert.equal(result.delivered, false);
  assert.equal(result.formatMatched, "na");
  assert.equal(result.paidButNoDelivery, false);
  assert.equal(result.refusal, null);
  assert.equal(result.timestamp, "2026-10-02T15:00:00.000Z");
  assert.ok(result.paymentRequirements);
});

test("a price mismatch is refused before any signature", async () => {
  let calls = 0;
  let signs = 0;
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async () => {
      signs += 1;
      return {};
    },
    fetchImpl: async () => {
      calls += 1;
      return challenge([requirement("2000")]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(signs, 0);
  assert.match(result.refusal ?? "", /differs from listed/);
  assert.equal(result.paidButNoDelivery, false);
});

test("an expensive sibling does not get signed", async () => {
  const signed: PaymentRequired[] = [];
  await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async (required) => {
      signed.push(required);
      return { "PAYMENT-SIGNATURE": "once" };
    },
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return paidResponse(200, { choices: [{ index: 0 }] }, {
          success: true,
          transaction: "0xpaid",
          network: "eip155:8453",
        });
      }
      return challenge([requirement("60000"), requirement("1000", "upto")]);
    },
  });

  assert.equal(signed.length, 1);
  assert.equal(signed[0]?.accepts.length, 1);
  assert.equal(signed[0]?.accepts[0]?.amount, "1000");
  assert.equal(signed[0]?.accepts[0]?.scheme, "upto");
});

test("a settled failure is recorded once and not retried", async () => {
  let calls = 0;
  let signs = 0;
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async () => {
      signs += 1;
      return { "PAYMENT-SIGNATURE": "once" };
    },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return paidResponse(500, { error: "upstream blew up" }, {
          success: true,
          transaction: "0xsettled",
          network: "eip155:8453",
          amount: "1000",
        });
      }
      return challenge();
    },
  });

  assert.equal(calls, 2);
  assert.equal(signs, 1);
  assert.equal(result.httpStatus, 500);
  assert.equal(result.settled, true);
  assert.equal(result.settlementTx, "0xsettled");
  assert.equal(result.delivered, false);
  assert.equal(result.formatMatched, false);
  assert.equal(result.paidButNoDelivery, true);
  assert.equal(result.bodySha256?.length, 64);
  assert.ok(result.bodyTruncated?.includes("upstream blew up"));
});

test("a hung paid response is not retried and holds the spend reservation", async () => {
  let calls = 0;
  const book = ledger(0.05);
  const first = await probeTarget(
    { ...target, listedPriceUsdc: 0.04 },
    {
      dryRun: false,
      ledger: book,
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (_url, init) => {
        calls += 1;
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) throw new Error("socket hang up");
        return challenge([requirement("40000")]);
      },
    },
  );

  const secondSigns: number[] = [];
  const second = await probeTarget(
    { ...target, id: "next", listedPriceUsdc: 0.02 },
    {
      dryRun: false,
      ledger: book,
      signPayment: async () => {
        secondSigns.push(1);
        return {};
      },
      fetchImpl: async () => {
        calls += 1;
        return challenge([requirement("20000")]);
      },
    },
  );

  assert.equal(first.paidButNoDelivery, true);
  assert.match(first.error ?? "", /socket hang up/);
  assert.equal(secondSigns.length, 0);
  assert.match(second.refusal ?? "", /spend cap/);
  assert.equal(calls, 3);
});

test("a rejected payment does not count as paid and frees the cap", async () => {
  const book = ledger(0.05);
  const rejected = await probeTarget(
    { ...target, listedPriceUsdc: 0.04 },
    {
      dryRun: false,
      ledger: book,
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(402, { error: "bad signature" });
        return challenge([requirement("40000")]);
      },
    },
  );

  let signed = false;
  const next = await probeTarget(
    { ...target, id: "next", listedPriceUsdc: 0.04 },
    {
      dryRun: false,
      ledger: book,
      signPayment: async () => {
        signed = true;
        return { "PAYMENT-SIGNATURE": "second" };
      },
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) {
          return paidResponse(200, { choices: [{ index: 0 }] }, {
            success: true,
            transaction: "0xok",
            network: "eip155:8453",
            amount: "40000",
          });
        }
        return challenge([requirement("40000")]);
      },
    },
  );

  assert.equal(rejected.paidButNoDelivery, false);
  assert.equal(rejected.error, "payment rejected");
  assert.equal(signed, true);
  assert.equal(next.delivered, true);
  assert.equal(next.formatMatched, true);
  assert.equal(next.paidButNoDelivery, false);
  assert.equal(next.settlementTx, "0xok");
  assert.equal(book.spentAtomic, 40_000n);
});

test("a 402 after a signed payment records server and x402 headers", async () => {
  let balance = 1_000_000n;
  const charged = await probeTarget(
    { ...target, listedPriceUsdc: 0.04 },
    {
      dryRun: false,
      ledger: ledger(0.05),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      readUsdcBalance: async () => balance,
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) {
          balance -= 40_000n;
          return new Response("{}", {
            status: 402,
            headers: {
              "content-type": "application/json",
              server: "nginx",
              "x-powered-by": "Express",
              "x402-version": "2",
              "x402-facilitator": "https://fac.example",
              "x-request-id": "abc",
              "set-cookie": "session=secret",
            },
          });
        }
        return challenge([requirement("40000")]);
      },
    },
  );
  assert.equal(charged.httpStatus, 402);
  assert.equal(charged.balanceDeltaUsdc, "-0.040000");
  assert.deepEqual(charged.paymentAttempt?.responseHeaders, {
    server: "nginx",
    "x-powered-by": "Express",
    "x402-version": "2",
    "x402-facilitator": "https://fac.example",
  });
  assert.equal(charged.paymentAttempt?.responseBody, undefined);

  const rejected = await probeTarget(
    { ...target, id: "reject-headers", listedPriceUsdc: 0.04 },
    {
      dryRun: false,
      ledger: ledger(0.05),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) {
          return new Response(JSON.stringify({ error: "bad signature" }), {
            status: 402,
            headers: {
              "content-type": "application/json",
              Server: "cloudflare",
              "X-Powered-By": "x402",
              "X402-Error": "invalid",
              "x-request-id": "hidden",
            },
          });
        }
        return challenge([requirement("40000")]);
      },
    },
  );
  assert.equal(rejected.error, "payment rejected");
  assert.deepEqual(rejected.paymentAttempt?.responseHeaders, {
    server: "cloudflare",
    "x-powered-by": "x402",
    "x402-error": "invalid",
  });
  assert.equal(rejected.paymentAttempt?.responseBody, JSON.stringify({ error: "bad signature" }));
});

test("an edge-case request is marked test-induced", async () => {
  const result = await probeTarget(
    { ...target, method: "GET", body: undefined, edge: "empty", query: { q: "" }, expectedSchema: undefined },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => challenge(),
    },
  );
  assert.equal(result.testInduced, true);
});

test("a matching delivery counts the settled amount, not a higher authorization", async () => {
  const book = ledger();
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: book,
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return paidResponse(200, { choices: [{ index: 0 }] }, {
          success: true,
          transaction: "0xupto",
          network: "eip155:8453",
          amount: "500",
        });
      }
      return challenge();
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.formatMatched, true);
  assert.equal(result.schemaSource, "expected");
  assert.equal(result.paidButNoDelivery, false);
  assert.equal(book.spentAtomic, 500n);
});

test("uses the listing output schema when the target has none", async () => {
  const output = {
    type: "object",
    required: ["ok"],
    properties: { ok: { type: "boolean" } },
  };
  const header = b64({
    x402Version: 2,
    resource: { url: target.url },
    accepts: [requirement("1000")],
    extensions: { bazaar: { schema: { properties: { output } } } },
  });
  const result = await probeTarget(
    { ...target, expectedSchema: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { ok: true });
        return new Response("{}", {
          status: 402,
          headers: { "PAYMENT-REQUIRED": header },
        });
      },
    },
  );

  assert.equal(result.schemaSource, "listing");
  assert.equal(result.formatMatched, true);
  assert.equal(result.delivered, true);
});

test("v1 requirements are refused and not signed", async () => {
  let signs = 0;
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async () => {
      signs += 1;
      return {};
    },
    fetchImpl: async () => new Response(JSON.stringify({
      x402Version: 1,
      accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "1000" }],
    }), { status: 402, headers: { "content-type": "application/json" } }),
  });

  assert.equal(signs, 0);
  assert.equal(result.refusal, "v1-unsupported");
  assert.equal(result.error, null);
  assert.equal(result.paidButNoDelivery, false);
});

test("an unmatched import marker is not fetched", async () => {
  let calls = 0;
  const result = await probeTarget(
    { ...target, importStatus: "unmatched", url: "https://missing.example/" },
    {
      dryRun: false,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => {
        calls += 1;
        return challenge();
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.refusal, "unmatched");
});

test("wallet balance is the spend and the paid signal", async () => {
  const book = ledger();
  let reads = 0;
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: book,
    readUsdcBalance: async () => {
      reads += 1;
      return reads === 1 ? 1_000_000n : 999_500n;
    },
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return paidResponse(200, { choices: [{ index: 0 }] }, {
          success: true,
          transaction: "0xbal",
          network: "eip155:8453",
          amount: "1000",
        });
      }
      return challenge();
    },
  });

  assert.equal(result.balanceBeforeUsdc, "1.000000");
  assert.equal(result.balanceAfterUsdc, "0.999500");
  assert.equal(result.balanceDeltaUsdc, "-0.000500");
  assert.equal(result.delivered, true);
  assert.equal(result.paidButNoDelivery, false);
  assert.equal(book.spentAtomic, 500n);
});

test("a settle header without a balance drop is not paid", async () => {
  const book = ledger();
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: book,
    readUsdcBalance: async () => 1_000_000n,
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return paidResponse(200, { choices: [{ index: 0 }] }, {
          success: true,
          transaction: "0xnoop",
          network: "eip155:8453",
        });
      }
      return challenge();
    },
  });

  assert.equal(result.balanceDeltaUsdc, "0.000000");
  assert.equal(result.delivered, false);
  assert.equal(result.outcome, "pass");
  assert.equal(result.noDelivery, false);
  assert.equal(result.paidButNoDelivery, false);
  assert.equal(book.spentAtomic, 0n);
});

test("settlement wait is the longest signed maxTimeoutSeconds plus 120", () => {
  const seconds = settlementWaitSeconds([
    {
      paymentAuth: null,
      settlementTx: null,
      paymentRequirements: { accepts: [{ maxTimeoutSeconds: 300 }] },
    },
    {
      paymentAuth: { scheme: "exact", authorizer: "0x1", nonce: "0x01" },
      settlementTx: "0xabc",
      paymentRequirements: { accepts: [{ maxTimeoutSeconds: 60 }, { maxTimeoutSeconds: 90 }] },
    },
  ]);
  assert.equal(seconds, 210);
});

test("a signing RPC failure is input_fault and does not send the paid request", async () => {
  let calls = 0;
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async () => {
      throw new Error("RPC Request failed. Details: over rate limit");
    },
    fetchImpl: async () => {
      calls += 1;
      return challenge();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "input_fault");
  assert.equal(result.sellerFault, false);
  assert.match(result.error ?? "", /over rate limit/);
});

test("a 2xx error object is no-delivery and a schema miss is format-fail", async () => {
  let reads = 0;
  const errorBody = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    readUsdcBalance: async () => {
      reads += 1;
      return reads === 1 ? 5_000n : 4_000n;
    },
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { error: { message: "nope" } });
      return challenge();
    },
  });
  assert.equal(errorBody.errorLikeBody, true);
  assert.equal(errorBody.delivered, false);
  assert.equal(errorBody.noDelivery, true);
  assert.equal(errorBody.formatFail, true);
  assert.equal(errorBody.paidButNoDelivery, true);
  assert.equal(errorBody.outcome, "error_body");
  assert.equal(errorBody.sellerFault, true);

  reads = 0;
  const formatMiss = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    readUsdcBalance: async () => {
      reads += 1;
      return reads === 1 ? 5_000n : 4_000n;
    },
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { choices: [] });
      return challenge();
    },
  });
  assert.equal(formatMiss.errorLikeBody, false);
  assert.equal(formatMiss.delivered, true);
  assert.equal(formatMiss.noDelivery, false);
  assert.equal(formatMiss.formatFail, true);
  assert.equal(formatMiss.formatMatched, false);
  assert.equal(formatMiss.paidButNoDelivery, true);
  assert.equal(formatMiss.outcome, "shape_mismatch");
  assert.equal(formatMiss.sellerFault, true);

  reads = 0;
  const html = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    readUsdcBalance: async () => {
      reads += 1;
      return reads === 1 ? 5_000n : 4_000n;
    },
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        return new Response("<!DOCTYPE html><html><body>nope</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return challenge();
    },
  });
  assert.equal(html.errorLikeBody, true);
  assert.equal(html.noDelivery, true);
});

test("the signed authorization nonce is stored on the result", async () => {
  const auth: SignedPayment["auth"] = {
    scheme: "exact",
    authorizer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonce: `0x${"ab".repeat(32)}`,
  };
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    signPayment: async () => ({ headers: { "PAYMENT-SIGNATURE": "once" }, auth }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { choices: [{ index: 0 }] });
      return challenge();
    },
  });
  assert.deepEqual(result.paymentAuth, auth);
  assert.equal(result.delivered, true);
});

test("dry-run evaluates every target and does not consume the spend cap", async () => {
  const book = ledger(0.05);
  const quote = (amount: string) => async () => challenge([requirement(amount)]);
  const first = await probeTarget(
    { ...target, id: "a", listedPriceUsdc: 0.04 },
    { dryRun: true, ledger: book, signPayment: async () => ({}), fetchImpl: quote("40000") },
  );
  const second = await probeTarget(
    { ...target, id: "b", listedPriceUsdc: 0.02 },
    { dryRun: true, ledger: book, signPayment: async () => ({}), fetchImpl: quote("20000") },
  );
  const overCall = await probeTarget(
    { ...target, id: "c", listedPriceUsdc: 0.06 },
    { dryRun: true, ledger: book, signPayment: async () => ({}), fetchImpl: quote("60000") },
  );

  assert.equal(book.spentAtomic, 0n);
  assert.equal(book.projectedAtomic, 40_000n);
  assert.equal(first.refusal, null);
  assert.equal(first.wouldExceedRunCap, null);
  assert.equal(second.refusal, null);
  assert.match(second.wouldExceedRunCap ?? "", /would exceed the run spend cap/);
  assert.match(overCall.refusal ?? "", /\$0\.05/);
  assert.equal(overCall.wouldExceedRunCap, null);
});

test("POST with no body is refused as no-input before any payment", async () => {
  let signs = 0;
  const result = await probeTarget(
    { ...target, body: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      signPayment: async () => {
        signs += 1;
        return {};
      },
      fetchImpl: async () => challenge(),
    },
  );
  assert.equal(signs, 0);
  assert.equal(result.refusal, "no-input");
  assert.equal(result.outcome, "input_fault");
  assert.equal(result.sellerFault, false);
  assert.equal(result.paidButNoDelivery, false);
  assert.equal(result.quotedPriceUsdc, "0.001000");
  assert.equal(result.httpStatus, 402);
});

test("dry-run records listing drift and flags a payTo change", async () => {
  const result = await probeTarget(
    {
      ...target,
      payTo: "0x2222222222222222222222222222222222222222",
      scheme: "exact",
      asset: USDC,
      network: "eip155:8453",
      x402Version: 2,
      mimeType: "application/json",
    },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": b64({
            x402Version: 2,
            resource: { url: target.url, mimeType: "text/plain" },
            accepts: [requirement("1000")],
          }),
        },
      }),
    },
  );
  const payTo = result.listingDrift.find((item) => item.field === "payTo");
  assert.equal(payTo?.severity, "high");
  assert.equal(payTo?.live, "0x1111111111111111111111111111111111111111");
  assert.equal(result.listingDrift.some((item) => item.field === "mimeType"), true);
  assert.equal(result.refusal, null);
});

test("an x402trust 404 tries the api subdomain once and records which URL answered", async () => {
  const seen: string[] = [];
  const result = await probeTarget(
    { ...target, source: "x402trust", url: "https://twit.sh/tweets/by/id", method: "GET" },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async (input) => {
        const href = String(input);
        seen.push(href);
        if (href.startsWith("https://api.twit.sh/")) return challenge();
        return new Response("missing", { status: 404 });
      },
    },
  );
  assert.deepEqual(seen, ["https://twit.sh/tweets/by/id", "https://api.twit.sh/tweets/by/id"]);
  assert.equal(result.answeredUrl, "https://api.twit.sh/tweets/by/id");
  assert.equal(result.httpStatus, 402);
  assert.equal(result.finding, null);
  assert.equal(result.error, null);
});

test("a 404 on the listed URL and the api subdomain is a dead-route finding", async () => {
  let calls = 0;
  const result = await probeTarget(
    { ...target, source: "x402trust", url: "https://robinx.io/feed/new", method: "GET" },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => {
        calls += 1;
        return new Response("no", { status: 404 });
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.finding, "listed route is dead");
  assert.equal(result.error, null);
  assert.equal(result.refusal, null);
  assert.equal(result.httpStatus, 404);
});

test("needs-endpoint is a finding and is not fetched", async () => {
  let calls = 0;
  const result = await probeTarget(
    { ...target, importStatus: "needs-endpoint", listedPriceUsdc: null, url: "https://lonestaroracle.xyz/" },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => {
        calls += 1;
        return challenge();
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.finding, "needs-endpoint");
  assert.equal(result.error, null);
  assert.equal(result.refusal, null);
});

test("price-unknown still fetches the 402 and does not treat the price as zero", async () => {
  const result = await probeTarget(
    { ...target, listedPriceUsdc: null, importStatus: "price-unknown" },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async () => challenge(),
    },
  );
  assert.equal(result.refusal, "price-unknown");
  assert.equal(result.quotedPriceUsdc, "0.001000");
  assert.equal(result.listedPriceUsdc, null);
  assert.equal(result.listingDrift.some((item) => item.field === "price"), false);
});

function droppingBalance(): () => Promise<bigint> {
  let reads = 0;
  return async () => {
    reads += 1;
    return reads === 1 ? 5_000n : 4_000n;
  };
}

function payFetch(paid: (url: string) => Response): ProbeOptions["fetchImpl"] {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("PAYMENT-SIGNATURE")) return paid(String(input));
    return challenge();
  };
}

test("a paid empty payload is empty_result only when results are expected", async () => {
  const empty = await probeTarget(
    { ...target, expectedSchema: undefined, expectNonEmpty: true, outputExample: { results: [{ title: "x" }] } },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, { results: [] })),
    },
  );
  assert.equal(empty.outcome, "empty_result");
  assert.equal(empty.sellerFault, true);
  assert.equal(empty.errorLikeBody, false);

  const allowed = await probeTarget(
    { ...target, expectedSchema: undefined, expectNonEmpty: false, outputExample: { note: "ok" } },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, { note: "ok" })),
    },
  );
  assert.equal(allowed.outcome, "pass");
  assert.equal(allowed.sellerFault, false);
});

test("strict listing shape fails a missing declared key while lenient shape passes", async () => {
  const result = await probeTarget(
    {
      ...target,
      expectedSchema: undefined,
      listingOutputSchema: { type: "object", properties: { results: { type: "array" } } },
    },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, { extra: true })),
    },
  );
  assert.equal(result.shapeLenient, true);
  assert.equal(result.shapeStrict, false);
  assert.equal(result.formatMatched, true);
  assert.equal(result.outcome, "pass");
  assert.equal(result.sellerFault, false);
  assert.equal(result.warnings.some((warning) => warning.path === "$.results"), true);
});

test("a failed assertion records the actual value and does not override a seller delivery miss", async () => {
  const missed = await probeTarget(
    {
      ...target,
      expectedSchema: undefined,
      assertions: [{ path: "address", op: "eq", value: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }],
    },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, { address: "0x0000000000000000000000000000000000000000" })),
    },
  );
  assert.equal(missed.outcome, "assertion_failed");
  assert.equal(missed.assertionResults[0]?.pass, false);
  assert.equal(missed.assertionResults[0]?.actual, "0x0000000000000000000000000000000000000000");

  const charged = await probeTarget(
    { ...target, expectedSchema: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(400, { error: "bad input" })),
    },
  );
  assert.equal(charged.outcome, "charged_for_client_error");
  assert.equal(charged.sellerFault, true);

  const server = await probeTarget(
    { ...target, expectedSchema: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(500, { error: "down" })),
    },
  );
  assert.equal(server.outcome, "server_error_after_payment");
});

test("a timeout after the payment is sent is timeout_after_payment", async () => {
  const result = await probeTarget(target, {
    dryRun: false,
    ledger: ledger(),
    readUsdcBalance: droppingBalance(),
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("PAYMENT-SIGNATURE")) {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return challenge();
    },
  });
  assert.equal(result.outcome, "timeout_after_payment");
  assert.equal(result.sellerFault, true);
  assert.equal(result.paidButNoDelivery, true);
});

test("content type is compared to the 402 mime type, ignoring charset", async () => {
  const mismatch = await probeTarget(
    { ...target, expectedSchema: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { ok: true });
        return new Response("payment required", {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": b64({
              x402Version: 2,
              resource: { url: target.url, mimeType: "text/plain" },
              accepts: [requirement("1000")],
            }),
          },
        });
      },
    },
  );
  assert.equal(mismatch.contentTypeMatched, false);
  assert.equal(mismatch.outcome, "pass");
  assert.equal(mismatch.sellerFault, false);
  assert.equal(mismatch.warnings.some((warning) => warning.path === "$"), true);
});

test("one https redirect is followed and the paid call uses the URL that answered", async () => {
  const seen: string[] = [];
  const result = await probeTarget(
    { ...target, source: "x402trust", url: "https://twit.sh/tweets/by/id", method: "GET", body: undefined, expectedSchema: undefined },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: async (input, init) => {
        const href = String(input);
        seen.push(href);
        const headers = new Headers(init?.headers);
        if (headers.get("PAYMENT-SIGNATURE")) return paidResponse(200, { data: { text: "Running bitcoin" } });
        if (href.startsWith("https://twit.sh/")) {
          return new Response(null, { status: 301, headers: { location: "https://x402.twit.sh/tweets/by/id?id=1110302988" } });
        }
        return challenge();
      },
    },
  );
  assert.deepEqual(seen, [
    "https://twit.sh/tweets/by/id",
    "https://x402.twit.sh/tweets/by/id?id=1110302988",
    "https://x402.twit.sh/tweets/by/id?id=1110302988",
  ]);
  assert.equal(result.answeredUrl, "https://x402.twit.sh/tweets/by/id?id=1110302988");
  assert.equal(result.outcome, "pass");
});

test("an api subdomain that does not resolve is a dead route, not a transport error", async () => {
  const result = await probeTarget(
    { ...target, source: "x402trust", url: "https://example.test/api/evmtoken", method: "GET", body: undefined },
    {
      dryRun: true,
      ledger: ledger(),
      signPayment: async () => ({}),
      fetchImpl: async (input) => {
        if (String(input).includes("api.")) throw new Error("getaddrinfo ENOTFOUND");
        return new Response("no", { status: 404 });
      },
    },
  );
  assert.equal(result.finding, "listed route is dead");
  assert.equal(result.error, null);
  assert.equal(result.sellerFault, false);
});

test("a live-data body that matches every prior hash is stale, and a dead head RPC is input_fault", async () => {
  const { createHash } = await import("node:crypto");
  const payload = { result: "0x64" };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const stale = await probeTarget(
    {
      ...target,
      expectedSchema: undefined,
      liveData: true,
      assertions: [{ path: "result", op: "matches", value: "^0x[0-9a-fA-F]+$" }],
      blockHead: { path: "result", within: 100 },
    },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      priorBodyHashes: [hash],
      readHeadBlock: async () => 80n,
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, payload)),
    },
  );
  assert.equal(stale.outcome, "pass");
  assert.equal(stale.staleCache, true);
  assert.equal(stale.assertionResults.find((item) => item.op === "withinBlocks")?.pass, true);

  const down = await probeTarget(
    {
      ...target,
      expectedSchema: undefined,
      blockHead: { path: "result", within: 100 },
      assertions: [{ path: "result", op: "matches", value: "^0x[0-9a-fA-F]+$" }],
    },
    {
      dryRun: false,
      ledger: ledger(),
      readUsdcBalance: droppingBalance(),
      readHeadBlock: async () => {
        throw new Error("rpc down");
      },
      signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
      fetchImpl: payFetch(() => paidResponse(200, payload)),
    },
  );
  assert.equal(down.outcome, "input_fault");
  assert.equal(down.sellerFault, false);
  assert.equal(down.paidButNoDelivery, false);
});

test("daily rotation selects the case body and its assertions", async () => {
  const seen: string[] = [];
  const rotating = {
    ...target,
    expectedSchema: undefined,
    rotateDaily: [
      { body: { sql: "SELECT 1" }, assertions: [{ path: "verdict", op: "eq" as const, value: "pass" }] },
      { body: { sql: "SELECT 1; DROP TABLE users" }, assertions: [{ path: "verdict", op: "eq" as const, value: "block" }] },
    ],
  };
  await probeTarget(rotating, {
    dryRun: true,
    ledger: ledger(),
    now: () => new Date(0),
    signPayment: async () => ({}),
    fetchImpl: async (_url, init) => {
      seen.push(String(init?.body));
      return challenge();
    },
  });
  const second = await probeTarget(rotating, {
    dryRun: false,
    ledger: ledger(),
    schedulePerDay: 2,
    now: () => new Date(12 * 60 * 60 * 1000),
    readUsdcBalance: droppingBalance(),
    signPayment: async () => ({ "PAYMENT-SIGNATURE": "once" }),
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.get("PAYMENT-SIGNATURE")) {
        seen.push(String(init?.body));
        return challenge();
      }
      return paidResponse(200, { verdict: "block" });
    },
  });
  assert.equal(seen[0], JSON.stringify({ sql: "SELECT 1" }));
  assert.equal(seen[1], JSON.stringify({ sql: "SELECT 1; DROP TABLE users" }));
  assert.equal(second.rotationIndex, 1);
  assert.equal(second.outcome, "pass");
  assert.equal(second.assertionResults[0]?.actual, "block");
});

test("requests use a generic agent user-agent", async () => {
  let agent = "";
  await probeTarget(target, {
    dryRun: true,
    ledger: ledger(),
    signPayment: async () => ({}),
    fetchImpl: async (_url, init) => {
      agent = new Headers(init?.headers).get("user-agent") ?? "";
      return challenge();
    },
  });
  assert.match(agent, /Agent\/1\.0/);
  assert.equal(/lmx|labs/i.test(agent), false);
});

test("prepay blanks or removes a required field and never signs", async () => {
  let signs = 0;
  const bodies: string[] = [];
  const requiredHeader = b64({
    x402Version: 2,
    resource: { url: target.url, description: "chat" },
    accepts: [requirement("1000")],
    extensions: {
      bazaar: {
        schema: {
          properties: {
            input: {
              properties: {
                body: {
                  type: "object",
                  properties: {
                    model: { type: "string" },
                    messages: { type: "array" },
                    temperature: { type: "number" },
                  },
                  required: ["messages"],
                },
              },
            },
          },
        },
      },
    },
  });
  const accepted = await probeTarget(
    { ...target, body: { model: "llama-3-70b", messages: [{ role: "user", content: "ping" }], temperature: 0 } },
    {
      dryRun: false,
      role: "prepay",
      ledger: ledger(),
      signPayment: async () => {
        signs += 1;
        return {};
      },
      fetchImpl: async (_url, init) => {
        bodies.push(String(init?.body));
        if (bodies.length === 1) {
          return new Response(JSON.stringify({ error: "payment required" }), {
            status: 402,
            headers: { "content-type": "application/json", "PAYMENT-REQUIRED": requiredHeader },
          });
        }
        return new Response(JSON.stringify({ error: "bad" }), { status: 400, headers: { "content-type": "application/json" } });
      },
    },
  );
  assert.equal(signs, 0);
  assert.equal(bodies[0], JSON.stringify({ model: "llama-3-70b", messages: [{ role: "user", content: "ping" }], temperature: 0 }));
  assert.equal(bodies[1], JSON.stringify({ model: "llama-3-70b", temperature: 0 }));
  assert.equal(bodies.some((body) => body.includes("__invalid")), false);
  assert.equal(accepted.outcome, "pass");
  assert.equal(accepted.role, "prepay");
  assert.equal(accepted.sellerFault, false);
  assert.equal(accepted.testInduced, true);

  const urls: string[] = [];
  const charged = await probeTarget(
    { ...target, method: "GET", body: undefined, query: { name: "vitalik.eth", chain: "base" }, expectedSchema: undefined },
    {
      dryRun: false,
      role: "prepay",
      ledger: ledger(),
      signPayment: async () => {
        signs += 1;
        return {};
      },
      fetchImpl: async (input) => {
        urls.push(String(input));
        const header = b64({
          x402Version: 2,
          accepts: [requirement("1000")],
          extensions: {
            bazaar: {
              schema: {
                properties: {
                  input: {
                    properties: {
                      queryParams: {
                        type: "object",
                        properties: { name: { type: "string" }, chain: { type: "string" } },
                        required: ["name"],
                      },
                    },
                  },
                },
              },
            },
          },
        });
        return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } });
      },
    },
  );
  assert.equal(signs, 0);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!).searchParams.get("name"), "");
  assert.equal(new URL(urls[1]!).searchParams.get("chain"), "base");
  assert.equal(urls.some((url) => url.includes("__invalid")), false);
  assert.equal(charged.httpStatus, 402);
  assert.equal(charged.finding, "validates after payment");
  assert.equal(charged.outcome, null);
  assert.equal(charged.sellerFault, false);
});

test("prepay skips a GET with no required input instead of flagging it", async () => {
  const bare = [
    { id: "robinx.io-get-feed-new", url: "https://robinx.io/feed/new" },
    { id: "underscoredone.com-get-cpi", url: "https://underscoredone.com/cpi" },
    { id: "houjin.agentic-jp.com-get-stats", url: "https://houjin.agentic-jp.com/stats" },
    { id: "rubric-protocol.com-get-v1-x402-hedera-facts-anchor-cost", url: "https://rubric-protocol.com/v1/x402/hedera-facts/anchor-cost" },
  ];
  const wrapper = b64({
    x402Version: 2,
    accepts: [requirement("1000")],
    extensions: {
      bazaar: {
        info: { input: { type: "http", method: "GET" } },
        schema: {
          properties: {
            input: {
              type: "object",
              properties: {
                type: { type: "string" },
                method: { type: "string" },
                queryParams: { type: "object", properties: {} },
              },
              required: ["type", "method"],
            },
          },
          required: ["input"],
        },
      },
    },
  });
  for (const sample of bare) {
    let calls = 0;
    let signs = 0;
    const result = await probeTarget(
      { ...sample, method: "GET", listedPriceUsdc: 0.01 },
      {
        dryRun: false,
        role: "prepay",
        ledger: ledger(),
        signPayment: async () => {
          signs += 1;
          return {};
        },
        fetchImpl: async (input) => {
          calls += 1;
          const url = new URL(String(input));
          assert.equal(url.search, "");
          assert.equal(url.searchParams.has("__invalid"), false);
          return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": wrapper } });
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(signs, 0);
    assert.equal(result.finding, "no required input to invalidate");
    assert.equal(result.outcome, null);
    assert.equal(result.sellerFault, false);
    assert.equal(result.error, null);
    assert.equal(result.testInduced, undefined);
  }
});

test("invalid input removes a required field and does not invent one", () => {
  const post: ProbeTarget = {
    url: "https://api.example/chat",
    method: "POST",
    listedPriceUsdc: 0.001,
    body: { model: "llama", messages: [{ role: "user", content: "ping" }] },
  };
  const invalidated = invalidInputTarget(post, { query: [], body: ["messages"] });
  assert.deepEqual(invalidated?.body, { model: "llama" });

  const bare: ProbeTarget = {
    url: "https://robinx.io/feed/new",
    method: "GET",
    listedPriceUsdc: 0.01,
  };
  assert.equal(invalidInputTarget(bare, { query: [], body: [] }), null);
  assert.equal(invalidInputTarget(bare, { query: ["city"], body: [] }), null);

  const named: ProbeTarget = {
    url: "https://chain.example/ens",
    method: "GET",
    listedPriceUsdc: 0.003,
    query: { name: "vitalik.eth", chain: "base" },
  };
  assert.deepEqual(invalidInputTarget(named, { query: [], body: [] })?.query, { name: "", chain: "base" });
});

test("prepay reads a v1 outputSchema input and removes that field", async () => {
  const bodies: string[] = [];
  const result = await probeTarget(target, {
    dryRun: false,
    role: "prepay",
    ledger: ledger(),
    signPayment: async () => ({}),
    fetchImpl: async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        return new Response(JSON.stringify({
          x402Version: 1,
          accepts: [{
            outputSchema: {
              input: {
                type: "http",
                method: "POST",
                body: {
                  type: "object",
                  properties: { model: { type: "string" }, messages: { type: "array" } },
                  required: ["model"],
                },
              },
            },
          }],
        }), { status: 402, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(bodies[0], JSON.stringify(target.body));
  assert.equal(bodies[1], JSON.stringify({ messages: [{ role: "user", content: "ping" }] }));
  assert.equal(bodies.some((body) => body.includes("__invalid")), false);
  assert.equal(result.finding, "validates after payment");
  assert.equal(result.sellerFault, false);
});
