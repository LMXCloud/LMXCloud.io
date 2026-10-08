import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectedProviderModelId } from "../src/providers/model-maps.js";
import { readSse } from "./forwarding-chat.js";
import { describeToolCalls, judgeQwenFollowup, type ToolEvidence } from "./qwen-followup-judge.js";
import { createSseModelState, observeSseModel } from "./sse-models.js";

const AKASH_QWEN35 = expectedProviderModelId("akash", "qwen-3.5-35b");
const IONET_QWEN36 = expectedProviderModelId("ionet", "qwen-3.6-35b");
const AETHIR_QWEN36 = expectedProviderModelId("aethir", "qwen-3.6-35b");

const weatherOk: ToolEvidence = describeToolCalls([
  { function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
]);
const noTool: ToolEvidence = describeToolCalls([]);

describe("observeSseModel", () => {
  it("keeps every distinct model in first-seen order and the last string as lastModel", () => {
    const state = createSseModelState();
    observeSseModel(state, "Qwen/Qwen3.5-35B-A3B");
    observeSseModel(state, "Qwen/Qwen3.5-35B-A3B");
    observeSseModel(state, 12);
    observeSseModel(state, null);
    observeSseModel(state, "Qwen/Qwen3.6-35B-A3B");
    observeSseModel(state, "Qwen/Qwen3.5-35B-A3B");

    assert.deepEqual(state.models, ["Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3.6-35B-A3B"]);
    assert.equal(state.lastModel, "Qwen/Qwen3.5-35B-A3B");
  });

  it("leaves the state empty when no chunk has a string model", () => {
    const state = createSseModelState();
    observeSseModel(state, undefined);
    observeSseModel(state, { model: "hidden" });
    assert.deepEqual(state.models, []);
    assert.equal(state.lastModel, null);
  });
});

describe("readSse", () => {
  it("keeps every distinct chunk model and the last one as returnedModel", async () => {
    const frames = [
      `data: ${JSON.stringify({ model: "Qwen/Qwen3.5-35B-A3B", choices: [{ delta: { content: "o" } }] })}\n\n`,
      `data: ${JSON.stringify({ model: "Qwen/Qwen3.5-35B-A3B", choices: [{ delta: { content: "k" } }] })}\n\n`,
      `data: ${JSON.stringify({ model: "other-model", choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const parsed = await readSse(new Response(frames.join(""), { status: 200 }), performance.now());
    assert.deepEqual(parsed.modelsSeen, ["Qwen/Qwen3.5-35B-A3B", "other-model"]);
    assert.equal(parsed.returnedModel, "other-model");
    assert.equal(parsed.finishReason, "stop");
    assert.equal(parsed.contentText, "ok");
    assert.equal(parsed.sseFrames?.length, 4);
  });
});

describe("judgeQwenFollowup", () => {
  it("counts an Akash path only when the provider is akash and fallback is false", () => {
    assert.ok(AKASH_QWEN35);
    const pass = judgeQwenFollowup({
      block: "A",
      preferredProvider: "akash",
      requestedModel: "qwen-3.5-35b",
      httpStatus: 200,
      provider: "akash",
      fallback: "false",
      finishReason: "stop",
      models: [AKASH_QWEN35],
      errorMessage: null,
      tool: noTool,
    });
    assert.equal(pass.verdict, "pass");
    assert.equal(pass.akash_path, true);

    const fellBack = judgeQwenFollowup({
      block: "A",
      preferredProvider: "akash",
      requestedModel: "qwen-3.5-35b",
      httpStatus: 200,
      provider: "akash",
      fallback: "true",
      finishReason: "stop",
      models: [AKASH_QWEN35],
      errorMessage: null,
      tool: noTool,
    });
    assert.equal(fellBack.verdict, "fallback");
    assert.equal(fellBack.akash_path, false);
  });

  it("flags a mismatch when any streamed model differs from the serving provider id", () => {
    assert.ok(AKASH_QWEN35);
    const judged = judgeQwenFollowup({
      block: "A",
      preferredProvider: "akash",
      requestedModel: "qwen-3.5-35b",
      httpStatus: 200,
      provider: "akash",
      fallback: "false",
      finishReason: "stop",
      models: [AKASH_QWEN35, "Qwen/Qwen3.6-35B-A3B"],
      errorMessage: null,
      tool: noTool,
    });
    assert.equal(judged.verdict, "mismatch");
    assert.equal(judged.mismatch, true);
    assert.equal(judged.akash_path, true);
    assert.equal(judged.expected_model, AKASH_QWEN35);
  });

  it("compares models to the serving provider, not the preferred one", () => {
    assert.ok(IONET_QWEN36);
    const judged = judgeQwenFollowup({
      block: "A",
      preferredProvider: "akash",
      requestedModel: "qwen-3.6-35b",
      httpStatus: 200,
      provider: "ionet",
      fallback: "true",
      finishReason: "stop",
      models: [IONET_QWEN36],
      errorMessage: null,
      tool: noTool,
    });
    assert.equal(judged.verdict, "fallback");
    assert.equal(judged.mismatch, false);
    assert.equal(judged.akash_path, false);
    assert.equal(judged.expected_model, IONET_QWEN36);
  });

  it("treats a 200 with no model value as a mismatch", () => {
    const judged = judgeQwenFollowup({
      block: "D",
      preferredProvider: "akash",
      requestedModel: "qwen-3.5-35b",
      httpStatus: 200,
      provider: "akash",
      fallback: "false",
      finishReason: "stop",
      models: [],
      errorMessage: null,
      tool: noTool,
    });
    assert.equal(judged.verdict, "mismatch");
    assert.equal(judged.akash_path, true);
  });

  it("passes a tool block only for get_weather with a city in the JSON arguments", () => {
    assert.ok(IONET_QWEN36);
    const pass = judgeQwenFollowup({
      block: "C",
      preferredProvider: "ionet",
      requestedModel: "qwen-3.6-35b",
      httpStatus: 200,
      provider: "ionet",
      fallback: "false",
      finishReason: "tool_calls",
      models: [IONET_QWEN36],
      errorMessage: null,
      tool: weatherOk,
    });
    assert.equal(pass.verdict, "pass");
    assert.equal(pass.tool_pass, true);
    assert.equal(pass.akash_path, false);

    const noCity = judgeQwenFollowup({
      block: "B",
      preferredProvider: "akash",
      requestedModel: "qwen-3.5-35b",
      httpStatus: 200,
      provider: "akash",
      fallback: "false",
      finishReason: "tool_calls",
      models: [AKASH_QWEN35!],
      errorMessage: null,
      tool: describeToolCalls([{ function: { name: "get_weather", arguments: '{"temp":61}' } }]),
    });
    assert.equal(noCity.verdict, "tool_fail");
    assert.equal(noCity.tool_pass, false);
    assert.equal(noCity.akash_path, true);
  });

  it("names aethir in the verdict and still reports the row as off the Akash path", () => {
    assert.ok(AETHIR_QWEN36);
    const judged = judgeQwenFollowup({
      block: "C",
      preferredProvider: "ionet",
      requestedModel: "qwen-3.6-35b",
      httpStatus: 200,
      provider: "aethir",
      fallback: "true",
      finishReason: "stop",
      models: [AETHIR_QWEN36],
      errorMessage: null,
      tool: weatherOk,
    });
    assert.equal(judged.verdict, "aethir+fallback+tool_fail");
    assert.equal(judged.akash_path, false);
    assert.equal(judged.mismatch, false);
  });
});
