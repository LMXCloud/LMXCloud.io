import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { expectedProviderModelId } from "../src/providers/model-maps.js";
import { parseSseText, readSse, recordedHeaders, sanitizeValue, type ChatCapture } from "./jason-40-chat.js";
import { createSseModelState, observeSseModel } from "./sse-models.js";
import {
  MODES,
  MODELS,
  PLANNED_REQUESTS,
  buildPlan,
  PACE_MS,
  buildRow,
  etRange,
  executedModelLine,
  judgeCapture,
  pacingDelay,
  pacingStats,
  requestBody,
  usageField,
  writeSummaryFile,
  type Mode,
  type PlanItem,
  type RetestRow,
} from "./jason-40-retest.js";

const COMMIT = "a892addb4a4d362b2b2d2971e8b829164636a59a";

test("plan is 5 repetitions of each model and mode", () => {
  const plan = buildPlan();
  assert.equal(plan.length, PLANNED_REQUESTS);
  assert.equal(PLANNED_REQUESTS, 40);
  for (const model of MODELS) {
    for (const mode of MODES) {
      assert.equal(plan.filter((item) => item.model === model && item.mode === mode).length, 5);
    }
  }
});

test("request params stay at the controlled defaults", () => {
  for (const item of buildPlan()) {
    const body = requestBody(item);
    assert.equal(body.model, item.model);
    assert.equal(body.max_tokens, 400);
    assert.equal(body.stream, item.mode === "streaming");
    assert.equal("reasoning_effort" in body, false);
    assert.equal("enable_thinking" in body, false);
    assert.equal("chat_template_kwargs" in body, false);
    if (item.mode === "json_object") {
      assert.deepEqual(body.response_format, { type: "json_object" });
    } else {
      assert.equal("response_format" in body, false);
    }
    if (item.mode === "tool_call") {
      assert.equal(body.tool_choice, "auto");
      const tools = body.tools as Array<{ function: { name: string } }>;
      assert.equal(tools[0]?.function.name, "get_weather");
    } else {
      assert.equal("tools" in body, false);
    }
  }
});

