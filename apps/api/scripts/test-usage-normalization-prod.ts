/**
 * Production check for Jason Gate 2 (usage normalization, lmx.usage/1).
 *
 *   LMX_TEST_API_KEY=lmx_... pnpm test:usage
 *   (PowerShell: $env:LMX_TEST_API_KEY="lmx_..."; pnpm test:usage)
 *
 * 4 requests: llama-3.3-70b and qwen-3.6-35b, each non-streaming and streaming,
 * max_tokens 16, thinking off. Reads the key from LMX_TEST_API_KEY and never
 * prints it. Records only usage/cost metadata, never prompts or completions.
 *
 * Passes when every response carries an lmx.usage/1 object (x-lmx-usage
 * header on non-streaming, lmx.meta.lmx_usage on streams) with the same keys
 * on both paths, and no count is 0 while the provider failed to report it.
 * Results: apps/api/scripts/results/usage-normalization-<timestamp>.jsonl
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const API_URL = (process.env.API_URL ?? "https://api.lmxcloud.io").replace(/\/$/, "");
const KEY = process.env.LMX_TEST_API_KEY;
if (!KEY) {
  console.error("Set LMX_TEST_API_KEY first.");
  process.exit(2);
}

const MODELS = ["llama-3.3-70b", "qwen-3.6-35b"] as const;
const EXPECTED_KEYS = [
  "cached_prompt_tokens",
  "completion_tokens",
  "cost_basis",
  "derived",
  "prompt_tokens",
  "reasoning_tokens",
  "schema",
  "source",
  "total_tokens",
  "unavailable",
].join(",");

type Usage = Record<string, unknown> & { unavailable?: string[] };

function check(usage: Usage | null): string[] {
  if (!usage) return ["no lmx.usage object"];
  const problems: string[] = [];
  if (usage.schema !== "lmx.usage/1") problems.push(`schema=${String(usage.schema)}`);
  if (Object.keys(usage).sort().join(",") !== EXPECTED_KEYS) problems.push("unexpected key set");
  for (const field of usage.unavailable ?? []) {
    if (usage[field] !== null) problems.push(`${field} listed unavailable but not null`);
  }
  return problems;
}

async function call(model: string, stream: boolean) {
  const started = new Date().toISOString();
  const res = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 16,
      ...(stream ? { stream: true } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let usage: Usage | null = null;
  let cost: string | number | null = null;
  if (stream) {
    const frame = text.split("\n\n").find((f) => f.startsWith("event: lmx.meta"));
    if (frame) {
      const meta = JSON.parse(frame.split("\n")[1]!.slice("data: ".length)) as Record<string, unknown>;
      usage = (meta.lmx_usage as Usage) ?? null;
      cost = (meta.cost as number) ?? null;
    }
  } else {
    const header = res.headers.get("x-lmx-usage");
    usage = header ? (JSON.parse(header) as Usage) : null;
    cost = res.headers.get("x-lmx-cost");
  }
  return {
    started,
    model,
    mode: stream ? "stream" : "non-stream",
    status: res.status,
    request_id: res.headers.get("x-lmx-usage-id"),
    provider: res.headers.get("x-lmx-provider"),
    cost,
    lmx_usage: usage,
    problems: res.ok ? check(usage) : [`http ${res.status}`],
  };
}

const rows = [];
for (const model of MODELS) {
  for (const stream of [false, true]) rows.push(await call(model, stream));
}

const outDir = path.resolve(__dirname, "results");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `usage-normalization-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

for (const r of rows) {
  const u = r.lmx_usage;
  console.log(
    [r.model.padEnd(14), r.mode.padEnd(10), String(r.status), `src=${u?.source}`,
      `p/c/t=${u?.prompt_tokens}/${u?.completion_tokens}/${u?.total_tokens}`,
      `unavail=${(u?.unavailable ?? []).join("|") || "-"}`, `cost=${r.cost}`,
      r.problems.length ? `FAIL: ${r.problems.join("; ")}` : "PASS"].join("  "),
  );
}
console.log(`\nWrote ${file}`);
process.exit(rows.every((r) => r.problems.length === 0) ? 0 : 1);
