import fs from "node:fs";
import { expectedProviderModelId } from "../src/providers/model-maps.js";
import {
  JSON_USER,
  PLAIN_USER,
  WEATHER_TOOL,
  WEATHER_USER,
  isRecord,
  type ChatCapture,
  type RequestIdSource,
  type ToolCall,
} from "./jason-40-chat.js";

export const MODELS = ["llama-3.3-70b", "qwen-3.6-35b"] as const;
export const MODES = ["plain", "json_object", "tool_call", "streaming"] as const;
export const RUNS_PER_CELL = 5;
export const PLANNED_REQUESTS = MODELS.length * MODES.length * RUNS_PER_CELL;
export const MAX_TOKENS = 400;
/** Interval between request *starts* (24/min). The runner schedules starts, not gaps after responses. */
export const PACE_MS = 60_000 / 24;
/** A start later than its slot by more than this counts as an overrun in the summary. */
export const SLOT_TOLERANCE_MS = 250;

/** How long to wait before starting request `index` so starts land every PACE_MS from `runStartMs`. */
export function pacingDelay(runStartMs: number, index: number, nowMs: number, paceMs = PACE_MS): number {
  return Math.max(0, runStartMs + index * paceMs - nowMs);
}

export type PacingStats = {
  requests: number;
  spanMs: number;
  achievedPerMinute: number;
  meanStartGapMs: number;
  maxStartGapMs: number;
  overruns: number;
};

/** Pacing measured from recorded start timestamps, so the summary reports what happened, not the target. */
export function pacingStats(rows: readonly { timestamp: string }[], paceMs = PACE_MS): PacingStats {
  const starts = rows.map((row) => Date.parse(row.timestamp));
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const spanMs = starts.length > 1 ? starts[starts.length - 1]! - starts[0]! : 0;
  return {
    requests: starts.length,
    spanMs,
    achievedPerMinute: spanMs > 0 ? ((starts.length - 1) * 60_000) / spanMs : 0,
    meanStartGapMs: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    maxStartGapMs: gaps.length ? Math.max(...gaps) : 0,
    overruns: gaps.filter((gap) => gap > paceMs + SLOT_TOLERANCE_MS).length,
  };
}

export type ModelName = (typeof MODELS)[number];
export type Mode = (typeof MODES)[number];

export type PlanItem = {
  model: ModelName;
  mode: Mode;
  run: number;
};

export type Substitution = {
  detected: boolean;
  expected: string | null;
  returned: string | null;
  stream_model_ids: string[];
  differing: string[];
};

export type RetestRow = {
  request_id: string | null;
  request_id_source: RequestIdSource | null;
  timestamp: string;
  deployed_commit: string;
  request_params: Record<string, unknown>;
  requested_model: ModelName;
  expected_upstream_model: string | null;
  returned_model: string | null;
  stream_model_ids: string[];
  "x-lmx-provider": string | null;
  "x-lmx-fallback": string | null;
  "x-lmx-model-requested": string | null;
  "x-lmx-model-resolved": string | null;
  response_headers: Record<string, string>;
  substitution: Substitution;
  provider_preference: string | null;
  http_status: number | null;
  error: string | null;
  finish_reason: string | null;
  stream_termination: ChatCapture["streamTermination"];
  response_json: unknown | null;
  sse_frames: string[] | null;
  usage: Record<string, unknown> | "unavailable";
  client_latency_ms: number;
  mode: Mode;
  run: number;
  mode_valid: boolean;
  empty: boolean;
  truncated: boolean;
  pass: boolean;
  reason: string;
};

export const REQUIRED_FIELDS = [
  "request_id",
  "request_id_source",
  "timestamp",
  "deployed_commit",
  "request_params",
  "requested_model",
  "expected_upstream_model",
  "returned_model",
  "stream_model_ids",
  "x-lmx-provider",
  "x-lmx-fallback",
  "x-lmx-model-requested",
  "x-lmx-model-resolved",
  "response_headers",
  "substitution",
  "provider_preference",
  "http_status",
  "error",
  "finish_reason",
  "stream_termination",
  "response_json",
  "sse_frames",
  "usage",
  "client_latency_ms",
  "mode",
  "run",
  "mode_valid",
  "empty",
  "truncated",
  "pass",
  "reason",
] as const;

