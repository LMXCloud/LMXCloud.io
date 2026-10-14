/**
 * Pure logic for the qwen-3.5-35b alias check (runner: test-qwen35-alias-check.ts).
 *
 * After PR #3, qwen-3.5-35b is an explicit alias of qwen-3.6-35b. This check proves, per request,
 * which provider served it, which model the router resolved, and which model actually came back,
 * on both the streaming and non-streaming paths. Every reported value comes from the response;
 * a value the response did not carry is written as "not sent", never as a placeholder.
 */
import fs from "node:fs";
import { expectedProviderModelId } from "../src/providers/model-maps.js";
import { PLAIN_USER, isRecord, type ChatCapture, type RequestIdSource } from "./jason-40-chat.js";
import { etRange, pacingStats } from "./jason-40-retest.js";

export const ALIAS_MODEL = "qwen-3.5-35b";
export const RESOLVED_MODEL = "qwen-3.6-35b";
export const PREFERENCES = [null, "provider:akash", "provider:ionet"] as const;
export const STREAM_MODES = [false, true] as const;
export const ALIAS_RUNS = 2;
export const ALIAS_PLANNED = PREFERENCES.length * STREAM_MODES.length * ALIAS_RUNS;
export const ALIAS_MAX_TOKENS = 50;

export type AliasPlanItem = { preference: (typeof PREFERENCES)[number]; stream: boolean; run: number };

export type AliasRow = {
  request_id: string | null;
  request_id_source: RequestIdSource | null;
  timestamp: string;
  deployed_commit: string;
  request_params: Record<string, unknown>;
  provider_preference: string | null;
  stream: boolean;
  run: number;
  http_status: number | null;
  error: string | null;
  provider: string | null;
  fallback: string | null;
  model_requested_header: string | null;
  model_resolved_header: string | null;
  executed_model_header: string | null;
  aliased_header: string | null;
  response_headers: Record<string, string>;
  expected_upstream_model: string | null;
  returned_model: string | null;
  stream_model_ids: string[];
  observed_model_ids: string[];
  finish_reason: string | null;
  stream_termination: ChatCapture["streamTermination"];
  content: string;
  usage: Record<string, unknown> | "unavailable";
  client_latency_ms: number;
  response_json: unknown | null;
  sse_frames: string[] | null;
  checks: {
    http_ok: boolean;
    alias_headers: boolean;
    model_identity: boolean;
    preference_honored: boolean | null;
    output_complete: boolean;
  };
  pass: boolean;
  reason: string;
};

export function buildAliasPlan(): AliasPlanItem[] {
  const plan: AliasPlanItem[] = [];
  for (const preference of PREFERENCES) {
    for (const stream of STREAM_MODES) {
      for (let run = 1; run <= ALIAS_RUNS; run += 1) plan.push({ preference, stream, run });
    }
  }
  return plan;
}

export function aliasRequestBody(item: AliasPlanItem): Record<string, unknown> {
  return { model: ALIAS_MODEL, messages: [PLAIN_USER], max_tokens: ALIAS_MAX_TOKENS, stream: item.stream };
}

export function aliasRequestHeaders(item: AliasPlanItem): Record<string, string> {
  return item.preference ? { "x-lmx-prefer": item.preference } : {};
}

/**
 * Pass requires: HTTP 2xx; x-lmx-model-requested = qwen-3.5-35b and x-lmx-model-resolved = qwen-3.6-35b;
 * every observed model ID (body, every stream chunk, and x-model-executed if sent) equal to the
 * provider's upstream ID for qwen-3.6-35b; non-empty content; a stream ends with [DONE] and nothing is truncated.
 * Whether a provider preference was honored is reported but does not decide the pass.
 */