test("plain, json, tool, and stream validity are explicit", () => {
  assert.equal(judged("plain", { contentText: "ok" }).pass, true);
  const emptyPlain = judged("plain", { contentText: "  " });
  assert.equal(emptyPlain.mode_valid, false);
  assert.equal(emptyPlain.empty, true);
  assert.equal(emptyPlain.pass, false);

  assert.equal(judged("json_object", { contentText: '{"greeting":"hi"}' }).pass, true);
  assert.equal(judged("json_object", { contentText: "[1]" }).mode_valid, false);
  assert.equal(judged("json_object", { contentText: "```json\n{\"a\":1}\n```" }).mode_valid, false);

  const tool = judged("tool_call", {
    finishReason: "tool_calls",
    contentText: "",
    toolCalls: [{ function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
  });
  assert.equal(tool.pass, true);
  assert.equal(tool.empty, false);
  assert.equal(
    judged("tool_call", {
      finishReason: "tool_calls",
      contentText: "",
      toolCalls: [{ function: { name: "get_weather", arguments: '{"city":1}' } }],
    }).mode_valid,
    false,
  );

  const streamed = judged("streaming", { contentText: "ok", streamTermination: "done" });
  assert.equal(streamed.pass, true);
  const emptyStream = judged("streaming", { contentText: "", streamTermination: "done" });
  assert.equal(emptyStream.mode_valid, true);
  assert.equal(emptyStream.empty, true);
  assert.equal(emptyStream.pass, false);
  const cut = judged("streaming", { contentText: "ok", streamTermination: "closed" });
  assert.equal(cut.mode_valid, false);
  assert.equal(cut.truncated, true);
  assert.equal(cut.pass, false);

  const truncated = judged("plain", { contentText: "ok", finishReason: "length" });
  assert.equal(truncated.mode_valid, true);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.pass, false);
});

test("missing usage is unavailable, and a reported usage object is kept raw", () => {
  assert.equal(usageField(null), "unavailable");
  assert.equal(usageField(undefined), "unavailable");
  const raw = { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4, extra: true };
  assert.deepEqual(usageField(raw), raw);
});

test("sse frames keep distinct model ids and [DONE]", async () => {
  const state = createSseModelState();
  observeSseModel(state, "one");
  observeSseModel(state, "one");
  observeSseModel(state, "two");
  assert.deepEqual(state.models, ["one", "two"]);

  const done = await readSse(sseResponse(streamText(true)), 0);
  assert.equal(done.streamTermination, "done");
  assert.deepEqual(done.streamModelIds, ["Qwen/A", "Qwen/B"]);
  assert.equal(done.returnedModel, "Qwen/B");
  assert.equal(done.requestId, "chatcmpl-1");
  assert.equal(done.contentText, "ok");
  assert.deepEqual(done.usage, { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });

  const closed = await readSse(sseResponse(streamText(false)), 0);
  assert.equal(closed.streamTermination, "closed");

  const trailer = parseSseText(`${streamText(true)}\nevent: lmx.meta\ndata: {"provider":"ionet"}\n\n`);
  assert.equal(trailer.streamTermination, "done");
  assert.equal(trailer.contentText, "ok");

  const reopened = parseSseText(
    `${streamText(true)}\ndata: ${JSON.stringify({ model: "extra", choices: [{ delta: { content: "x" } }] })}\n\n`,
  );
  assert.equal(reopened.streamTermination, "closed");
});

test("summary is refused when a required field is missing and written when the 40 rows are complete", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jason-40-"));
  const summaryPath = path.join(dir, "summary.md");
  const meta = {
    resultsFile: "jason-40-retest-test.jsonl",
    endpoint: "https://api.lmxcloud.io",
    paceMs: 2500,
    deployedCommitSource: "origin/main after `git fetch` at run start; not reported by production",
  };
  const rows = forty();
  delete (rows[3] as { usage?: unknown }).usage;
  const refused = writeSummaryFile(summaryPath, rows, meta);
  assert.equal(refused.written, false);
  assert.equal(fs.existsSync(summaryPath), false);
  assert.match(refused.problems.join("\n"), /row 4 missing usage/);

  const complete = forty();
  const written = writeSummaryFile(summaryPath, complete, meta);
  assert.equal(written.written, true);
  const markdown = fs.readFileSync(summaryPath, "utf8");
  assert.match(markdown, /\| llama-3\.3-70b \| 5\/5 \| 5\/5 \| 5\/5 \| 5\/5 \|/);
  assert.match(markdown, /\| qwen-3\.6-35b \| 5\/5 \| 5\/5 \| 5\/5 \| 4\/5 \|/);
  assert.match(markdown, /No provider preference was sent/);
  assert.match(markdown, new RegExp(COMMIT));
  assert.match(markdown, /not reported by production/);
  assert.doesNotMatch(markdown, /\(`origin\/main`\)/);
  // Fixture starts are 1 s apart: the summary must report 60/min achieved, not the 24/min target.
  assert.match(markdown, /Pacing target: a request start every 2\.5 seconds \(24\.0 per minute\)/);
  assert.match(markdown, /Pacing achieved, measured from recorded start times: 60\.0 per minute/);
  assert.match(markdown, /chatcmpl-row \(response_body\)/);
  assert.match(markdown, /`x-model-executed` on 0 of 40/);

  const noSource = writeSummaryFile(path.join(dir, "nosource.md"), complete, { ...meta, deployedCommitSource: " " });
  assert.equal(noSource.written, false);
  assert.match(noSource.problems.join("\n"), /summary metadata is incomplete/);

  const badSource = forty();
  badSource[0] = { ...badSource[0]!, request_id_source: null };
  const sourceBlocked = writeSummaryFile(path.join(dir, "badsource.md"), badSource, meta);
  assert.equal(sourceBlocked.written, false);
  assert.match(sourceBlocked.problems.join("\n"), /row 1 request_id_source does not match request_id/);

  const inconsistent = forty();
  inconsistent[0] = { ...inconsistent[0]!, pass: true, empty: true };
  const blocked = writeSummaryFile(path.join(dir, "nope.md"), inconsistent, meta);
  assert.equal(blocked.written, false);
  assert.match(blocked.problems.join("\n"), /pass does not match/);
});

test("pacing schedules request starts, so slow responses do not lower the rate", () => {
  const t0 = 1_000_000;
  assert.equal(PACE_MS, 2500);
  assert.equal(pacingDelay(t0, 0, t0), 0);
  // Request 1 is due at t0 + 2500. A response that finished at t0 + 900 waits 1600, not 2500.
  assert.equal(pacingDelay(t0, 1, t0 + 900), 1600);
  // Already late: start immediately, never a negative wait.
  assert.equal(pacingDelay(t0, 2, t0 + 6000), 0);
});

