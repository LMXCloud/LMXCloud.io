import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEdge,
  formatCheckList,
  hcsSubmitUsdFromSchedule,
  levelGroups,
  publishedHcsSubmitUsd,
  robotsDecision,
  rotationIndex,
  runCheck,
  slotOf,
  tokenDirectionsDiffer,
  withinTolerance,
  type TargetCheck,
} from "./checks.js";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

test("a value within 20 percent passes and a value outside it fails", () => {
  assert.equal(withinTolerance(1.2, 1, 0.2), true);
  assert.equal(withinTolerance(0.8, 1, 0.2), true);
  assert.equal(withinTolerance(1.21, 1, 0.2), false);
  assert.equal(publishedHcsSubmitUsd(1024), 0.0008 + 1024 * 0.00000068);
});

test("a mirror fee row overrides the published HCS price", () => {
  const usd = hcsSubmitUsdFromSchedule({
    fees: [{ transaction_type: "ConsensusSubmitMessage", usd: 0.0008, bytes_usd: 0.00000068 }],
  }, 1024);
  assert.equal(usd, publishedHcsSubmitUsd(1024));
  assert.equal(hcsSubmitUsdFromSchedule({ fees: [{ transaction_type: "ContractCall", gas: 83 }] }), null);
});

test("hedera anchor-cost stays inside the mirror rate and rejects a far quote", async () => {
  const check: TargetCheck = {
    level: "L0",
    name: "hedera",
    summary: "anchor cost",
    kind: "hedera-anchor-cost",
    tolerance: 0.2,
  };
  const expectedUsd = 0.0008;
  const price = 0.1;
  const fetchImpl = async (url: string | URL | Request) => {
    const href = String(url);
    const payload = href.endsWith("/exchangerate")
      ? { current_rate: { cent_equivalent: 1000, hbar_equivalent: 100 } }
      : { fees: [{ transaction_type: "ConsensusSubmitMessage", usd: expectedUsd }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const expectedHbar = expectedUsd / price;
  const pass = await runCheck({
    check,
    body: { value: { hbar: expectedHbar, usd: expectedUsd } },
    httpStatus: 200,
    nowMs: NOW,
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(pass.every((item) => item.pass), true);
  const fail = await runCheck({
    check,
    body: { value: { hbar: expectedHbar * 2, usd: expectedUsd * 2 } },
    httpStatus: 200,
    nowMs: NOW,
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(fail.some((item) => !item.pass && item.fault === "seller"), true);
});

test("robots allowed and crawl-delay follow the matching agent, and a cache older than 1h fails", async () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private",
    "Crawl-delay: 1",
    "",
    "User-agent: minifetch",
    "Allow: /",
  ].join("\n");
  const decision = robotsDecision(robots, "minifetch/1.0 (+https://minifetch.com/site-owner-faq)", "https://github.com/");
  assert.deepEqual(decision, { allowed: true, crawlDelay: null });
  const blocked = robotsDecision(robots, "OtherBot", "https://github.com/private");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.crawlDelay, 1);

  const check: TargetCheck = { level: "L0", name: "robots", summary: "robots", kind: "robots" };
  const body = {
    results: [{
      data: {
        url: "https://github.com/",
        allowed: true,
        proxy: { userAgent: "minifetch/1.0 (+https://minifetch.com/site-owner-faq)" },
        minifetchCache: { cachedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() },
      },
    }],
  };
  const stale = await runCheck({
    check,
    body,
    httpStatus: 200,
    nowMs: NOW,
    fetchImpl: async () => new Response(robots, { status: 200 }),
  });
  assert.equal(stale.find((item) => item.path === "allowed")?.pass, true);
  assert.equal(stale.find((item) => item.path === "crawlDelay")?.pass, true);
  assert.equal(stale.find((item) => item.path === "cachedAt")?.pass, false);
});

test("a safe token and a scam token must point opposite ways", async () => {
  assert.equal(tokenDirectionsDiffer("ok", "honeypot"), true);
  assert.equal(tokenDirectionsDiffer("ok", "ok"), false);
  assert.equal(tokenDirectionsDiffer("caution", "avoid"), false);
  const check: TargetCheck = { level: "L0", name: "trade", summary: "direction", kind: "verdict-direction" };
  const safe = await runCheck({
    check,
    body: { result: { verdict: "caution", factors: { security: { level: "ok" } } } },
    direction: "safe",
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(safe[0]?.pass, true);
  const risk = await runCheck({
    check,
    body: { result: { verdict: "ok", factors: { security: { level: "honeypot" } } } },
    direction: "risk",
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(risk[0]?.pass, false);
});

test("houjin counts stay in range and robinx rejects a day-old item", async () => {
  const houjin = await runCheck({
    check: { level: "L0", name: "houjin", summary: "ranges", kind: "plausible-ranges" },
    body: { corporation_count: 5_780_145, prefecture_count: 47, prefectures: Array.from({ length: 47 }, () => "県") },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(houjin.every((item) => item.pass), true);
  const broken = await runCheck({
    check: { level: "L0", name: "houjin", summary: "ranges", kind: "plausible-ranges" },
    body: { corporation_count: -1, prefecture_count: 46, prefectures: ["東京都"] },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(broken.some((item) => !item.pass), true);

  const fresh = await runCheck({
    check: { level: "L0", name: "feed", summary: "24h", kind: "fresh-timestamp", path: "data.items.0.launched_at", withinSeconds: 86_400 },
    body: { data: { items: [{ launched_at: new Date(NOW - 60_000).toISOString() }] } },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(fresh[0]?.pass, true);
  const old = await runCheck({
    check: { level: "L0", name: "feed", summary: "24h", kind: "fresh-timestamp", path: "data.items.0.launched_at", withinSeconds: 86_400 },
    body: { data: { items: [{ launched_at: new Date(NOW - 2 * 86_400_000).toISOString() }] } },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(old[0]?.pass, false);
});

test("search requires a resolved URL and the query term", async () => {
  const check: TargetCheck = { level: "L1-strong", name: "search", summary: "urls", kind: "search" };
  const seen: string[] = [];
  const results = await runCheck({
    check,
    body: { results: [{ title: "Bitcoin", url: "https://bitcoin.org/en" }, { title: "Other", url: "https://down.example/" }] },
    requestBody: { query: "bitcoin" },
    httpStatus: 200,
    nowMs: NOW,
    fetchImpl: async (url) => {
      seen.push(String(url));
      if (String(url).includes("down.example")) throw new Error("dns");
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(seen, ["https://bitcoin.org/en", "https://down.example/"]);
  assert.equal(results.find((item) => item.path === "results.url")?.pass, false);
  assert.equal(results.find((item) => item.path === "query")?.pass, true);
});

test("aispace must answer pong and keep usage inside the content", async () => {
  const check: TargetCheck = { level: "L1-strong", name: "pong", summary: "pong", kind: "exact-reply" };
  const pass = await runCheck({
    check,
    body: {
      choices: [{ message: { content: " Pong ", reasoning_content: "x".repeat(20) } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(pass.every((item) => item.pass), true);
  const wrong = await runCheck({
    check,
    body: {
      choices: [{ message: { content: "pong please" } }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    },
    httpStatus: 200,
    nowMs: NOW,
  });
  assert.equal(wrong.find((item) => item.path === "choices.0.message.content")?.pass, false);
});

test("an unregistered name is not-found and a fabricated address fails", async () => {
  const check: TargetCheck = { level: "L1-strong", name: "ens", summary: "ens", kind: "ens" };
  const missing = await runCheck({
    check,
    body: { resolved: false, address: null },
    httpStatus: 200,
    expect: "not-found",
    nowMs: NOW,
  });
  assert.equal(missing[0]?.pass, true);
  const fake = await runCheck({
    check,
    body: { resolved: false, address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    httpStatus: 200,
    expect: "not-found",
    nowMs: NOW,
  });
  assert.equal(fake[0]?.pass, false);
  assert.equal(applyEdge({
    expect: "not-found",
    outcome: "charged_for_client_error",
    httpStatus: 404,
    emptyPayload: true,
    nonempty: true,
    notFoundPass: true,
  }), "pass");
  assert.equal(applyEdge({
    expect: "not-found",
    outcome: "pass",
    httpStatus: 500,
    emptyPayload: false,
    nonempty: true,
    notFoundPass: false,
  }), "server_error_after_payment");
});

test("an eth_call must match our RPC, and an RPC failure is ours", async () => {
  const check: TargetCheck = { level: "L1-strong", name: "eth", summary: "eth", kind: "eth-call" };
  const request = { jsonrpc: "2.0", id: 1, method: "eth_call", params: [] };
  const match = await runCheck({
    check,
    body: { result: "0x10" },
    requestBody: request,
    httpStatus: 200,
    nowMs: NOW,
    rpcUrl: "https://rpc.example/base",
    fetchImpl: async () => new Response(JSON.stringify({ result: "0x00010" }), { status: 200 }),
  });
  assert.equal(match[0]?.pass, true);
  assert.equal(match[0]?.fault, "seller");
  const down = await runCheck({
    check,
    body: { result: "0x10" },
    requestBody: request,
    httpStatus: 200,
    nowMs: NOW,
    rpcUrl: "https://rpc.example/base",
    fetchImpl: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(down[0]?.fault, "input");
});

test("four schedule slots on one day pick four different cases", () => {
  const times = ["2026-10-03T00:30:00Z", "2026-10-03T06:00:00Z", "2026-10-03T12:00:00Z", "2026-10-03T18:00:00Z"];
  const indexes = times.map((time, slot) => {
    const now = new Date(time);
    assert.equal(slotOf(now, 4), slot);
    return rotationIndex(4, now, 4);
  });
  assert.equal(new Set(indexes).size, 4);
});

test("empty input must be an empty 2xx, and a long input may not 500", () => {
  assert.equal(applyEdge({
    edge: "empty",
    outcome: "empty_result",
    httpStatus: 200,
    emptyPayload: true,
    nonempty: true,
    notFoundPass: false,
  }), "pass");
  assert.equal(applyEdge({
    edge: "empty",
    outcome: "pass",
    httpStatus: 200,
    emptyPayload: false,
    nonempty: true,
    notFoundPass: false,
  }), "assertion_failed");
  assert.equal(applyEdge({
    edge: "unicode",
    outcome: "shape_mismatch",
    httpStatus: 200,
    emptyPayload: false,
    nonempty: true,
    notFoundPass: false,
  }), "pass");
  assert.equal(applyEdge({
    edge: "long",
    outcome: "pass",
    httpStatus: 500,
    emptyPayload: false,
    nonempty: true,
    notFoundPass: false,
  }), "server_error_after_payment");
});

test("the check list groups paid sellers by level", () => {
  const text = formatCheckList([
    { id: "rubric", url: "https://rubric.example/x", paid: true, check: { level: "L0", name: "cost", summary: "mirror fee", kind: "hedera-anchor-cost" } },
    { id: "search", url: "https://search.example/x", paid: true, check: { level: "L1-strong", name: "search", summary: "urls", kind: "search" }, rotateDaily: [{}, {}, {}, {}] },
    { id: "open", url: "https://open.example/x", paid: false },
  ], new Date("2026-10-03T00:30:00.000Z"), 4);
  assert.match(text, /L0 {2}1/);
  assert.match(text, /L1-weak {2}0/);
  assert.match(text, /L1-strong {2}1/);
  assert.match(text, /rubric {2}cost {2}mirror fee/);
  assert.match(text, /case 1\/4/);
  const groups = levelGroups([
    { role: "probe", checkLevel: "L0", id: "rubric", checkName: "cost", outcome: "pass", fault: null },
    { role: "prepay", checkLevel: "L0", id: "rubric", checkName: "cost", outcome: null, fault: null },
    { role: "probe", checkLevel: "L1-strong", id: "search", checkName: "search", outcome: "pass", fault: null },
  ]);
  assert.equal(groups[0]?.rows.length, 1);
  assert.equal(groups[1]?.rows.length, 0);
  assert.equal(groups[2]?.rows.length, 1);
});