export function buildAliasRow(input: {
  item: AliasPlanItem;
  timestamp: string;
  deployedCommit: string;
  requestParams: Record<string, unknown>;
  capture: ChatCapture;
}): AliasRow {
  const { capture, item } = input;
  const headers = capture.responseHeaders;
  const executed = headers["x-model-executed"] ?? null;
  const expected = capture.provider ? (expectedProviderModelId(capture.provider, RESOLVED_MODEL) ?? null) : null;
  const streamIds = item.stream ? [...capture.streamModelIds] : [];
  const observed: string[] = [];
  for (const id of [capture.returnedModel, ...streamIds, executed]) {
    if (id && !observed.includes(id)) observed.push(id);
  }
  const httpOk = capture.httpStatus != null && capture.httpStatus >= 200 && capture.httpStatus < 300 && capture.error == null;
  const aliasHeaders = capture.modelRequestedHeader === ALIAS_MODEL && capture.modelResolvedHeader === RESOLVED_MODEL;
  const modelIdentity = expected != null && observed.length > 0 && observed.every((id) => id === expected);
  const preferredProvider = item.preference?.split(":")[1] ?? null;
  const preferenceHonored = preferredProvider ? capture.provider === preferredProvider : null;
  const truncated = capture.finishReason === "length" || (item.stream && capture.streamTermination !== "done");
  const outputComplete = capture.contentText.trim().length > 0 && !truncated;

  const reasons: string[] = [];
  if (!httpOk) reasons.push(capture.error ?? `HTTP ${capture.httpStatus ?? "missing"}`);
  if (!aliasHeaders) {
    reasons.push(
      `alias headers requested=${capture.modelRequestedHeader ?? "not sent"} resolved=${capture.modelResolvedHeader ?? "not sent"}`,
    );
  }
  if (!modelIdentity) {
    reasons.push(`expected ${expected ?? "unknown for provider " + (capture.provider ?? "not sent")}; observed ${observed.join(" | ") || "none"}`);
  }
  if (!outputComplete) {
    reasons.push(truncated ? `truncated (finish_reason ${capture.finishReason ?? "missing"}, stream ${capture.streamTermination})` : "empty content");
  }
  const pass = httpOk && aliasHeaders && modelIdentity && outputComplete;
  if (pass) reasons.push("alias resolved to qwen-3.6-35b and every observed model ID matched");

  return {
    request_id: capture.requestId,
    request_id_source: capture.requestIdSource,
    timestamp: input.timestamp,
    deployed_commit: input.deployedCommit,
    request_params: input.requestParams,
    provider_preference: item.preference,
    stream: item.stream,
    run: item.run,
    http_status: capture.httpStatus,
    error: capture.error,
    provider: capture.provider,
    fallback: capture.fallback,
    model_requested_header: capture.modelRequestedHeader,
    model_resolved_header: capture.modelResolvedHeader,
    executed_model_header: executed,
    aliased_header: headers["x-aliased"] ?? null,
    response_headers: { ...headers },
    expected_upstream_model: expected,
    returned_model: capture.returnedModel,
    stream_model_ids: streamIds,
    observed_model_ids: observed,
    finish_reason: capture.finishReason,
    stream_termination: capture.streamTermination,
    content: capture.contentText,
    usage: isRecord(capture.usage) ? capture.usage : "unavailable",
    client_latency_ms: capture.clientLatencyMs,
    response_json: item.stream ? null : capture.responseJson,
    sse_frames: item.stream ? capture.sseFrames : null,
    checks: {
      http_ok: httpOk,
      alias_headers: aliasHeaders,
      model_identity: modelIdentity,
      preference_honored: preferenceHonored,
      output_complete: outputComplete,
    },
    pass,
    reason: reasons.join("; "),
  };
}

export type AliasSummaryMeta = { resultsFile: string; endpoint: string; deployedCommitSource: string; paceMs: number };

export function aliasSummaryProblems(rows: readonly AliasRow[], meta: AliasSummaryMeta): string[] {
  const problems: string[] = [];
  if (rows.length !== ALIAS_PLANNED) problems.push(`expected ${ALIAS_PLANNED} rows, found ${rows.length}`);
  if (new Set(rows.map((row) => row.deployed_commit)).size > 1) problems.push("deployed_commit differs across rows");
  if (!meta.resultsFile || !meta.endpoint || !meta.deployedCommitSource?.trim()) problems.push("summary metadata is incomplete");
  rows.forEach((row, index) => {
    const n = index + 1;
    if (!/^[0-9a-f]{40}$/.test(row.deployed_commit)) problems.push(`row ${n} missing deployed_commit`);
    if (Number.isNaN(Date.parse(row.timestamp))) problems.push(`row ${n} missing timestamp`);
    if (row.checks.http_ok && !row.request_id) problems.push(`row ${n} missing request_id`);
    if (!row.checks.http_ok && !row.error && row.http_status == null) problems.push(`row ${n} missing error`);
    if (row.stream && row.checks.http_ok && !Array.isArray(row.sse_frames)) problems.push(`row ${n} missing sse_frames`);
    if (!row.stream && row.checks.http_ok && row.response_json == null) problems.push(`row ${n} missing response_json`);
  });
  return problems;
}

