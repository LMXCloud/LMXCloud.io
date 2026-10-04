import assert from "node:assert/strict";
import test from "node:test";

import type { ProbeResult } from "./probe.js";
import { classifyListing, drawSample, dryRunFailure, hashSeed, hostsFromResults, isAsyncJobExample, mulberry32, shuffle } from "./sample.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function resource(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resource: "https://seller.example/v1/lookup",
    type: "http",
    x402Version: 2,
    description: "Look up a public record",
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "10000",
      payTo: "0x1111111111111111111111111111111111111111",
    }],
    extensions: {
      bazaar: {
        info: {
          input: { type: "http", method: "GET" },
          output: { example: { ok: true, value: "found" } },
        },
      },
    },
    ...patch,
  };
}

function result(patch: Partial<ProbeResult>): ProbeResult {
  return {
    id: "seller",
    url: "https://seller.example/v1/lookup",
    method: "GET",
    timestamp: "2026-10-03T00:00:00.000Z",
    dryRun: true,
    listedPriceUsdc: "0.010000",
    quotedPriceUsdc: "0.010000",
    scheme: "exact",
    paymentRequirements: null,
    settlementTx: null,
    settled: false,
    httpStatus: 402,
    latencyMs: 20,
    bodyTruncated: null,
    bodySha256: null,
    bodyBytes: null,
    bodyIncomplete: false,
    bodySource: null,
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
    level: 0,
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
    runId: "sample",
    runSpentUsdc: "0.000000",
    ...patch,
  };
}

test("a seeded shuffle is stable and a different seed diverges", () => {
  const items = ["a", "b", "c", "d", "e", "f"];
  const once = shuffle(items, mulberry32(hashSeed("1728000000000")));
  const twice = shuffle(items, mulberry32(hashSeed("1728000000000")));
  assert.deepEqual(once, twice);
  assert.notDeepEqual(once, shuffle(items, mulberry32(hashSeed("1728000000001"))));
});

test("eligibility keeps a cheap v2 exact call and counts every other reason once", () => {
  const draw = drawSample({
    seed: "7",
    n: 5,
    pilotHosts: new Set(["pilot.example"]),
    resources: [
      resource(),
      resource({ resource: "https://seller.example/v1/other", description: "another lookup" }),
      resource({ x402Version: 1, resource: "https://v1.example/x" }),
      resource({
        resource: "https://upto.example/x",
        accepts: [{ scheme: "upto", network: "eip155:8453", asset: USDC, amount: "1000", payTo: "0x1" }],
      }),
      resource({
        resource: "https://free.example/x",
        accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "0", payTo: "0x1" }],
      }),
      resource({
        resource: "https://pricey.example/x",
        accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "20001", payTo: "0x1" }],
      }),
      resource({
        resource: "https://needs-query.example/x",
        extensions: {
          bazaar: {
            info: { input: { method: "GET" }, output: { example: { ok: true } } },
            schema: {
              properties: {
                input: {
                  properties: {
                    queryParams: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      }),
      resource({
        resource: "https://no-output.example/x",
        extensions: { bazaar: { info: { input: { method: "GET" } } } },
      }),
      resource({ resource: "https://api.lmxcloud.io/v1/lookup" }),
      resource({ resource: "https://pilot.example/v1/lookup" }),
      resource({ resource: "https://swap.example/trade/quote", description: "swap a token" }),
      resource({
        resource: "https://jobs.example/v1/work",
        extensions: {
          bazaar: {
            info: {
              input: { method: "GET" },
              output: { example: { jobId: "job_1", status: "queued" } },
            },
          },
        },
      }),
      resource({
        resource: "https://post.example/v1/search",
        extensions: {
          bazaar: {
            info: {
              input: { method: "POST", body: { q: "bitcoin" } },
              output: { example: { results: [{ title: "Bitcoin" }] } },
            },
          },
        },
      }),
      { resource: "not a url" },
    ],
  });

  assert.equal(draw.eligible.length, 2);
  assert.deepEqual(draw.eligible.map((item) => item.host).sort(), ["post.example", "seller.example"]);
  assert.equal(draw.exclusions["duplicate-host"], 1);
  assert.equal(draw.exclusions["not-v2"], 1);
  assert.equal(draw.exclusions["not-exact-base-usdc"], 1);
  assert.equal(draw.exclusions.price, 2);
  assert.equal(draw.exclusions["missing-input"], 1);
  assert.equal(draw.exclusions["missing-output"], 1);
  assert.equal(draw.exclusions.lmxcloud, 1);
  assert.equal(draw.exclusions["pilot-host"], 1);
  assert.equal(draw.exclusions["side-effect"], 1);
  assert.equal(draw.exclusions.async, 1);
  assert.equal(draw.exclusions.invalid, 1);
  assert.equal(draw.selected.length, 2);
  assert.equal(draw.queue.length, 0);
});

test("the same seed draws the same hosts", () => {
  const resources = ["a", "b", "c", "d", "e"].map((name) => resource({
    resource: `https://${name}.example/v1/lookup`,
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: String(1000 + name.charCodeAt(0)), payTo: "0x1" }],
  }));
  const left = drawSample({ resources, pilotHosts: new Set(), n: 3, seed: "99" });
  const right = drawSample({ resources, pilotHosts: new Set(), n: 3, seed: "99" });
  assert.deepEqual(left.selected.map((item) => item.host), right.selected.map((item) => item.host));
  assert.deepEqual(left.queue.map((item) => item.host), right.queue.map((item) => item.host));
});

