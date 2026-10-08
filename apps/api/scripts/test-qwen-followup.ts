/**
 * Qwen follow-up evidence for the external benchmark.
 *
 *   LMX_TEST_API_KEY=lmx_... pnpm test:qwen-followup
 *   API_URL=https://api.lmxcloud.io pnpm --filter @lmxcloud/api test:qwen-followup
 *
 * 20 requests, one attempt each, no retries, max_tokens 400, about 24/min.
 * Does not send reasoning overrides. Never prints the API key.
 * Results: apps/api/scripts/results/qwen-followup-<timestamp>.jsonl
 *
 * Blocks:
 *   A  qwen-3.5-35b  akash  plain streaming x5
 *   B  qwen-3.5-35b  akash  tool call x5
 *   C  qwen-3.6-35b  ionet  tool call x5
 *   D  qwen-3.5-35b  akash  plain non-streaming x5
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEATHER_TOOL,
  WEATHER_USER,
  failedChat,
  forwardingTimeoutMs,
  postChat,
  redact,
  type ChatResult,
} from "./forwarding-chat.js";
import {
  describeToolCalls,
  judgeQwenFollowup,
  type FollowupBlock,
} from "./qwen-followup-judge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const MAX_TOKENS = 400;
const RUNS_PER_BLOCK = 5;
const PACE_MS = 60_000 / 24;
const PLANNED_REQUESTS = 20;

const PLAIN_USER = {
  role: "user",
  content: "Reply with the single word ok.",
};

type PlanItem = {
  block: FollowupBlock;
  run: number;
  model: string;
  prefer: string;
  stream: boolean;
  tool: boolean;
};

type FollowupRow = {
  block: FollowupBlock;
  run: number;
  timestamp: string;
  preferred_provider: string;
  request_body: Record<string, unknown>;
  max_tokens: number;
  http_status: number | null;
  "x-lmx-provider": string | null;
  "x-lmx-fallback": string | null;
  finish_reason: string | null;
  models: string[];
  expected_model: string | null;
  response_json: unknown | null;
  sse_frames: string[] | null;
  tool_call_name: string | null;
  tool_arguments_json: boolean;
  tool_arguments_has_city: boolean;
  usage: unknown;
  verdict: string;
  reason: string;
  akash_path: boolean;
  tool_pass: boolean;
};

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
  const plan = buildPlan();
  if (plan.length !== PLANNED_REQUESTS) {
    throw new Error(`refusing to run a plan of ${plan.length} requests`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const resultsPath = path.join(resultsDir, `qwen-followup-${stamp}.jsonl`);
  const rows: FollowupRow[] = [];

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]!;
    const body = requestBody(item);
    const requestBodySafe = sanitizeBody(body, apiKey);
    const timestamp = new Date().toISOString();
    let result: ChatResult;
    try {
      result = await postChat(apiKey, body, item.prefer);
    } catch (err) {
      result = failedChat(0, err);
    }
    const row = toRow(item, timestamp, requestBodySafe, result);
    rows.push(row);
    fs.appendFileSync(resultsPath, `${redact(JSON.stringify(row), apiKey)}\n`);
    console.log(redact(summaryLine(row), apiKey));
    if (index < plan.length - 1) await sleep(PACE_MS);
  }

  printReport(rows, resultsPath);
  const aethir = rows.some((row) => row["x-lmx-provider"]?.toLowerCase() === "aethir");
  if (aethir || rows.some((row) => row.verdict !== "pass")) process.exitCode = 1;
}

function buildPlan(): PlanItem[] {
  const blocks: Array<Omit<PlanItem, "run">> = [
    { block: "A", model: "qwen-3.5-35b", prefer: "akash", stream: true, tool: false },
    { block: "B", model: "qwen-3.5-35b", prefer: "akash", stream: false, tool: true },
    { block: "C", model: "qwen-3.6-35b", prefer: "ionet", stream: false, tool: true },
    { block: "D", model: "qwen-3.5-35b", prefer: "akash", stream: false, tool: false },
  ];
  const plan: PlanItem[] = [];
  for (const block of blocks) {
    for (let run = 1; run <= RUNS_PER_BLOCK; run += 1) {
      plan.push({ ...block, run });
    }
  }
  return plan;
}

function requestBody(item: PlanItem): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: item.model,
    messages: [item.tool ? WEATHER_USER : PLAIN_USER],
    max_tokens: MAX_TOKENS,
    stream: item.stream,
  };
  if (item.tool) {
    body.tools = [WEATHER_TOOL];
    body.tool_choice = "auto";
  }
  return body;
}

function toRow(
  item: PlanItem,
  timestamp: string,
  requestBodySafe: Record<string, unknown>,
  result: ChatResult,
): FollowupRow {
  const tool = describeToolCalls(result.toolCalls);
  const streamed = item.stream && result.sseFrames != null;
  const judged = judgeQwenFollowup({
    block: item.block,
    preferredProvider: item.prefer,
    requestedModel: item.model,
    httpStatus: result.httpStatus,
    provider: result.provider,
    fallback: result.fallback,
    finishReason: result.finishReason,
    models: result.modelsSeen,
    errorMessage: result.errorMessage,
    tool,
  });
  return {
    block: item.block,
    run: item.run,
    timestamp,
    preferred_provider: item.prefer,
    request_body: requestBodySafe,
    max_tokens: MAX_TOKENS,
    http_status: result.httpStatus,
    "x-lmx-provider": result.provider,
    "x-lmx-fallback": result.fallback,
    finish_reason: result.finishReason,
    models: result.modelsSeen,
    expected_model: judged.expected_model,
    response_json: streamed ? null : result.responseBody,
    sse_frames: streamed ? result.sseFrames : null,
    tool_call_name: tool.tool_call_name,
    tool_arguments_json: tool.tool_arguments_json,
    tool_arguments_has_city: tool.tool_arguments_has_city,
    usage: result.usage ?? null,
    verdict: judged.verdict,
    reason: judged.reason,
    akash_path: judged.akash_path,
    tool_pass: judged.tool_pass,
  };
}

function printReport(rows: FollowupRow[], resultsPath: string) {
  const aethirRows = rows.filter((row) => row["x-lmx-provider"]?.toLowerCase() === "aethir");
  if (aethirRows.length > 0) {
    console.log("\n======== AETHIR PROVIDER IN RESULTS ========");
    for (const row of aethirRows) {
      console.log(
        `AETHIR block ${row.block} run ${row.run} fallback=${row["x-lmx-fallback"] ?? "-"} models=${row.models.join(" | ") || "-"}`,
      );
    }
    console.log("======== AETHIR PROVIDER IN RESULTS ========\n");
  }

  console.log(
    `${"block".padEnd(6)}${"run".padEnd(5)}${"provider".padEnd(12)}${"fallback".padEnd(10)}${"models".padEnd(42)}${"finish_reason".padEnd(16)}verdict`,
  );
  for (const row of rows) {
    console.log(summaryLine(row));
  }

  console.log(
    `\n${"block".padEnd(6)}${"n".padEnd(4)}${"pass".padEnd(6)}${"akash_path".padEnd(12)}${"fallback".padEnd(10)}${"mismatch".padEnd(10)}${"tool_pass".padEnd(11)}${"fail".padEnd(6)}aethir`,
  );
  for (const block of ["A", "B", "C", "D"] as const) {
    const items = rows.filter((row) => row.block === block);
    const tagsOf = (row: FollowupRow) => (row.verdict === "pass" ? [] : row.verdict.split("+"));
    const count = (tag: string) => items.filter((row) => tagsOf(row).includes(tag)).length;
    const toolCell = block === "B" || block === "C" ? String(items.filter((row) => row.tool_pass).length) : "—";
    console.log(
      `${block.padEnd(6)}${String(items.length).padEnd(4)}${String(items.filter((row) => row.verdict === "pass").length).padEnd(6)}${String(items.filter((row) => row.akash_path).length).padEnd(12)}${String(count("fallback")).padEnd(10)}${String(count("mismatch")).padEnd(10)}${toolCell.padEnd(11)}${String(count("fail")).padEnd(6)}${String(items.filter((row) => row["x-lmx-provider"]?.toLowerCase() === "aethir").length)}`,
    );
  }

  console.log(`\n${rows.length} rows written to ${resultsPath}`);
  console.log(`pace ${PACE_MS}ms between requests; timeout ${forwardingTimeoutMs()}ms; one attempt each`);
}

function summaryLine(row: FollowupRow): string {
  return `${row.block.padEnd(6)}${String(row.run).padEnd(5)}${(row["x-lmx-provider"] ?? "-").padEnd(12)}${(row["x-lmx-fallback"] ?? "-").padEnd(10)}${(row.models.join(" | ") || "-").padEnd(42)}${(row.finish_reason ?? "-").padEnd(16)}${row.verdict}`;
}

function sanitizeBody(body: Record<string, unknown>, secret: string): Record<string, unknown> {
  const parsed = JSON.parse(redact(JSON.stringify(body), secret)) as Record<string, unknown>;
  delete parsed.authorization;
  delete parsed.Authorization;
  delete parsed.api_key;
  delete parsed.apiKey;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