test("pacing stats report the Oct 13 run at about 17/min, not the 24/min target", () => {
  // Oct 13 run: 40 starts from 17:36:33.195Z to 17:38:48.023Z (2.5 s sleep after each response).
  const first = Date.parse("2026-10-13T17:36:33.195Z");
  const last = Date.parse("2026-10-13T17:38:48.023Z");
  const rows = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(first + Math.round(((last - first) * i) / 39)).toISOString(),
  }));
  const stats = pacingStats(rows);
  assert.equal(stats.requests, 40);
  assert.ok(Math.abs(stats.achievedPerMinute - 17.36) < 0.05, `got ${stats.achievedPerMinute}`);
  assert.equal(stats.overruns, 39);

  const onSchedule = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(first + i * 2500 + (i % 3) * 40).toISOString(),
  }));
  const good = pacingStats(onSchedule);
  assert.ok(Math.abs(good.achievedPerMinute - 24) < 0.1, `got ${good.achievedPerMinute}`);
  assert.equal(good.overruns, 0);
});

test("recorded headers keep x-lmx-* and provider identity headers only", () => {
  const headers = new Headers({
    "X-LMX-Provider": "akash",
    "x-lmx-model-requested": "qwen-3.5-35b",
    "x-lmx-model-resolved": "qwen-3.6-35b",
    "X-Model-Executed": "Qwen/Qwen3.6-35B-A3B",
    "X-Aliased": "true",
    "set-cookie": "session=nope",
    "content-type": "application/json",
  });
  assert.deepEqual(recordedHeaders(headers), {
    "x-aliased": "true",
    "x-lmx-model-requested": "qwen-3.5-35b",
    "x-lmx-model-resolved": "qwen-3.6-35b",
    "x-lmx-provider": "akash",
    "x-model-executed": "Qwen/Qwen3.6-35B-A3B",
  });
});

test("eastern time range matches the October follow-up clock", () => {
  assert.equal(
    etRange("2026-10-08T18:22:55.802Z", "2026-10-08T18:24:01.776Z"),
    "8 October 2026, 2:22:55 PM–2:24:01 PM ET",
  );
});

test("sanitize removes the key and auth fields", () => {
  const cleaned = sanitizeValue(
    {
      authorization: "Bearer secret-key",
      request_params: { model: "llama-3.3-70b" },
      error: "bad secret-key",
    },
    "secret-key",
  ) as { authorization?: string; error: string; request_params: { model: string } };
  assert.equal("authorization" in (cleaned as object), false);
  assert.equal(cleaned.error, "bad [redacted]");
  assert.equal(cleaned.request_params.model, "llama-3.3-70b");
});

function forty(): RetestRow[] {
  const rows: RetestRow[] = [];
  let index = 0;
  for (const model of MODELS) {
    for (const mode of MODES) {
      for (let run = 1; run <= 5; run += 1) {
        const failThis = model === "qwen-3.6-35b" && mode === "streaming" && run === 5;
        rows.push(sampleRow({ model, mode, run }, index, failThis));
        index += 1;
      }
    }
  }
  return rows;
}

function sampleRow(item: PlanItem, index: number, fail: boolean): RetestRow {
  const provider = "ionet";
  const expected = expectedProviderModelId(provider, item.model)!;
  const capture = passingCapture(item.mode, expected);
  if (fail) {
    capture.httpStatus = 503;
    capture.error = "upstream unavailable";
    capture.requestId = null;
    capture.requestIdSource = null;
    capture.responseJson = { error: { message: "upstream unavailable" } };
    capture.sseFrames = null;
    capture.streamTermination = item.mode === "streaming" ? "not_started" : "not_applicable";
  }
  return buildRow({
    item,
    timestamp: new Date(Date.parse("2026-10-13T17:20:00.000Z") + index * 1000).toISOString(),
    deployedCommit: COMMIT,
    providerPreference: null,
    requestParams: requestBody(item),
    capture,
  });
}