test("a null output example is gradeable and a job handle is not", () => {
  assert.equal(isAsyncJobExample(null), false);
  assert.equal(isAsyncJobExample({ status: "ok", data: { value: 1 } }), false);
  assert.equal(isAsyncJobExample({ job_id: "1", status: "completed", result: { ok: true } }), false);
  assert.equal(isAsyncJobExample({ id: "1", status: "queued" }), true);
  const draw = drawSample({
    seed: "1",
    n: 1,
    pilotHosts: new Set(),
    resources: [resource({
      extensions: { bazaar: { info: { input: { method: "GET" }, output: { example: null } } } },
    })],
  });
  assert.equal(draw.eligible.length, 1);
});

test("booking and registration listings are side effects", () => {
  const draw = drawSample({
    seed: "book",
    n: 1,
    pilotHosts: new Set(),
    resources: [resource({ resource: "https://book.example/api/book", description: "reserve a slot" })],
  });
  assert.equal(draw.eligible.length, 0);
  assert.equal(draw.exclusions["side-effect"], 1);
});

test("a listing is classified from its path and description", () => {
  assert.equal(classifyListing({ description: "LLM chat completion" }, "https://ai.example/v1/chat"), "ai-generation");
  assert.equal(classifyListing({ description: "extract the article" }, "https://scrape.example/v1/extract"), "scraping/extraction");
  assert.equal(classifyListing({ description: "web search" }, "https://find.example/v1/search"), "search/research");
  assert.equal(classifyListing({ description: "stock price" }, "https://fx.example/v1/ticker"), "finance/market-data");
  assert.equal(classifyListing({ description: "onchain block" }, "https://rpc.example/v1/rpc"), "onchain/crypto-data");
  assert.equal(classifyListing({ description: "public record" }, "https://misc.example/v1/lookup"), "other");
});

test("random-r3 keeps one cent through five cents, drops tested hosts, and fills a short category from other", () => {
  const priced = (host: string, path: string, atomic: string, description: string) => resource({
    resource: `https://${host}${path}`,
    description,
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: atomic, payTo: "0x1" }],
  });
  const draw = drawSample({
    seed: "r3",
    n: 5,
    stratify: true,
    minUsdc: 0.01,
    maxUsdc: 0.05,
    pilotHosts: new Set(["pilot.example"]),
    testedHosts: new Set(["seen.example"]),
    resources: [
      priced("seen.example", "/v1/lookup", "20000", "public record"),
      priced("pilot.example", "/v1/lookup", "20000", "public record"),
      priced("cheap.example", "/v1/lookup", "9999", "public record"),
      priced("rich.example", "/v1/lookup", "50001", "public record"),
      priced("edge.example", "/v1/lookup", "50000", "public record"),
      priced("floor.example", "/v1/lookup", "10000", "public record"),
      priced("scrape.example", "/v1/extract", "20000", "extract a page"),
      priced("search.example", "/v1/search", "20000", "web search"),
      priced("fx.example", "/v1/ticker", "20000", "stock price"),
      priced("rpc.example", "/v1/rpc", "20000", "onchain block"),
    ],
  });
  assert.equal(draw.exclusions["tested-host"], 1);
  assert.equal(draw.exclusions["pilot-host"], 1);
  assert.equal(draw.exclusions.price, 2);
  assert.equal(draw.pools["ai-generation"], 0);
  assert.equal(draw.pools.other, 2);
  assert.equal(draw.selected.length, 5);
  assert.equal(draw.selected.filter((item) => item.category === "other").length, 1);
  assert.equal(draw.queues["scraping/extraction"].length, 0);
  assert.equal(hostsFromResults([{ url: "https://Seen.example/x" }]).has("seen.example"), true);
});

test("dry-run replacement reasons are not a 402, a price mismatch, v1, or a missing input", () => {
  assert.equal(dryRunFailure(result({})), null);
  assert.match(dryRunFailure(result({ httpStatus: 404, error: "Expected 402 Payment Required, got 404" })) ?? "", /404/);
  assert.equal(dryRunFailure(result({ refusal: "v1-unsupported" })), "v1");
  assert.equal(dryRunFailure(result({ refusal: "no-input", outcome: "input_fault" })), "missing input");
  assert.equal(
    dryRunFailure(result({ refusal: "402 price 0.050000 USDC differs from listed 0.010000 USDC" })),
    "price mismatch",
  );
});
