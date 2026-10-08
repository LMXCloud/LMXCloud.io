/**
 * Production field-forwarding check, and the harness for re-running it later.
 *
 *   LMX_TEST_API_KEY=lmx_... pnpm test:forwarding
 *   API_URL=https://api.lmxcloud.io pnpm --filter @lmxcloud/api test:forwarding
 *
 * Reads the key from LMX_TEST_API_KEY. Never prints it.
 * One attempt per request, 30 chat calls max. Pass/fail comes from the body.
 * json_schema misses are findings and do not fail the process.
 * Results: apps/api/scripts/results/forwarding-<timestamp>.jsonl
 *
 * Qwen follow-up evidence is a separate command: pnpm test:qwen-followup.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedProviderModelId } from "../src/providers/model-maps.js";
import {
  WEATHER_TOOL,
  WEATHER_USER,
  forwardingApiUrl,
  forwardingTimeoutMs,
  isRecord,
  postChat,
  redact,
  type ChatResult,
} from "./forwarding-chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const MAX_REQUESTS = 30;

const CONFIDENCE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "answer",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { confidence: { type: "number" } },
      required: ["confidence"],
    },
  },
};

type Verdict = "pass" | "fail" | "finding";

type LogRow = {
  timestamp: string;
  check: string;
  requested_model: string;
  returned_model: string | null;
  "x-lmx-provider": string | null;
  "x-lmx-fallback": string | null;
  "x-lmx-latency": string | null;
  "x-lmx-cost": string | null;
  http_status: number | null;
  finish_reason: string | null;
  content_empty: "y" | "n";
  tool_calls_present: "y" | "n";
  client_latency_ms: number;
  ttft_ms: number | null;
  usage: unknown;
  result: Verdict;
  reason: string;
};

type Feature =
  | "tools"
  | "streaming_tools"
  | "json_object"
  | "json_schema"
  | "enable_thinking";

const AKASH_PREFER = ["qwen-3.5-35b", "llama-3.3-70b", "qwen-3.6-35b"];
const AETHIR_PREFER = ["qwen3.6-35b-a3b", "qwen3.6-27b", "qwen-3.6-35b", "qwen-3.6-27b"];

function main() {
  const apiKey = process.env.LMX_TEST_API_KEY?.trim();
  if (!apiKey) {
    console.error("LMX_TEST_API_KEY is not set.");
    process.exit(1);
  }
  return run(apiKey).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(redact(message, apiKey));
    process.exit(1);
  });
}

async function run(apiKey: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const resultsPath = path.join(resultsDir, `forwarding-${stamp}.jsonl`);

  const catalog = await fetchCatalog();
  const akashModel = pickOwned(catalog, "akash", AKASH_PREFER);
  const aethirModel = pickOwned(catalog, "aethir", AETHIR_PREFER);

  const rows: LogRow[] = [];
  const matrix = new Map<string, Partial<Record<Feature, string>>>();
  let sent = 0;

  const note = (row: LogRow) => {
    rows.push(row);
    fs.appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    console.log(
      `${row.result.padEnd(8)} ${row.check.padEnd(36)} ${row["x-lmx-provider"] ?? "-"}  ${row.reason}`,
    );
  };

  const chat = async (
    check: string,
    body: Record<string, unknown>,
    prefer?: string,
  ): Promise<ChatResult> => {
    sent += 1;
    if (sent > MAX_REQUESTS) {
      throw new Error(`refusing to exceed ${MAX_REQUESTS} requests`);
    }
    return postChat(apiKey, body, prefer);
  };

  const toolBody = {
    model: "llama-3.3-70b",
    messages: [WEATHER_USER],
    tools: [WEATHER_TOOL],
    tool_choice: "auto",
    max_tokens: 256,
    temperature: 0,
  };

  const tool = await chat("tool_call", toolBody, "ionet");
  const toolJudge = judgeToolCall(tool);
  note(toRow("tool_call", "llama-3.3-70b", tool, toolJudge.verdict, toolJudge.reason));
  setCell(matrix, tool.provider, "tools", toolJudge.verdict);

  const streamed = await chat(
    "tool_call_stream",
    { ...toolBody, stream: true },
    "ionet",
  );
  const streamJudge = judgeStreamedToolCall(streamed);
  note(
    toRow("tool_call_stream", "llama-3.3-70b", streamed, streamJudge.verdict, streamJudge.reason),
  );
  setCell(matrix, streamed.provider, "streaming_tools", streamJudge.verdict);

  if (tool.toolCalls.length > 0) {
    const roundBody = {
      model: "llama-3.3-70b",
      messages: [
        WEATHER_USER,
        {
          role: "assistant",
          content: tool.contentText.length > 0 ? tool.contentText : null,
          tool_calls: tool.toolCalls,
        },
        {
          role: "tool",
          tool_call_id: tool.toolCalls[0]?.id,
          content: '{"temp_f": 61}',
        },
      ],
      max_tokens: 200,
      temperature: 0,
    };
    const round = await chat("tool_round_trip", roundBody, "ionet");
    const roundJudge = judgeRoundTrip(round);
    note(toRow("tool_round_trip", "llama-3.3-70b", round, roundJudge.verdict, roundJudge.reason));
  } else {
    note(skipped("tool_round_trip", "llama-3.3-70b", "no tool call to send back"));
  }

  const schemaTargets: Array<{ model: string; prefer?: string }> = [
    { model: "llama-3.3-70b", prefer: "ionet" },
    { model: "qwen-3.6-35b", prefer: "ionet" },
  ];
  if (akashModel) schemaTargets.push({ model: akashModel, prefer: "akash" });
  if (aethirModel) schemaTargets.push({ model: aethirModel, prefer: "aethir" });

  for (const target of schemaTargets) {
    const check = `json_schema:${target.model}`;
    const result = await chat(
      check,
      {
        model: target.model,
        messages: [{ role: "user", content: "Describe the sky in one short sentence." }],
        response_format: CONFIDENCE_SCHEMA,
        max_tokens: 256,
      },
      target.prefer,
    );
    const judged = judgeJsonSchema(result);
    note(toRow(check, target.model, result, judged.verdict, judged.reason));
    appendSchema(matrix, result.provider, target.model, judged.enforced);
  }

  const jsonTargets: Array<{ model: string; prefer: string; check: string }> = [
    { model: "llama-3.3-70b", prefer: "ionet", check: "json_object:ionet" },
  ];
  if (akashModel) {
    jsonTargets.push({ model: akashModel, prefer: "akash", check: "json_object:akash" });
  }
  if (aethirModel) {
    jsonTargets.push({ model: aethirModel, prefer: "aethir", check: "json_object:aethir" });
  }
  for (const target of jsonTargets) {
    const result = await chat(
      target.check,
      {
        model: target.model,
        messages: [{ role: "user", content: "Return a JSON object with a greeting." }],
        response_format: { type: "json_object" },
        max_tokens: 128,
      },
      target.prefer,
    );
    const judged = judgeJsonObject(result);
    note(toRow(target.check, target.model, result, judged.verdict, judged.reason));
    setCell(matrix, result.provider, "json_object", judged.verdict === "pass" ? "pass" : "finding");
  }

  const thinking = await chat("enable_thinking", {
    model: "qwen-3.6-35b",
    messages: [{ role: "user", content: "Reply with the single word pong." }],
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 400,
  });
  const thinkingJudge = judgeNonEmptyText(thinking, "content was empty");
  note(toRow("enable_thinking", "qwen-3.6-35b", thinking, thinkingJudge.verdict, thinkingJudge.reason));
  setCell(matrix, thinking.provider, "enable_thinking", thinkingJudge.verdict);

  const baseline = await chat("baseline", {
    model: "llama-3.3-70b",
    messages: [{ role: "user", content: "Say hi" }],
    max_tokens: 32,
  });
  const baselineJudge = judgeBaseline(baseline);
  note(toRow("baseline", "llama-3.3-70b", baseline, baselineJudge.verdict, baselineJudge.reason));

  printSummary(rows, matrix, tool.provider, akashModel, aethirModel, resultsPath);

  const hardFail = rows.some(
    (row) =>
      row.result === "fail" &&
      !row.check.startsWith("json_schema:") &&
      !row.check.startsWith("json_object:"),
  );
  const missedIonet = tool.provider !== "ionet";
  if (missedIonet || hardFail) process.exitCode = 1;
}

async function fetchCatalog(): Promise<Array<{ id: string; owned_by: string }>> {
  const response = await fetch(`${forwardingApiUrl()}/v1/models`, {
    signal: AbortSignal.timeout(forwardingTimeoutMs()),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    data?: Array<{ id?: string; owned_by?: string }>;
  };
  return (body.data ?? [])
    .filter((model) => typeof model.id === "string" && typeof model.owned_by === "string")
    .map((model) => ({ id: model.id as string, owned_by: model.owned_by as string }));
}

function pickOwned(
  catalog: Array<{ id: string; owned_by: string }>,
  owner: string,
  prefer: string[],
): string | null {
  const owned = catalog.filter((model) => model.owned_by === owner);
  for (const id of prefer) {
    if (owned.some((model) => model.id === id)) return id;
  }
  const alias = owned.find((model) => !model.id.includes("/"));
  return alias?.id ?? owned[0]?.id ?? null;
}

function judgeToolCall(result: ChatResult): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "fail", reason: result.errorMessage };
  if (result.finishReason !== "tool_calls") {
    return { verdict: "fail", reason: `finish_reason ${result.finishReason ?? "missing"}` };
  }
  if (result.toolCalls.length === 0) {
    return { verdict: "fail", reason: "tool_calls array missing" };
  }
  const bad = result.toolCalls.find((call) => !argumentsParse(call.function?.arguments));
  if (bad) return { verdict: "fail", reason: "arguments was not a JSON string that parses" };
  return { verdict: "pass", reason: `${result.toolCalls.length} tool call(s), arguments parsed` };
}

function judgeStreamedToolCall(result: ChatResult): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "fail", reason: result.errorMessage };
  if (result.toolCalls.length !== 1) {
    return { verdict: "fail", reason: `reassembled ${result.toolCalls.length} tool calls` };
  }
  const call = result.toolCalls[0]!;
  if (!call.id || !call.function?.name) {
    return { verdict: "fail", reason: "reassembled tool call was missing id or name" };
  }
  if (!argumentsParse(call.function.arguments)) {
    return { verdict: "fail", reason: "reassembled arguments did not parse" };
  }
  return { verdict: "pass", reason: `one tool call ${call.function.name}` };
}

function judgeRoundTrip(result: ChatResult): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "fail", reason: result.errorMessage };
  if (!result.contentText.includes("61")) {
    return { verdict: "fail", reason: "final text did not mention 61" };
  }
  return { verdict: "pass", reason: "final text mentions 61" };
}

function judgeJsonSchema(result: ChatResult): { verdict: Verdict; reason: string; enforced: boolean } {
  if (result.errorMessage) {
    return { verdict: "finding", reason: result.errorMessage, enforced: false };
  }
  const parsed = parseJsonObject(result.contentText);
  const confidence = isRecord(parsed) ? parsed.confidence : undefined;
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    return { verdict: "pass", reason: "confidence present and numeric", enforced: true };
  }
  return { verdict: "finding", reason: "confidence missing or not numeric", enforced: false };
}

function judgeJsonObject(result: ChatResult): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "finding", reason: result.errorMessage };
  const parsed = parseJsonObject(result.contentText);
  if (!isRecord(parsed)) return { verdict: "finding", reason: "content was not a JSON object" };
  return { verdict: "pass", reason: "content parsed as a JSON object" };
}

function judgeNonEmptyText(result: ChatResult, emptyReason: string): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "fail", reason: result.errorMessage };
  if (result.contentText.trim().length === 0) return { verdict: "fail", reason: emptyReason };
  return { verdict: "pass", reason: "content non-empty" };
}

function judgeBaseline(result: ChatResult): { verdict: Verdict; reason: string } {
  if (result.errorMessage) return { verdict: "fail", reason: result.errorMessage };
  if (result.toolCalls.length > 0) return { verdict: "fail", reason: "plain request returned tool_calls" };
  if (result.contentText.trim().length === 0) return { verdict: "fail", reason: "content was empty" };
  if (result.finishReason !== "stop" && result.finishReason !== "length") {
    return { verdict: "fail", reason: `finish_reason ${result.finishReason ?? "missing"}` };
  }
  return { verdict: "pass", reason: "plain text completion" };
}

function argumentsParse(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  try {
    return JSON.parse(fenced ? fenced[1]!.trim() : trimmed);
  } catch {
    return undefined;
  }
}

function toRow(
  check: string,
  requestedModel: string,
  result: ChatResult,
  verdict: Verdict,
  reason: string,
): LogRow {
  return {
    timestamp: new Date().toISOString(),
    check,
    requested_model: requestedModel,
    returned_model: result.returnedModel,
    "x-lmx-provider": result.provider,
    "x-lmx-fallback": result.fallback,
    "x-lmx-latency": result.latencyHeader,
    "x-lmx-cost": result.costHeader,
    http_status: result.httpStatus,
    finish_reason: result.finishReason,
    content_empty: result.contentText.trim().length === 0 ? "y" : "n",
    tool_calls_present: result.toolCalls.length > 0 ? "y" : "n",
    client_latency_ms: result.clientLatencyMs,
    ttft_ms: result.ttftMs,
    usage: result.usage,
    result: verdict,
    reason,
  };
}

function skipped(check: string, requestedModel: string, reason: string): LogRow {
  return {
    timestamp: new Date().toISOString(),
    check,
    requested_model: requestedModel,
    returned_model: null,
    "x-lmx-provider": null,
    "x-lmx-fallback": null,
    "x-lmx-latency": null,
    "x-lmx-cost": null,
    http_status: null,
    finish_reason: null,
    content_empty: "y",
    tool_calls_present: "n",
    client_latency_ms: 0,
    ttft_ms: null,
    usage: null,
    result: "fail",
    reason,
  };
}

function setCell(
  matrix: Map<string, Partial<Record<Feature, string>>>,
  provider: string | null,
  feature: Feature,
  value: string,
) {
  const key = provider ?? "unknown";
  const row = matrix.get(key) ?? {};
  row[feature] = value;
  matrix.set(key, row);
}

function appendSchema(
  matrix: Map<string, Partial<Record<Feature, string>>>,
  provider: string | null,
  model: string,
  enforced: boolean,
) {
  const key = provider ?? "unknown";
  const row = matrix.get(key) ?? {};
  const mark = `${model}:${enforced ? "yes" : "no"}`;
  row.json_schema = row.json_schema ? `${row.json_schema}, ${mark}` : mark;
  matrix.set(key, row);
}

function printSummary(
  rows: LogRow[],
  matrix: Map<string, Partial<Record<Feature, string>>>,
  toolProvider: string | null,
  akashModel: string | null,
  aethirModel: string | null,
  resultsPath: string,
) {
  console.log("\n(a) pass/fail");
  console.log(
    `${"check".padEnd(36)} ${"result".padEnd(8)} ${"provider".padEnd(10)} reason`,
  );
  for (const row of rows) {
    console.log(
      `${row.check.padEnd(36)} ${row.result.padEnd(8)} ${(row["x-lmx-provider"] ?? "-").padEnd(10)} ${row.reason}`,
    );
  }
  if (toolProvider === "ionet") {
    console.log("\ntool_call hit ionet.");
  } else {
    console.log(
      `\ntool_call did not hit ionet (Jason's case). Provider was ${toolProvider ?? "missing"}.`,
    );
  }
  if (!akashModel) console.log("No Akash-owned model in the live catalog; json_schema/json_object skipped.");
  if (!aethirModel) console.log("No Aethir-owned model in the live catalog; json_schema/json_object skipped.");

  console.log("\n(b) provider × feature");
  const features: Feature[] = [
    "tools",
    "streaming_tools",
    "json_object",
    "json_schema",
    "enable_thinking",
  ];
  console.log(`${"provider".padEnd(12)} ${features.map((feature) => feature.padEnd(28)).join("")}`);
  const providers = [...matrix.keys()].sort();
  if (providers.length === 0) console.log("(no provider headers)");
  for (const provider of providers) {
    const cells = matrix.get(provider)!;
    console.log(
      `${provider.padEnd(12)} ${features
        .map((feature) => (cells[feature] ?? "—").padEnd(28))
        .join("")}`,
    );
  }

  console.log("\n(c) returned model differs from the provider model id");
  const mismatches = rows.filter((row) => {
    if (row.returned_model == null) return false;
    const provider = row["x-lmx-provider"];
    if (!provider) return false;
    const expected = expectedProviderModelId(provider, row.requested_model);
    if (!expected) return false;
    return row.returned_model !== expected;
  });
  if (mismatches.length === 0) {
    console.log("none");
  } else {
    for (const row of mismatches) {
      const provider = row["x-lmx-provider"];
      const expected = provider ? expectedProviderModelId(provider, row.requested_model) : null;
      console.log(
        `${row.check}: requested ${row.requested_model}, expected ${expected}, returned ${row.returned_model}`,
      );
    }
  }
  console.log(`\n${rows.length} rows written to ${resultsPath}`);
}

void main();