const STREAM_TERMINATIONS = new Set(["done", "closed", "not_started", "error", "not_applicable"]);
const REQUEST_ID_SOURCES = new Set(["header", "response_body", "stream_chunk"]);

export type SummaryMeta = {
  resultsFile: string;
  endpoint: string;
  paceMs: number;
  /** Plain statement of where `deployed_commit` came from, e.g. what git ref, and whether production reported it. */
  deployedCommitSource: string;
};

export function buildPlan(): PlanItem[] {
  const plan: PlanItem[] = [];
  for (const model of MODELS) {
    for (const mode of MODES) {
      for (let run = 1; run <= RUNS_PER_CELL; run += 1) {
        plan.push({ model, mode, run });
      }
    }
  }
  return plan;
}

export function requestBody(item: PlanItem): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: item.model,
    messages: [item.mode === "tool_call" ? WEATHER_USER : item.mode === "json_object" ? JSON_USER : PLAIN_USER],
    max_tokens: MAX_TOKENS,
    stream: item.mode === "streaming",
  };
  if (item.mode === "json_object") body.response_format = { type: "json_object" };
  if (item.mode === "tool_call") {
    body.tools = [WEATHER_TOOL];
    body.tool_choice = "auto";
  }
  return body;
}

export function expectedUpstream(provider: string | null, model: string): string | null {
  if (!provider) return null;
  return expectedProviderModelId(provider, model) ?? expectedProviderModelId(provider.toLowerCase(), model) ?? null;
}

export function usageField(usage: unknown): Record<string, unknown> | "unavailable" {
  if (isRecord(usage)) return usage;
  return "unavailable";
}

export function substitutionFor(
  expected: string | null,
  returned: string | null,
  streamModelIds: readonly string[],
): Substitution {
  const observed: string[] = [];
  if (returned) observed.push(returned);
  for (const id of streamModelIds) {
    if (!observed.includes(id)) observed.push(id);
  }
  const differing = expected ? observed.filter((id) => id !== expected) : [];
  return {
    detected: differing.length > 0,
    expected,
    returned,
    stream_model_ids: [...streamModelIds],
    differing,
  };
}

export function judgeCapture(input: {
  mode: Mode;
  httpStatus: number | null;
  error: string | null;
  finishReason: string | null;
  contentText: string;
  toolCalls: readonly ToolCall[];
  streamTermination: ChatCapture["streamTermination"];
}): { mode_valid: boolean; empty: boolean; truncated: boolean; pass: boolean; reason: string } {
  const contentEmpty = input.contentText.trim().length === 0;
  let modeValid = false;
  let modeReason = "";

  if (input.mode === "plain") {
    modeValid = !contentEmpty;
    modeReason = modeValid ? "non-empty content" : "content was empty";
  } else if (input.mode === "json_object") {
    modeValid = isJsonObject(input.contentText);
    modeReason = modeValid ? "content parsed as a JSON object" : "content was not a JSON object";
  } else if (input.mode === "tool_call") {
    const tool = describeToolCalls(input.toolCalls);
    modeValid = input.finishReason === "tool_calls" && tool.ok;
    modeReason = tool.reason;
    if (input.finishReason !== "tool_calls") {
      modeReason = `finish_reason ${input.finishReason ?? "missing"}; ${tool.reason}`;
    }
  } else {
    modeValid = input.streamTermination === "done";
    modeReason = modeValid ? "stream ended with [DONE]" : `stream termination ${input.streamTermination}`;
  }

  const empty = input.mode === "tool_call" ? input.toolCalls.length === 0 && contentEmpty : contentEmpty;
  const truncated =
    input.finishReason === "length" || (input.mode === "streaming" && input.streamTermination === "closed");
  const pass = httpSucceeded(input.httpStatus, input.error) && modeValid && !empty && !truncated;

  const reasons: string[] = [];
  if (!httpSucceeded(input.httpStatus, input.error)) {
    reasons.push(input.error ?? `HTTP ${input.httpStatus ?? "missing"}`);
  }
  if (!modeValid) reasons.push(modeReason);
  if (empty) reasons.push("empty output");
  if (truncated) {
    reasons.push(input.finishReason === "length" ? "finish_reason length" : "stream closed before [DONE]");
  }
  if (pass) reasons.push(modeReason);

  return { mode_valid: modeValid, empty, truncated, pass, reason: reasons.join("; ") };
}

