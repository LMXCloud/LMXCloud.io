import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatCapture } from "./jason-40-chat.js";
import {
  ALIAS_PLANNED,
  aliasRequestBody,
  aliasRequestHeaders,
  buildAliasPlan,
  buildAliasRow,
  writeAliasSummary,
  type AliasPlanItem,
} from "./qwen35-alias-check.js";

const COMMIT = "40502726b2b42bd0ee6890efa253bd852c87ebc0";
const QWEN36 = "Qwen/Qwen3.6-35B-A3B";

function capture(item: AliasPlanItem, extra: Partial<ChatCapture> = {}): ChatCapture {
  const provider = item.preference?.split(":")[1] ?? "ionet";
  return {
    httpStatus: 200,
    provider,
    fallback: "false",
    modelRequestedHeader: "qwen-3.5-35b",
    modelResolvedHeader: "qwen-3.6-35b",
    requestId: item.stream ? "gen-1" : "chatcmpl-1",
    requestIdSource: item.stream ? "stream_chunk" : "response_body",
    responseHeaders: { "x-lmx-provider": provider, "x-lmx-model-resolved": "qwen-3.6-35b" },
    returnedModel: QWEN36,
    streamModelIds: item.stream ? [QWEN36] : [],
    finishReason: "stop",
    streamTermination: item.stream ? "done" : "not_applicable",
    contentText: "ok",
    toolCalls: [],
    usage: { prompt_tokens: 19, completion_tokens: 2, total_tokens: 21 },
    error: null,
    responseJson: item.stream ? null : { id: "chatcmpl-1", model: QWEN36 },
    sseFrames: item.stream ? [`data: {"model":"${QWEN36}"}`, "data: [DONE]"] : null,
    clientLatencyMs: 500,
    ...extra,
  };
}

function row(item: AliasPlanItem, extra: Partial<ChatCapture> = {}, index = 0) {
  return buildAliasRow({
    item,
    timestamp: new Date(Date.parse("2026-10-14T19:00:00.000Z") + index * 2500).toISOString(),
    deployedCommit: COMMIT,
    requestParams: aliasRequestBody(item),
    capture: capture(item, extra),
  });
}

test("plan covers both paths under no preference, akash, and ionet", () => {
  const plan = buildAliasPlan();
  assert.equal(plan.length, ALIAS_PLANNED);
  assert.equal(ALIAS_PLANNED, 12);
  assert.equal(plan.filter((i) => i.stream).length, 6);
  assert.deepEqual(aliasRequestHeaders({ preference: "provider:akash", stream: true, run: 1 }), { "x-lmx-prefer": "provider:akash" });
  assert.deepEqual(aliasRequestHeaders({ preference: null, stream: true, run: 1 }), {});
  assert.equal(aliasRequestBody(plan[0]!).model, "qwen-3.5-35b");
});

test("alias resolved to 3.6 with matching model IDs passes on both paths", () => {
  for (const stream of [false, true]) {
    const r = row({ preference: "provider:akash", stream, run: 1 });
    assert.equal(r.pass, true, r.reason);
    assert.equal(r.checks.preference_honored, true);
    assert.equal(r.expected_upstream_model, QWEN36);
  }
});

test("a mislabeled body (the Oct 8 non-streaming bug) fails even with HTTP 200", () => {
  const r = row({ preference: "provider:akash", stream: false, run: 1 }, { returnedModel: "Qwen/Qwen3.5-35B-A3B" });
  assert.equal(r.pass, false);
  assert.match(r.reason, /observed Qwen\/Qwen3\.5-35B-A3B/);
});

test("x-model-executed counts as an observed ID and must match too", () => {
  const r = row({ preference: null, stream: false, run: 1 }, { responseHeaders: { "x-model-executed": "Qwen/Other" } });
  assert.equal(r.executed_model_header, "Qwen/Other");
  assert.equal(r.pass, false);
});

test("missing alias headers, a stream without [DONE], and empty content each fail", () => {
  assert.equal(row({ preference: null, stream: false, run: 1 }, { modelResolvedHeader: null }).pass, false);
  assert.equal(row({ preference: null, stream: true, run: 1 }, { streamTermination: "closed" }).pass, false);
  assert.equal(row({ preference: null, stream: false, run: 1 }, { contentText: " " }).pass, false);
});

test("an unhonored preference is reported but does not fail the request", () => {
  const r = row({ preference: "provider:akash", stream: true, run: 1 }, { provider: "ionet" });
  assert.equal(r.checks.preference_honored, false);
  assert.equal(r.pass, true, r.reason);
});

test("summary uses 'not sent' for absent values and is refused when incomplete", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alias-"));
  const meta = { resultsFile: "qwen35-alias-test.jsonl", endpoint: "https://api.lmxcloud.io", deployedCommitSource: "origin/main after `git fetch`", paceMs: 2500 };
  const rows = buildAliasPlan().map((item, i) => row(item, {}, i));
  const ok = writeAliasSummary(path.join(dir, "s.md"), rows, meta);
  assert.equal(ok.written, true, ok.problems.join("; "));
  const md = fs.readFileSync(path.join(dir, "s.md"), "utf8");
  assert.match(md, /12 of 12 requests passed/);
  assert.match(md, /not sent/);
  assert.doesNotMatch(md, /\[FILL\]|undefined|null \|/);
  assert.match(md, /achieved 24\.0 per minute/);

  const short = writeAliasSummary(path.join(dir, "short.md"), rows.slice(1), meta);
  assert.equal(short.written, false);
  const noReq = rows.map((r, i) => (i === 2 ? { ...r, request_id: null } : r));
  assert.equal(writeAliasSummary(path.join(dir, "noreq.md"), noReq, meta).written, false);
});
