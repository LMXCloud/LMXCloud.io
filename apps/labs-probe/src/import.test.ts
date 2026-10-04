import assert from "node:assert/strict";
import test from "node:test";

import { concreteParamText, importListings, resourceToListing, type DiscoveryPage } from "./import.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function resource(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resource: "https://api.lmxcloud.io/v1/chat/completions",
    type: "http",
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "1000",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 60,
      mimeType: "application/json",
      extra: {},
    }],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: { model: "llama-3-70b", messages: [{ role: "user", content: "ping" }] },
          },
          output: { example: { id: "chatcmpl-1", choices: [{ index: 0 }] } },
        },
        schema: {
          properties: {
            output: {
              type: "object",
              properties: {
                type: { type: "string" },
                example: {
                  type: "object",
                  required: ["id", "choices"],
                  properties: {
                    id: { type: "string" },
                    choices: { type: "array" },
                  },
                },
              },
            },
          },
        },
      },
    },
    ...patch,
  };
}

test("import writes the listing request, price, version, and output schema", async () => {
  const pages: DiscoveryPage[] = [
    {
      items: [
        resource(),
        resource({
          resource: "https://other.example/skip",
          x402Version: 2,
        }),
        {
          resource: "https://api.lmxcloud.io/v1/legacy",
          type: "http",
          x402Version: 1,
          accepts: [{
            scheme: "exact",
            network: "eip155:8453",
            asset: USDC,
            maxAmountRequired: "2000",
            payTo: "0x1111111111111111111111111111111111111111",
          }],
          extensions: {
            bazaar: {
              info: {
                input: { type: "http", method: "GET", queryParams: { q: "cats" } },
                output: { example: { ok: true } },
              },
            },
          },
        },
      ],
      pagination: { total: 3 },
    },
  ];
  const result = await importListings({
    domain: "api.lmxcloud.io",
    existing: [],
    pageSize: 10,
    fetchPage: async (offset) => pages[offset === 0 ? 0 : 1] ?? { items: [], pagination: { total: 3 } },
  });

  assert.equal(result.matched, 2);
  assert.equal(result.v1Only, 1);
  assert.equal(result.unmatched, false);
  const chat = result.targets[0] as Record<string, unknown>;
  assert.equal(chat.method, "POST");
  assert.equal(chat.listedPriceUsdc, 0.001);
  assert.equal(chat.x402Version, 2);
  assert.equal(chat.source, "bazaar");
  assert.equal(chat.payTo, "0x1111111111111111111111111111111111111111");
  assert.equal(chat.scheme, "exact");
  assert.equal(String(chat.asset).toLowerCase(), USDC.toLowerCase());
  assert.equal(chat.network, "eip155:8453");
  assert.equal(chat.mimeType, "application/json");
  assert.deepEqual(chat.body, { model: "llama-3-70b", messages: [{ role: "user", content: "ping" }] });
  assert.deepEqual(chat.outputExample, { id: "chatcmpl-1", choices: [{ index: 0 }] });
  assert.equal((chat.listingOutputSchema as { required?: string[] }).required?.[0], "id");

  const legacy = result.targets[1] as Record<string, unknown>;
  assert.equal(legacy.importStatus, "v1-only");
  assert.equal(legacy.x402Version, 1);
  assert.equal(legacy.listedPriceUsdc, 0.002);
  assert.equal(legacy.method, "GET");
  assert.match(String(legacy.url), /q=cats/);
});

test("an unknown host is marked unmatched instead of omitted", async () => {
  const result = await importListings({
    domain: "missing.example",
    path: "/v1/chat",
    existing: [{ id: "keep", url: "https://api.lmxcloud.io/v1/chat/completions", method: "POST", listedPriceUsdc: 0.001 }],
    fetchPage: async () => ({
      items: [resource()],
      pagination: { total: 1 },
    }),
  });

  assert.equal(result.unmatched, true);
  assert.equal(result.matched, 0);
  const marker = result.targets.find((item) => {
    return typeof item === "object" && item !== null && (item as { importStatus?: string }).importStatus === "unmatched";
  }) as Record<string, unknown>;
  assert.equal(marker.id, "unmatched:missing.example:/v1/chat");
  assert.equal(marker.domain, "missing.example");
  assert.equal(result.targets.some((item) => (item as { id?: string }).id === "keep"), true);
});