export function describeToolCalls(calls: readonly ToolCall[]): { ok: boolean; reason: string } {
  if (calls.length === 0) return { ok: false, reason: "no tool call" };
  for (const call of calls) {
    const name = call.function?.name ?? "";
    if (name !== "get_weather") return { ok: false, reason: `function name ${name || "missing"}` };
    const parsed = parseToolArguments(call.function?.arguments);
    if (!parsed.parsed) return { ok: false, reason: "arguments did not parse as JSON" };
    if (!parsed.schema) return { ok: false, reason: "arguments did not match the city string schema" };
  }
  return { ok: true, reason: "get_weather arguments included a string city" };
}

export function buildRow(input: {
  item: PlanItem;
  timestamp: string;
  deployedCommit: string;
  providerPreference: string | null;
  requestParams: Record<string, unknown>;
  capture: ChatCapture;
}): RetestRow {
  const expected = expectedUpstream(input.capture.provider, input.item.model);
  const streamModelIds = input.item.mode === "streaming" ? [...input.capture.streamModelIds] : [];
  const streamed = input.item.mode === "streaming" && input.capture.sseFrames != null;
  const judged = judgeCapture({
    mode: input.item.mode,
    httpStatus: input.capture.httpStatus,
    error: input.capture.error,
    finishReason: input.capture.finishReason,
    contentText: input.capture.contentText,
    toolCalls: input.capture.toolCalls,
    streamTermination: input.capture.streamTermination,
  });
  return {
    request_id: input.capture.requestId,
    request_id_source: input.capture.requestIdSource,
    timestamp: input.timestamp,
    deployed_commit: input.deployedCommit,
    request_params: input.requestParams,
    requested_model: input.item.model,
    expected_upstream_model: expected,
    returned_model: input.capture.returnedModel,
    stream_model_ids: streamModelIds,
    "x-lmx-provider": input.capture.provider,
    "x-lmx-fallback": input.capture.fallback,
    "x-lmx-model-requested": input.capture.modelRequestedHeader,
    "x-lmx-model-resolved": input.capture.modelResolvedHeader,
    response_headers: { ...input.capture.responseHeaders },
    substitution: substitutionFor(expected, input.capture.returnedModel, streamModelIds),
    provider_preference: input.providerPreference,
    http_status: input.capture.httpStatus,
    error: input.capture.error,
    finish_reason: input.capture.finishReason,
    stream_termination: input.capture.streamTermination,
    response_json: streamed ? null : input.capture.responseJson,
    sse_frames: input.item.mode === "streaming" ? input.capture.sseFrames : null,
    usage: usageField(input.capture.usage),
    client_latency_ms: input.capture.clientLatencyMs,
    mode: input.item.mode,
    run: input.item.run,
    mode_valid: judged.mode_valid,
    empty: judged.empty,
    truncated: judged.truncated,
    pass: judged.pass,
    reason: judged.reason,
  };
}

export function summaryProblems(rows: readonly RetestRow[], meta: SummaryMeta): string[] {
  const problems: string[] = [];
  if (rows.length !== PLANNED_REQUESTS) {
    problems.push(`expected ${PLANNED_REQUESTS} rows, found ${rows.length}`);
  }
  rows.forEach((row, index) => {
    problems.push(...rowProblems(row, index + 1));
  });
  if (problems.length > 0) return problems;
  const commits = new Set(rows.map((row) => row.deployed_commit));
  if (commits.size !== 1) problems.push("deployed_commit differs across rows");
  if (!meta.resultsFile || !meta.endpoint || !Number.isFinite(meta.paceMs) || !meta.deployedCommitSource?.trim()) {
    problems.push("summary metadata is incomplete");
  }
  return problems;
}