function passingCapture(mode: Mode, returnedModel: string): ChatCapture {
  const base = captureJudge({
    returnedModel,
    contentText: mode === "json_object" ? '{"greeting":"hi"}' : mode === "tool_call" ? "" : "ok",
    finishReason: mode === "tool_call" ? "tool_calls" : "stop",
    streamTermination: mode === "streaming" ? "done" : "not_applicable",
    toolCalls:
      mode === "tool_call"
        ? [{ function: { name: "get_weather", arguments: '{"city":"Paris"}' } }]
        : [],
    responseJson:
      mode === "streaming"
        ? null
        : { id: "chatcmpl-row", model: returnedModel, choices: [{ finish_reason: "stop" }] },
    sseFrames: mode === "streaming" ? ['data: {"model":"x"}', "data: [DONE]"] : null,
    streamModelIds: mode === "streaming" ? [returnedModel] : ["ignored-on-non-stream"],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  });
  return {
    httpStatus: 200,
    provider: "ionet",
    fallback: "false",
    modelRequestedHeader: "requested",
    modelResolvedHeader: "resolved",
    requestId: "chatcmpl-row",
    requestIdSource: "response_body",
    responseHeaders: { "x-lmx-provider": "ionet", "x-lmx-fallback": "false" },
    returnedModel,
    streamModelIds: mode === "streaming" ? [returnedModel] : [],
    finishReason: base.finishReason,
    streamTermination: base.streamTermination,
    contentText: base.contentText,
    toolCalls: [...base.toolCalls],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    error: null,
    responseJson: base.responseJson,
    sseFrames: base.sseFrames,
    clientLatencyMs: 10,
  };
}

function captureJudge(extra: Partial<ChatCapture> = {}): ChatCapture {
  return {
    httpStatus: 200,
    provider: "ionet",
    fallback: "false",
    modelRequestedHeader: null,
    modelResolvedHeader: null,
    requestId: "chatcmpl-1",
    requestIdSource: "response_body",
    responseHeaders: {},
    returnedModel: extra.returnedModel ?? "meta-llama/Llama-3.3-70B-Instruct",
    streamModelIds: [],
    finishReason: "stop",
    streamTermination: "not_applicable",
    contentText: "ok",
    toolCalls: [],
    usage: null,
    error: null,
    responseJson: { id: "chatcmpl-1" },
    sseFrames: null,
    clientLatencyMs: 1,
    ...extra,
  };
}

function streamText(done: boolean): string {
  const first = {
    id: "chatcmpl-1",
    model: "Qwen/A",
    choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
  };
  const second = {
    id: "chatcmpl-1",
    model: "Qwen/B",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  };
  const frames = [`data: ${JSON.stringify(first)}`, "", `data: ${JSON.stringify(second)}`, ""];
  if (done) frames.push("data: [DONE]", "");
  return frames.join("\n");
}

function judged(mode: Mode, extra: Partial<ChatCapture> = {}) {
  const capture = captureJudge(extra);
  return judgeCapture({
    mode,
    httpStatus: capture.httpStatus,
    error: capture.error,
    finishReason: capture.finishReason,
    contentText: capture.contentText,
    toolCalls: capture.toolCalls,
    streamTermination: capture.streamTermination,
  });
}

function sseResponse(text: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

test("summary counts the router's executed-model headers, or says none were sent", () => {
  const rowWith = (headers: Record<string, string>) => ({ response_headers: headers }) as unknown as RetestRow;
  assert.equal(
    executedModelLine([rowWith({}), rowWith({ "x-lmx-provider": "ionet" })]),
    "The deployed router did not send `x-lmx-model-executed` headers on any request.",
  );
  const line = executedModelLine([
    rowWith({
      "x-lmx-model-executed": "Qwen/Qwen3.6-35B-A3B",
      "x-lmx-model-executed-source": "provider-header",
      "x-lmx-substitution": "false",
    }),
    rowWith({
      "x-lmx-model-executed": "meta-llama/Llama-3.3-70B-Instruct",
      "x-lmx-model-executed-source": "response-body",
      "x-lmx-substitution": "false",
    }),
    rowWith({ "x-lmx-model-executed-source": "unknown", "x-lmx-substitution": "unknown" }),
  ]);
  assert.match(line, /present on 2 of 3 requests/);
  assert.match(line, /provider header on 1, response body on 1, unknown on 1/);
  assert.match(line, /true on 0, false on 2, unknown on 1/);
});