export function renderAliasSummary(rows: readonly AliasRow[], meta: AliasSummaryMeta): string {
  const problems = aliasSummaryProblems(rows, meta);
  if (problems.length > 0) throw new Error(`refusing to write summary: ${problems.join("; ")}`);
  const v = (value: string | null | undefined) => (value && value.length > 0 ? value.replace(/\|/g, "\\|") : "not sent");
  const pacing = pacingStats(rows, meta.paceMs);
  const lines = [
    `# qwen-3.5-35b alias check`,
    "",
    `Source file: \`${meta.resultsFile}\`. One production run. Failed requests were kept. None were repeated.`,
    "",
    "## Run conditions",
    "",
    `- Deployed commit: \`${rows[0]!.deployed_commit}\` (${meta.deployedCommitSource}).`,
    `- Time: ${etRange(rows[0]!.timestamp, rows[rows.length - 1]!.timestamp)}.`,
    `- Endpoint: \`${meta.endpoint}/v1/chat/completions\`.`,
    `- ${rows.length} requests for \`${ALIAS_MODEL}\`: streaming and non-streaming, with no preference, \`x-lmx-prefer: provider:akash\`, and \`x-lmx-prefer: provider:ionet\`, ${ALIAS_RUNS} runs each. One attempt each, no retries, \`max_tokens\` ${ALIAS_MAX_TOKENS}, thinking left at the server default.`,
    `- Pacing: starts scheduled every ${meta.paceMs / 1000} s; achieved ${pacing.achievedPerMinute.toFixed(1)} per minute.`,
    "",
    "A request passes when it returns HTTP 2xx, `x-lmx-model-requested` is `qwen-3.5-35b` and `x-lmx-model-resolved` is `qwen-3.6-35b`, every observed model ID (response body, every stream chunk, and `x-model-executed` when sent) equals the serving provider's upstream ID for qwen-3.6-35b, content is non-empty, and nothing is truncated (a stream must end with `[DONE]`). Whether a provider preference was honored is reported separately and does not decide the pass. \"not sent\" means the response did not carry that value.",
    "",
    "## Results",
    "",
    `${rows.filter((row) => row.pass).length} of ${rows.length} requests passed.`,
    "",
    "| Preference | Stream | Run | Request ID | HTTP | Provider | Fallback | Preference honored | Requested (header) | Resolved (header) | x-model-executed | x-aliased | Expected upstream | Returned model | Stream model IDs | finish_reason | Stream end | Pass |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.provider_preference ?? "none"} | ${row.stream ? "yes" : "no"} | ${row.run} | ${v(row.request_id)}${row.request_id_source ? ` (${row.request_id_source})` : ""} | ${row.http_status ?? "not sent"} | ${v(row.provider)} | ${v(row.fallback)} | ${row.checks.preference_honored == null ? "n/a" : row.checks.preference_honored ? "yes" : "no"} | ${v(row.model_requested_header)} | ${v(row.model_resolved_header)} | ${v(row.executed_model_header)} | ${v(row.aliased_header)} | ${v(row.expected_upstream_model)} | ${v(row.returned_model)} | ${row.stream ? v(row.stream_model_ids.join(" \\| ")) : "n/a"} | ${v(row.finish_reason)} | ${row.stream_termination} | ${row.pass ? "yes" : "no"} |`,
    );
  }
  const failures = rows.filter((row) => !row.pass);
  lines.push("", "## Failures", "", ...(failures.length ? failures.map((r) => `- ${r.provider_preference ?? "none"} stream=${r.stream} run ${r.run}: ${r.reason}`) : ["None."]));
  const executed = rows.filter((row) => row.executed_model_header).length;
  const unhonored = rows.filter((row) => row.checks.preference_honored === false);
  lines.push(
    "",
    "## Notes",
    "",
    `- \`x-model-executed\` reached the caller on ${executed} of ${rows.length} requests. LMX reads the provider's executed-model header internally for substitution detection; forwarding it to callers is still open.`,
    unhonored.length
      ? `- A provider preference was not honored on ${unhonored.length} request(s): ${unhonored.map((r) => `${r.provider_preference} → ${r.provider ?? "not sent"}`).join(", ")}.`
      : "- Every provider preference that was sent was honored.",
    "",
  );
  return lines.join("\n");
}

export function writeAliasSummary(file: string, rows: readonly AliasRow[], meta: AliasSummaryMeta): { written: boolean; problems: string[] } {
  const problems = aliasSummaryProblems(rows, meta);
  if (problems.length) return { written: false, problems };
  fs.writeFileSync(file, renderAliasSummary(rows, meta));
  return { written: true, problems: [] };
}
