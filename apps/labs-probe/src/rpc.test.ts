import assert from "node:assert/strict";
import test from "node:test";

import { baseRpcUrls, retryRead } from "./rpc.js";

test("RPC urls start with the configured endpoint, then the public Base list", () => {
  assert.deepEqual(baseRpcUrls(undefined), [
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
    "https://mainnet.base.org",
  ]);
  assert.deepEqual(baseRpcUrls(" https://example.invalid/base "), [
    "https://example.invalid/base",
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
    "https://mainnet.base.org",
  ]);
  assert.deepEqual(baseRpcUrls("https://mainnet.base.org"), [
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
  ]);
});

test("a chain read retries twice with backoff and then throws", async () => {
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(
    () => retryRead(async () => {
      calls += 1;
      throw new Error("over rate limit");
    }, async (ms) => {
      waits.push(ms);
    }),
    /over rate limit/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test("a chain read stops when an attempt succeeds", async () => {
  let calls = 0;
  const value = await retryRead(async () => {
    calls += 1;
    if (calls < 2) throw new Error("over rate limit");
    return 7n;
  }, async () => {});
  assert.equal(value, 7n);
  assert.equal(calls, 2);
});
