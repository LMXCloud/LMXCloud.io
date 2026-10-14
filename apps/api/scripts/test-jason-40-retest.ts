/**
 * Controlled retest for the external benchmark.
 *
 *   LMX_TEST_API_KEY=lmx_... pnpm test:jason-40
 *   API_URL=https://api.lmxcloud.io pnpm --filter @lmxcloud/api test:jason-40
 *
 * 40 requests, one attempt each, no retries, max_tokens 400. Request starts are scheduled
 * every 2.5 s (24/min); the summary reports the rate actually achieved from recorded start times.
 * Does not send a provider preference or reasoning overrides. Never prints the API key.
 * Results: apps/api/scripts/results/jason-40-retest-<timestamp>.jsonl
 *          apps/api/scripts/results/jason-40-retest-<timestamp>-sanitized.jsonl
 *          apps/api/scripts/results/jason-40-retest-<timestamp>-summary.md
 *
 * The summary is not written when any required field is missing.
 */
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  failedCapture,
  forwardingApiUrl,
  forwardingTimeoutMs,
  postChat,
  redact,
  sanitizeValue,
} from "./jason-40-chat.js";
import {
  PACE_MS,
  PLANNED_REQUESTS,
  buildPlan,
  pacingDelay,
  pacingStats,
  buildRow,
  requestBody,
  writeSummaryFile,
  type RetestRow,
} from "./jason-40-retest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.resolve(repoRoot, ".env"), override: true });

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
  const deployedCommit = readDeployedCommit();
  const deployedCommitSource =
    "origin/main after `git fetch` at run start; not reported by production, confirm the active deployment separately";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const rawName = `jason-40-retest-${stamp}.jsonl`;
  const rawPath = path.join(resultsDir, rawName);
  const sanitizedPath = path.join(resultsDir, `jason-40-retest-${stamp}-sanitized.jsonl`);
  const summaryPath = path.join(resultsDir, `jason-40-retest-${stamp}-summary.md`);
  const rows: RetestRow[] = [];
  const runStartMs = Date.now();

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]!;
    const params = requestBody(item);
    // Schedule starts, not gaps after responses, so slow responses don't lower the rate.
    const wait = pacingDelay(runStartMs, index, Date.now());
    if (wait > 0) await sleep(wait);
    const timestamp = new Date().toISOString();
    let capture;
    try {
      // One attempt. Do not retry or replace this request.
      capture = await postChat(apiKey, params);
    } catch (err) {
      capture = failedCapture(err, item.mode === "streaming" ? "error" : "error");
    }
    const row = sanitizeValue(
      buildRow({
        item,
        timestamp,
        deployedCommit,
        providerPreference: null,
        requestParams: params,
        capture,
      }),
      apiKey,
    ) as RetestRow;
    rows.push(row);
    fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
    console.log(redact(summaryLine(row), apiKey));
  }

  fs.writeFileSync(sanitizedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const summary = writeSummaryFile(summaryPath, rows, {
    resultsFile: rawName,
    endpoint: forwardingApiUrl(),
    paceMs: PACE_MS,
    deployedCommitSource,
  });
  const pacing = pacingStats(rows);
  console.log(`\n${rows.length} rows written to ${rawPath}`);
  console.log(`sanitized rows written to ${sanitizedPath}`);
  console.log(
    `target: a start every ${PACE_MS}ms; achieved ${pacing.achievedPerMinute.toFixed(1)}/min, ${pacing.overruns} late starts; timeout ${forwardingTimeoutMs()}ms; one attempt each`,
  );
  console.log(`deployed commit ${deployedCommit}`);
  if (!summary.written) {
    console.error(`refusing to write summary: ${summary.problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`summary written to ${summaryPath}`);
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}

function readDeployedCommit(): string {
  // Refresh origin/main first; a stale local ref would record the wrong commit.
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: repoRoot, stdio: "inherit" });
  const sha = execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("origin/main did not resolve to a commit");
  return sha;
}

function summaryLine(row: RetestRow): string {
  return `${row.requested_model.padEnd(16)}${row.mode.padEnd(14)}${String(row.run).padEnd(4)}${(row["x-lmx-provider"] ?? "-").padEnd(10)}${String(row.http_status ?? "-").padEnd(6)}${row.pass ? "pass" : "fail"}  ${row.reason}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