export function renderSummary(rows: readonly RetestRow[], meta: SummaryMeta): string {
  const problems = summaryProblems(rows, meta);
  if (problems.length > 0) {
    throw new Error(`refusing to write summary: ${problems.join("; ")}`);
  }
  const started = rows[0]!.timestamp;
  const ended = rows[rows.length - 1]!.timestamp;
  const commit = rows[0]!.deployed_commit;
  const preferences = [...new Set(rows.map((row) => row.provider_preference ?? "none"))];
  const pacing = pacingStats(rows, meta.paceMs);
  const targetPerMinute = 60_000 / meta.paceMs;
  const lines: string[] = [
    `# Jason 40-request retest, ${etDate(started)}`,
    "",
    `Source file: \`${meta.resultsFile}\`. One production run. Failed requests were kept. None were repeated.`,
    "",
    "## Run conditions",
    "",
    `- Deployed commit: \`${commit}\` (${meta.deployedCommitSource}).`,
    `- Time: ${etRange(started, ended)}.`,
    `- Endpoint: \`${meta.endpoint}/v1/chat/completions\`.`,
    `- ${PLANNED_REQUESTS} requests. One attempt each. No retries and no replacement calls.`,
    `- \`max_tokens\`: ${MAX_TOKENS}.`,
    `- Pacing target: a request start every ${meta.paceMs / 1000} seconds (${fmt(targetPerMinute)} per minute).`,
    `- Pacing achieved, measured from recorded start times: ${fmt(pacing.achievedPerMinute)} per minute (mean start gap ${fmt(pacing.meanStartGapMs / 1000, 2)} s, longest ${fmt(pacing.maxStartGapMs / 1000, 2)} s; ${pacing.overruns} of ${Math.max(pacing.requests - 1, 0)} gaps exceeded the target by more than ${SLOT_TOLERANCE_MS} ms).`,
    "- Requests did not set `reasoning_effort`, `enable_thinking`, or `chat_template_kwargs`. Thinking stays at the server default (off for hybrid Qwen).",
    preferences.length === 1 && preferences[0] === "none"
      ? "- No provider preference was sent. `provider_preference` is null on every request."
      : `- Provider preference values: ${preferences.join(", ")}.`,
    "",
    "A plain request passes when the assistant content is non-empty. A `json_object` request passes when that content parses as a JSON object, with no markdown fence stripped. A tool call passes when `finish_reason` is `tool_calls`, the function name is `get_weather`, and the arguments parse as a JSON object whose `city` is a string. A stream passes when it includes `data: [DONE]`. A later `event: lmx.meta` or `event: lmx.error` trailer does not undo that terminator; another completion chunk after `[DONE]` does. Empty output and truncated output (`finish_reason` `length`, or a stream that closed before `[DONE]`) fail the pass even when the mode check would otherwise hold. HTTP errors fail the pass.",
    "",
    "## Passes by model and mode",
    "",
    "| Model | plain | json_object | tool_call | streaming |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const model of MODELS) {
    const cells = MODES.map((mode) => {
      const items = rows.filter((row) => row.requested_model === model && row.mode === mode);
      const passes = items.filter((row) => row.pass).length;
      return `${passes}/${items.length}`;
    });
    lines.push(`| ${model} | ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    `${rows.filter((row) => row.pass).length} of ${rows.length} requests passed.`,
    "",
    "## Requests",
    "",
    "Request ID source: `header` is LMX's `x-request-id`; `response_body` and `stream_chunk` are the completion ID returned in the response.",
    "",
    "| Model | Mode | Run | Request ID | Provider | Preference | Fallback | HTTP | Returned model | Stream model IDs | Substitution | finish_reason | Stream end | Empty | Truncated | Mode valid | Pass |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const row of rows) {
    lines.push(
      `| ${row.requested_model} | ${row.mode} | ${row.run} | ${cell(row.request_id)}${row.request_id_source ? ` (${row.request_id_source})` : ""} | ${cell(row["x-lmx-provider"])} | ${cell(row.provider_preference)} | ${cell(row["x-lmx-fallback"])} | ${row.http_status ?? "-"} | ${cell(row.returned_model)} | ${row.stream_model_ids.join(" | ") || "-"} | ${row.substitution.detected ? row.substitution.differing.join(" | ") : "no"} | ${cell(row.finish_reason)} | ${row.stream_termination} | ${yesNo(row.empty)} | ${yesNo(row.truncated)} | ${yesNo(row.mode_valid)} | ${yesNo(row.pass)} |`,
    );
  }

  const failures = rows.filter((row) => !row.pass);
  lines.push("", "## Failures", "");
  if (failures.length === 0) {
    lines.push("None.");
  } else {
    for (const row of failures) {
      lines.push(`- ${row.requested_model} ${row.mode} run ${row.run}: ${row.reason}`);
    }
  }

  const substitutions = rows.filter((row) => row.substitution.detected);
  lines.push("", "## Substitution", "");
  if (substitutions.length === 0) {
    lines.push("No returned model id differed from the expected upstream id.");
  } else {
    lines.push(`${substitutions.length} of ${rows.length} requests returned a different model id than the expected upstream id.`);
    for (const row of substitutions) {
      lines.push(
        `- ${row.requested_model} ${row.mode} run ${row.run}: expected \`${row.expected_upstream_model ?? "-"}\`; returned \`${row.returned_model ?? "-"}\`; stream ids \`${row.stream_model_ids.join(" | ") || "-"}\`.`,
      );
    }
  }

  const unavailable = rows.filter((row) => row.usage === "unavailable").length;
  const requestedHeader = rows.filter((row) => row["x-lmx-model-requested"]).length;
  const resolvedHeader = rows.filter((row) => row["x-lmx-model-resolved"]).length;
  const executedHeader = rows.filter((row) => row.response_headers["x-model-executed"]).length;
  const aliasedHeader = rows.filter((row) => row.response_headers["x-aliased"]).length;
  const aliasApplied = rows.filter(
    (row) => row["x-lmx-model-resolved"] && row["x-lmx-model-resolved"] !== row["x-lmx-model-requested"],
  ).length;
  lines.push(
    "",
    "## Usage and model headers",
    "",
    unavailable === 0
      ? "Every request included a usage object."
      : `Usage was unavailable on ${unavailable} of ${rows.length} requests. Those rows store \`usage\` as \`"unavailable"\` rather than an empty object.`,
    `\`x-lmx-model-requested\` was present on ${requestedHeader} of ${rows.length} requests. \`x-lmx-model-resolved\` was present on ${resolvedHeader} of ${rows.length} requests. The resolved model differed from the requested model (alias applied) on ${aliasApplied}.`,
    `Provider identity headers reaching the caller: \`x-model-executed\` on ${executedHeader} of ${rows.length}, \`x-aliased\` on ${aliasedHeader} of ${rows.length}. Each row's \`response_headers\` holds every \`x-lmx-*\` header and any of these that were sent.`,
    "",
  );
  return lines.join("\n");
}