test("re-import keeps operator body and expectedSchema edits", async () => {
  const existing = [{
    id: "lmx-chat",
    url: "https://api.lmxcloud.io/v1/chat/completions",
    method: "POST",
    listedPriceUsdc: 9,
    body: { model: "edited", messages: [] },
    expectedSchema: { type: "object", required: ["choices"] },
    _note: "leave me",
  }];
  const result = await importListings({
    domain: "API.LMXCloud.io",
    existing,
    fetchPage: async () => ({ items: [resource({ accepts: [{
      scheme: "upto",
      network: "eip155:8453",
      asset: USDC,
      amount: "2500",
      payTo: "0x1111111111111111111111111111111111111111",
    }] })], pagination: { total: 1 } }),
  });

  const chat = result.targets[0] as Record<string, unknown>;
  assert.equal(chat.id, "lmx-chat");
  assert.equal(chat._note, "leave me");
  assert.deepEqual(chat.body, { model: "edited", messages: [] });
  assert.deepEqual(chat.expectedSchema, { type: "object", required: ["choices"] });
  assert.equal(chat.listedPriceUsdc, 0.0025);
  assert.equal(chat.x402Version, 2);
  assert.equal(chat.scheme, "upto");
  assert.equal(chat.payTo, "0x1111111111111111111111111111111111111111");
  assert.ok(chat.listingOutputSchema);
});

test("a later match removes the unmatched marker for that host", async () => {
  const existing = [{
    id: "unmatched:api.lmxcloud.io",
    importStatus: "unmatched",
    url: "https://api.lmxcloud.io/",
    method: "GET",
    listedPriceUsdc: 0,
    x402Version: null,
    domain: "api.lmxcloud.io",
  }];
  const result = await importListings({
    domain: "api.lmxcloud.io",
    existing,
    fetchPage: async () => ({ items: [resource()], pagination: { total: 1 } }),
  });
  assert.equal(result.unmatched, false);
  assert.equal(result.targets.some((item) => (item as { importStatus?: string }).importStatus === "unmatched"), false);
  assert.equal((result.targets[0] as { listedPriceUsdc: number }).listedPriceUsdc, 0.001);
});

test("a listing with no Base USDC price is null and price-unknown, never 0", async () => {
  const result = await importListings({
    domain: "rubric-protocol.com",
    existing: [],
    fetchPage: async () => ({
      items: [resource({
        resource: "https://rubric-protocol.com/v1/x402/tiered-attest",
        x402Version: 1,
        accepts: [{
          scheme: "exact",
          network: "base",
          asset: "USDC",
          maxAmountRequired: "5000",
          payTo: "0x2222222222222222222222222222222222222222",
        }],
      })],
      pagination: { total: 1 },
    }),
  });

  assert.equal(result.priceUnknown, 1);
  assert.equal(result.v1Only, 0);
  const row = result.targets[0] as Record<string, unknown>;
  assert.equal(row.listedPriceUsdc, null);
  assert.notEqual(row.listedPriceUsdc, 0);
  assert.equal(row.importStatus, "price-unknown");
  assert.equal(row.x402Version, 1);
  assert.equal(row.network, "base");
  assert.equal(row.payTo, "0x2222222222222222222222222222222222222222");
});

test("a descriptive path or query value is not substituted", () => {
  assert.equal(concreteParamText("EVM wallet address (0x...)"), null);
  assert.equal(concreteParamText({ type: "string", description: "EVM wallet address (0x...)" }), null);
  assert.equal(concreteParamText({ description: "wallet", example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }), "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  const listed = resourceToListing({
    resource: "https://api.aurelianflo.com/api/ofac-wallet-screen/:address",
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "10000", payTo: "0x1111111111111111111111111111111111111111" }],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "GET",
            pathParams: { address: "EVM wallet address (0x...)" },
            queryParams: { note: "describe the wallet" },
          },
          output: { example: { status: "clear" } },
        },
      },
    },
  });
  assert.ok(listed);
  assert.match(listed.url, /:address/);
  assert.equal(listed.query, undefined);
});
