/**
 * Production check of the qwen-3.5-35b → qwen-3.6-35b alias (PR #3).
 *
 *   LMX_TEST_API_KEY=lmx_... pnpm --filter @lmxcloud/api test:qwen35-alias
 *
 * 12 requests: streaming and non-streaming × {no preference, provider:akash, provider:ionet} × 2 runs.
 * One attempt each, no retries, max_tokens 50, starts every 2.5 s. Never prints the API key.
 * Results: apps/api/scripts/results/qwen35-alias-<timestamp>{.jsonl,-summary.md}
 * The summary is not written when any required value is missing.
 */
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { failedCapture, forwardingApiUrl, postChat, redact, sanitizeValue } from "./jason-40-chat.js";
import { PACE_MS, pacingDelay } from "./jason-40-retest.js";
import {
  ALIAS_PLANNED,
  aliasRequestBody,
  aliasRequestHeaders,
  buildAliasPlan,
  buildAliasRow,
  writeAliasSummary,
  type AliasRow,
} from "./qwen35-alias-check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.resolve(repoRoot, ".env"), override: true });

async function run(apiKey: string) {
  const plan = buildAliasPlan();
  if (plan.length !== ALIAS_PLANNED) throw new Error(`refusing to run a plan of ${plan.length} requests`);
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: repoRoot, stdio: "inherit" });
  const deployedCommit = execFileSync("git", ["rev-parse", "origin/main"], { cwd: repoRoot, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(deployedCommit)) throw new Error("origin/main did not resolve to a commit");
  const deployedCommitSource =
    "origin/main after `git fetch` at run start; not reported by production, confirm the active deployment separately";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const rawName = `qwen35-alias-${stamp}.jsonl`;
  const rawPath = path.join(resultsDir, rawName);
  const summaryPath = path.join(resultsDir, `qwen35-alias-${stamp}-summary.md`);
  const rows: AliasRow[] = [];
  const runStartMs = Date.now();

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]!;
    const params = aliasRequestBody(item);
    const wait = pacingDelay(runStartMs, index, Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const timestamp = new Date().toISOString();
    let capture;
    try {
      // One attempt. Do not retry or replace this request.
      capture = await postChat(apiKey, params, aliasRequestHeaders(item));
    } catch (err) {
      capture = failedCapture(err, "error");
    }
    const row = sanitizeValue(
      buildAliasRow({ item, timestamp, deployedCommit, requestParams: params, capture }),
      apiKey,
    ) as AliasRow;
    rows.push(row);
    fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
    console.log(
      redact(
        `${(item.preference ?? "none").padEnd(16)}stream=${String(item.stream).padEnd(6)}run ${item.run}  ${String(row.http_status ?? "-").padEnd(4)}${(row.provider ?? "-").padEnd(8)}${row.returned_model ?? "-"}  ${row.pass ? "pass" : "fail"}  ${row.reason}`,
        apiKey,
      ),
    );
  }

  const summary = writeAliasSummary(summaryPath, rows, {
    resultsFile: rawName,
    endpoint: forwardingApiUrl(),
    deployedCommitSource,
    paceMs: PACE_MS,
  });
  console.log(`\n${rows.length} rows written to ${rawPath}`);
  console.log(`deployed commit ${deployedCommit} (origin/main; confirm in Railway)`);
  if (!summary.written) {
    console.error(`refusing to write summary: ${summary.problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`summary written to ${summaryPath}`);
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}

const apiKey = process.env.LMX_TEST_API_KEY?.trim();
if (!apiKey) {
  console.error("LMX_TEST_API_KEY is not set.");
  process.exit(1);
}
run(apiKey).catch((err: unknown) => {
  console.error(redact(err instanceof Error ? err.message : String(err), apiKey));
  process.exit(1);
});