/** Writes the summary only when every required field is present and consistent. */
export function writeSummaryFile(file: string, rows: readonly RetestRow[], meta: SummaryMeta): {
  written: boolean;
  problems: string[];
} {
  const problems = summaryProblems(rows, meta);
  if (problems.length > 0) return { written: false, problems };
  fs.writeFileSync(file, renderSummary(rows, meta));
  return { written: true, problems: [] };
}

function rowProblems(row: RetestRow, number: number): string[] {
  const problems: string[] = [];
  const record = row as unknown as Record<string, unknown>;
  if (!isRecord(record)) return [`row ${number} is not an object`];
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) problems.push(`row ${number} missing ${field}`);
  }
  if (typeof row.timestamp !== "string" || Number.isNaN(Date.parse(row.timestamp))) {
    problems.push(`row ${number} missing timestamp`);
  }
  if (typeof row.deployed_commit !== "string" || !/^[0-9a-f]{40}$/.test(row.deployed_commit)) {
    problems.push(`row ${number} missing deployed_commit`);
  }
  if (!MODELS.includes(row.requested_model)) problems.push(`row ${number} missing requested_model`);
  if (!MODES.includes(row.mode)) problems.push(`row ${number} missing mode`);
  if (row.run !== numberRun(row.run)) problems.push(`row ${number} missing run`);
  if (!requestParamsMatch(row)) problems.push(`row ${number} missing request_params`);
  if (!(row.expected_upstream_model === null || typeof row.expected_upstream_model === "string")) {
    problems.push(`row ${number} missing expected_upstream_model`);
  }
  if (!(row.returned_model === null || typeof row.returned_model === "string")) {
    problems.push(`row ${number} missing returned_model`);
  }
  if (!stringArray(row.stream_model_ids)) problems.push(`row ${number} missing stream_model_ids`);
  for (const field of [
    "x-lmx-provider",
    "x-lmx-fallback",
    "x-lmx-model-requested",
    "x-lmx-model-resolved",
    "provider_preference",
    "finish_reason",
  ] as const) {
    const value = row[field];
    if (!(value === null || typeof value === "string")) problems.push(`row ${number} missing ${field}`);
  }
  if (!(row.request_id === null || typeof row.request_id === "string")) {
    problems.push(`row ${number} missing request_id`);
  }
  if (row.request_id === null ? row.request_id_source !== null : !REQUEST_ID_SOURCES.has(String(row.request_id_source))) {
    problems.push(`row ${number} request_id_source does not match request_id`);
  }
  if (!isRecord(row.response_headers) || !Object.values(row.response_headers).every((v) => typeof v === "string")) {
    problems.push(`row ${number} missing response_headers`);
  }
  if (typeof row.client_latency_ms !== "number" || !Number.isFinite(row.client_latency_ms) || row.client_latency_ms < 0) {
    problems.push(`row ${number} missing client_latency_ms`);
  }
  if (httpSucceeded(row.http_status, row.error) && (typeof row.request_id !== "string" || row.request_id.length === 0)) {
    problems.push(`row ${number} missing request_id`);
  }
  if (!substitutionMatches(row)) problems.push(`row ${number} missing substitution`);
  if (!(row.http_status === null || typeof row.http_status === "number")) {
    problems.push(`row ${number} missing http_status`);
  }
  if (!(row.error === null || (typeof row.error === "string" && row.error.length > 0))) {
    problems.push(`row ${number} missing error`);
  }
  if (!httpSucceeded(row.http_status, row.error) && (typeof row.error !== "string" || row.error.length === 0)) {
    problems.push(`row ${number} missing error`);
  }
  if (!STREAM_TERMINATIONS.has(row.stream_termination)) problems.push(`row ${number} missing stream_termination`);
  if (row.mode === "streaming") {
    if (httpSucceeded(row.http_status, row.error) && !Array.isArray(row.sse_frames)) {
      problems.push(`row ${number} missing sse_frames`);
    }
    if (row.stream_termination === "done" && !framesIncludeDone(row.sse_frames)) {
      problems.push(`row ${number} missing sse_frames`);
    }
  } else if (httpSucceeded(row.http_status, row.error) && row.response_json == null) {
    problems.push(`row ${number} missing response_json`);
  }
  if (row.usage !== "unavailable" && !isRecord(row.usage)) problems.push(`row ${number} missing usage`);
  for (const field of ["mode_valid", "empty", "truncated", "pass"] as const) {
    if (typeof row[field] !== "boolean") problems.push(`row ${number} missing ${field}`);
  }
  if (typeof row.reason !== "string" || row.reason.length === 0) problems.push(`row ${number} missing reason`);
  if (
    typeof row.mode_valid === "boolean" &&
    typeof row.empty === "boolean" &&
    typeof row.truncated === "boolean" &&
    typeof row.pass === "boolean" &&
    row.pass !== (httpSucceeded(row.http_status, row.error) && row.mode_valid && !row.empty && !row.truncated)
  ) {
    problems.push(`row ${number} pass does not match mode_valid, empty, truncated, and http status`);
  }
  return problems;
}

