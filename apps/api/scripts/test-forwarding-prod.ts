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
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedProviderModelId } from "../src/providers/model-maps.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const API_URL = (process.env.API_URL ?? "https://api.lmxcloud.io").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.FORWARDING_TEST_TIMEOUT_MS ?? 120_000);
const MAX_REQUESTS = 30;

const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const WEATHER_USER = {
  role: "user",
  content: "What is the weather in Paris right now? Call the get_weather tool.",
};

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

type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

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

type ChatResult = {
  httpStatus: number | null;
  provider: string | null;
  fallback: string | null;
  latencyHeader: string | null;
  costHeader: string | null;
  returnedModel: string | null;
  finishReason: string | null;
  contentText: string;
  toolCalls: ToolCall[];
  usage: unknown;
  clientLatencyMs: number;
  ttftMs: number | null;
  errorMessage: string | null;
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
  const response = await fetch(`${API_URL}/v1/models`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

async function postChat(
  apiKey: string,
  body: Record<string, unknown>,
  prefer?: string,
): Promise<ChatResult> {
  const started = performance.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["x-lmx-prefer"] = `provider:${prefer}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return emptyResult(Math.round(performance.now() - started), err);
  }

  const provider = response.headers.get("x-lmx-provider");
  const fallback = response.headers.get("x-lmx-fallback");
  const latencyHeader = response.headers.get("x-lmx-latency");
  const costHeader = response.headers.get("x-lmx-cost");
  const streaming = body.stream === true;

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ...blankChat(Math.round(performance.now() - started)),
      httpStatus: response.status,
      provider,
      fallback,
      latencyHeader,
      costHeader,
      errorMessage: errorMessage(errorText) ?? `HTTP ${response.status}`,
    };
  }

  if (streaming) {
    const parsed = await readSse(response, started);
    return {
      ...parsed,
      provider,
      fallback,
      latencyHeader,
      costHeader,
      clientLatencyMs: Math.round(performance.now() - started),
    };
  }

  const json = (await response.json()) as Record<string, unknown>;
  const choice = firstChoice(json);
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const toolCalls = readToolCalls(message?.tool_calls);
  const contentText = textFromContent(message?.content);
  return {
    httpStatus: response.status,
    provider,
    fallback,
    latencyHeader,
    costHeader,
    returnedModel: typeof json.model === "string" ? json.model : null,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    contentText,
    toolCalls,
    usage: json.usage ?? null,
    clientLatencyMs: Math.round(performance.now() - started),
    ttftMs: null,
    errorMessage: null,
  };
}

async function readSse(response: Response, started: number): Promise<Omit<ChatResult, "provider" | "fallback" | "latencyHeader" | "costHeader" | "clientLatencyMs">> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ...blankChat(0),
      httpStatus: response.status,
      errorMessage: "empty stream body",
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let ttftMs: number | null = null;
  let returnedModel: string | null = null;
  let finishReason: string | null = null;
  let usage: unknown = null;
  let contentText = "";
  const slots = new Map<number, { id?: string; name: string; arguments: string; type?: string }>();

  const consume = (frame: string) => {
    const data = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .find((line) => line.length > 0);
    if (!data || data === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.usage && typeof parsed.usage === "object") usage = parsed.usage;
    if (typeof parsed.model === "string") returnedModel = parsed.model;
    const choice = firstChoice(parsed);
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : undefined;
    if (!delta) return;
    if (ttftMs === null && (delta.content != null || delta.tool_calls != null || delta.role != null)) {
      ttftMs = Math.round(performance.now() - started);
    }
    contentText += textFromContent(delta.content);
    absorbToolDeltas(slots, delta.tool_calls);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);

  const toolCalls: ToolCall[] = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot]) => ({
      id: slot.id,
      type: slot.type ?? "function",
      function: { name: slot.name, arguments: slot.arguments },
    }));

  return {
    httpStatus: response.status,
    returnedModel,
    finishReason,
    contentText,
    toolCalls,
    usage,
    ttftMs,
    errorMessage: null,
  };
}

function absorbToolDeltas(slots: Map<number, { id?: string; name: string; arguments: string; type?: string }>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const index = typeof raw.index === "number" ? raw.index : 0;
    const slot = slots.get(index) ?? { name: "", arguments: "" };
    if (typeof raw.id === "string" && raw.id) slot.id = raw.id;
    if (typeof raw.type === "string" && raw.type) slot.type = raw.type;
    const fn = isRecord(raw.function) ? raw.function : undefined;
    if (typeof fn?.name === "string") slot.name += fn.name;
    if (typeof fn?.arguments === "string") slot.arguments += fn.arguments;
    slots.set(index, slot);
  }
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

function firstChoice(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body || !Array.isArray(body.choices)) return undefined;
  const choice = body.choices[0];
  return isRecord(choice) ? choice : undefined;
}

function readToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as ToolCall[];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function errorMessage(text: string): string | null {
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    const message = json.error?.message ?? json.message;
    if (typeof message === "string" && message.trim()) return clip(message);
  } catch {
    /* plain text */
  }
  const trimmed = text.trim();
  return trimmed ? clip(trimmed) : null;
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blankChat(clientLatencyMs: number): ChatResult {
  return {
    httpStatus: null,
    provider: null,
    fallback: null,
    latencyHeader: null,
    costHeader: null,
    returnedModel: null,
    finishReason: null,
    contentText: "",
    toolCalls: [],
    usage: null,
    clientLatencyMs,
    ttftMs: null,
    errorMessage: null,
  };
}

function emptyResult(clientLatencyMs: number, err: unknown): ChatResult {
  const message = err instanceof Error ? err.message : String(err);
  return { ...blankChat(clientLatencyMs), errorMessage: clip(message) };
}

void main();