function requestParamsMatch(row: RetestRow): boolean {
  const params = row.request_params;
  if (!isRecord(params)) return false;
  if (params.model !== row.requested_model) return false;
  if (params.max_tokens !== MAX_TOKENS) return false;
  if (!Array.isArray(params.messages) || params.messages.length === 0) return false;
  if (params.stream !== (row.mode === "streaming")) return false;
  if ("reasoning_effort" in params || "enable_thinking" in params || "chat_template_kwargs" in params) return false;
  if ("authorization" in params || "api_key" in params || "apiKey" in params) return false;
  if (row.mode === "json_object") {
    return isRecord(params.response_format) && params.response_format.type === "json_object";
  }
  if ("response_format" in params) return false;
  if (row.mode === "tool_call") {
    if (params.tool_choice !== "auto" || !Array.isArray(params.tools)) return false;
    const tool = params.tools[0];
    return isRecord(tool) && isRecord(tool.function) && tool.function.name === "get_weather";
  }
  return !("tools" in params) && !("tool_choice" in params);
}

function substitutionMatches(row: RetestRow): boolean {
  const sub = row.substitution;
  if (!isRecord(sub) || typeof sub.detected !== "boolean" || !stringArray(sub.differing)) return false;
  if (!stringArray(sub.stream_model_ids)) return false;
  const expected = substitutionFor(row.expected_upstream_model, row.returned_model, row.stream_model_ids);
  return (
    sub.detected === expected.detected &&
    sub.expected === row.expected_upstream_model &&
    sub.returned === row.returned_model &&
    sameStrings(sub.stream_model_ids, row.stream_model_ids) &&
    sameStrings(sub.differing, expected.differing)
  );
}

function httpSucceeded(status: number | null, error: string | null): boolean {
  return status != null && status >= 200 && status < 300 && error == null;
}

function numberRun(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= RUNS_PER_CELL ? value : null;
}

function framesIncludeDone(frames: string[] | null): boolean {
  if (!frames) return false;
  return frames.some((frame) =>
    frame.split("\n").some((line) => line.trim() === "data: [DONE]"),
  );
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isJsonObject(text: string): boolean {
  try {
    return isRecord(JSON.parse(text.trim()) as unknown);
  } catch {
    return false;
  }
}

function parseToolArguments(value: unknown): { parsed: boolean; schema: boolean } {
  if (typeof value !== "string") return { parsed: false, schema: false };
  try {
    const json = JSON.parse(value) as unknown;
    const schema = isRecord(json) && typeof json.city === "string";
    return { parsed: true, schema };
  } catch {
    return { parsed: false, schema: false };
  }
}

function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function cell(value: string | null): string {
  return value && value.length > 0 ? value.replace(/\|/g, "\\|") : "-";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function etDate(iso: string): string {
  const parts = etParts(iso);
  return `${parts.day} ${parts.month} ${parts.year}`;
}

export function etRange(startIso: string, endIso: string): string {
  const start = etParts(startIso);
  const end = etParts(endIso);
  const startClock = `${start.hour}:${start.minute}:${start.second} ${start.dayPeriod}`;
  const endClock = `${end.hour}:${end.minute}:${end.second} ${end.dayPeriod}`;
  if (start.day === end.day && start.month === end.month && start.year === end.year) {
    return `${start.day} ${start.month} ${start.year}, ${startClock}–${endClock} ET`;
  }
  return `${etDate(startIso)}, ${startClock} ET–${etDate(endIso)}, ${endClock} ET`;
}

function etParts(iso: string): {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
  dayPeriod: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    dayPeriod: get("dayPeriod").toUpperCase(),
  };
}
