/**
 * Jason gate 3: reconcile every charge against published per-model rates and
 * the usage ledger.
 *
 * Live (production, your key, no cost to anyone else):
 *   LMX_TEST_API_KEY=lmx_... pnpm --filter @lmxcloud/api test:pricing
 *   (PowerShell: $env:LMX_TEST_API_KEY="lmx_..."; pnpm --filter @lmxcloud/api test:pricing)
 *   8 requests: llama-3.3-70b and qwen-3.6-35b, non-streaming and streaming,
 *   2 runs each, max_tokens 16. For each request it recomputes the cost from
 *   the token counts and the rates published on GET /v1/pricing (it does not
 *   reuse the router's code), then checks that number against x-lmx-cost /
 *   lmx.meta.cost, lmx.usage.cost, the ledger row on GET /v1/usage/logs, and
 *   the balance change. Then it checks the total the same way.
 *
 * Past records (offline, no requests):
 *   pnpm --filter @lmxcloud/api test:pricing --records scripts/results/<file>.jsonl
 *   Checks each charge against the rule that was live then (total_tokens x
 *   $0.20 per 1M, the old flat rate) and the balance chain, then shows what
 *   the same usage costs at the current published rates.
 *
 * Records only usage, cost and ids, never prompts or completions.
 * Results: apps/api/scripts/results/pricing-reconciliation-<timestamp>.{jsonl,md}
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPriceBook, PRICING_VERSION, priceRequest } from "../src/pricing/rate-card.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

const API_URL = (process.env.API_URL ?? "https://api.lmxcloud.io").replace(/\/$/, "");
const OUT_DIR = path.resolve(__dirname, "results");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
/** Two USD amounts rounded to 8 dp match when they differ by less than half a unit. */
const EPS = 5e-9;
const round8 = (x: number) => Math.round(x * 1e8) / 1e8;
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toFixed(8));

type Json = Record<string, unknown>;

function write(name: string, rows: Json[], summary: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, `pricing-reconciliation-${name}-${STAMP}`);
  fs.writeFileSync(`${base}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(`${base}.md`, summary);
  console.log(summary);
  console.log(`\nWrote ${base}.jsonl and .md`);
}

// ---------------------------------------------------------------- records mode

function recordsMode(file: string) {
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const records = lines.map((l) => JSON.parse(l) as Json).sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp)),
  );
  const LEGACY_PER_1M = 0.2;
  const book = createPriceBook();
  const rows: Json[] = [];
  let prevBalance: number | null = null;

  for (const r of records) {
    const headers = (r.response_headers ?? {}) as Json;
    const params = r.request_params as Json;
    const model = String(params.model);
    const stream = params.stream === true;
    let charged: number | null = null;
    let balance: number | null = null;
    if (stream) {
      const frames = (r.sse_frames ?? []) as string[];
      const metaFrame = frames.find((f) => f.startsWith("event: lmx.meta"));
      if (metaFrame) {
        const meta = JSON.parse(metaFrame.split("\n")[1]!.slice("data: ".length)) as Json;
        charged = Number(meta.cost);
        balance = Number(meta.balance);
      }
    } else {
      charged = headers["x-lmx-cost"] !== undefined ? Number(headers["x-lmx-cost"]) : null;
      balance = headers["x-lmx-balance"] !== undefined ? Number(headers["x-lmx-balance"]) : null;
    }
    const usage = (r.usage ?? {}) as Json;
    const prompt = Number(usage.prompt_tokens);
    const completion = Number(usage.completion_tokens);
    const total = Number(usage.total_tokens);
    const cached = Number((usage.prompt_tokens_details as Json | undefined)?.cached_tokens ?? 0);

    const legacy = round8((total * LEGACY_PER_1M) / 1e6);
    const legacyMatch = charged !== null && Math.abs(charged - legacy) < EPS;
    const balanceMatch =
      prevBalance === null || balance === null || charged === null
        ? null
        : Math.abs(prevBalance - charged - balance) < EPS;
    if (balance !== null) prevBalance = balance;

    const price = book.priceFor(model);
    const current = price
      ? priceRequest(price, {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: total,
          cached_prompt_tokens: cached,
        }).amount
      : null;

    rows.push({
      request_id: r.request_id,
      timestamp: r.timestamp,
      model,
      mode: r.mode,
      usage_id: headers["x-lmx-usage-id"] ?? null,
      prompt_tokens: prompt,
      cached_prompt_tokens: cached,
      completion_tokens: completion,
      total_tokens: total,
      charged,
      legacy_expected: legacy,
      legacy_match: legacyMatch,
      balance_after: balance,
      balance_chain_match: balanceMatch,
      current_price_cost: current,
      current_pricing_version: PRICING_VERSION,
    });
  }

  const n = rows.length;
  const legacyOk = rows.filter((r) => r.legacy_match).length;
  const chain = rows.filter((r) => r.balance_chain_match !== null);
  const chainOk = chain.filter((r) => r.balance_chain_match).length;
  const byModel = new Map<string, { charged: number; current: number; prompt: number; completion: number; n: number }>();
  for (const r of rows) {
    const m = byModel.get(String(r.model)) ?? { charged: 0, current: 0, prompt: 0, completion: 0, n: 0 };
    m.charged += Number(r.charged ?? 0);
    m.current += Number(r.current_price_cost ?? 0);
    m.prompt += Number(r.prompt_tokens);
    m.completion += Number(r.completion_tokens);
    m.n += 1;
    byModel.set(String(r.model), m);
  }
  const totalCharged = round8([...byModel.values()].reduce((s, m) => s + m.charged, 0));
  const totalCurrent = round8([...byModel.values()].reduce((s, m) => s + m.current, 0));

  const md = [
    `# Pricing reconciliation: past records`,
    ``,
    `Source: ${path.basename(file)} (${n} records)`,
    `Rule live at the time: cost = total_tokens x $0.20 per 1M, rounded to 8 dp, one rate for every model.`,
    `Current published rates: pricing version ${PRICING_VERSION}.`,
    ``,
    `- Charges matching the old rule: ${legacyOk}/${n}`,
    `- Balance chain (previous balance - charge = next balance): ${chainOk}/${chain.length} consecutive pairs`,
    ``,
    `| Model | Requests | Prompt tok | Completion tok | Charged (old flat) | Same usage at ${PRICING_VERSION} |`,
    `|---|---|---|---|---|---|`,
    ...[...byModel.entries()].map(
      ([model, m]) =>
        `| ${model} | ${m.n} | ${m.prompt} | ${m.completion} | $${fmt(round8(m.charged))} | $${fmt(round8(m.current))} |`,
    ),
    `| **Total** | ${n} | | | **$${fmt(totalCharged)}** | **$${fmt(totalCurrent)}** |`,
    ``,
  ].join("\n");
  write("records", rows, md);
  process.exit(legacyOk === n && chainOk === chain.length ? 0 : 1);
}

// ------------------------------------------------------------------- live mode

async function getJson(url: string, key?: string): Promise<Json> {
  const res = await fetch(url, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Json;
}

interface Rates {
  input_per_1m: number;
  cached_input_per_1m: number;
  output_per_1m: number;
}

async function liveMode() {
  const KEY = process.env.LMX_TEST_API_KEY;
  if (!KEY) {
    console.error("Set LMX_TEST_API_KEY first.");
    process.exit(2);
  }
  const MODELS = ["llama-3.3-70b", "qwen-3.6-35b"];
  const RUNS = 2;

  const pricing = await getJson(`${API_URL}/v1/pricing`);
  const version = String(pricing.pricing_version);
  const published = new Map(
    ((pricing.models ?? []) as Array<Json & Rates>).map((m) => [String(m.id), m]),
  );
  const startBalance = Number((await getJson(`${API_URL}/v1/balance`, KEY)).balance);

  const rows: Json[] = [];
  let prevBalance = startBalance;

  for (let run = 1; run <= RUNS; run++) {
    for (const model of MODELS) {
      for (const stream of [false, true]) {
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
        let usage: Json | null = null;
        let charged: number | null = null;
        let balance: number | null = null;
        let usageId: string | null = null;
        let providerRequestId: string | null = res.headers.get("x-lmx-provider-request-id");
        if (stream) {
          const frame = text.split("\n\n").find((f) => f.startsWith("event: lmx.meta"));
          if (frame) {
            const meta = JSON.parse(frame.split("\n")[1]!.slice("data: ".length)) as Json;
            usage = (meta.lmx_usage as Json) ?? null;
            charged = Number(meta.cost);
            balance = Number(meta.balance);
            usageId = (meta.usage_id as string) ?? null;
            providerRequestId = (meta.provider_request_id as string) ?? providerRequestId;
          }
        } else {
          const header = res.headers.get("x-lmx-usage");
          usage = header ? (JSON.parse(header) as Json) : null;
          charged = res.headers.has("x-lmx-cost") ? Number(res.headers.get("x-lmx-cost")) : null;
          balance = res.headers.has("x-lmx-balance") ? Number(res.headers.get("x-lmx-balance")) : null;
          usageId = res.headers.get("x-lmx-usage-id");
        }

        const problems: string[] = [];
        if (!res.ok) problems.push(`http ${res.status}`);
        const rates = published.get(model);
        if (!rates) problems.push("model not on /v1/pricing");
        const prompt = Number(usage?.prompt_tokens);
        const completion = Number(usage?.completion_tokens);
        const cached = Number(usage?.cached_prompt_tokens ?? 0);
        // Independent recomputation from the published rates.
        const expected = rates
          ? round8(
              ((prompt - cached) * rates.input_per_1m +
                cached * rates.cached_input_per_1m +
                completion * rates.output_per_1m) /
                1e6,
            )
          : null;
        const usageCost = (usage?.cost as Json | null)?.amount_usd as number | undefined;
        const usageVersion = (usage?.cost as Json | null)?.pricing_version;

        if (expected === null || charged === null || Math.abs(charged - expected) > EPS)
          problems.push(`charged ${fmt(charged)} != usage x published rate ${fmt(expected)}`);
        if (usageCost === undefined || Math.abs(usageCost - (expected ?? NaN)) > EPS)
          problems.push(`lmx.usage.cost ${fmt(usageCost)} != ${fmt(expected)}`);
        if (usageVersion !== version) problems.push(`pricing_version ${String(usageVersion)} != ${version}`);
        if (res.headers.get("x-lmx-pricing-version") !== version) problems.push("x-lmx-pricing-version header missing or different");
        if (balance === null || charged === null || Math.abs(prevBalance - charged - balance) > EPS)
          problems.push(`balance ${fmt(prevBalance)} - ${fmt(charged)} != ${fmt(balance)}`);
        if (balance !== null) prevBalance = balance;
        if (!usageId) problems.push("no usage id on the response");

        rows.push({
          started,
          model,
          mode: stream ? "stream" : "non-stream",
          status: res.status,
          provider: res.headers.get("x-lmx-provider"),
          usage_id: usageId,
          provider_request_id: providerRequestId,
          provider_request_id_header: res.headers.get("x-lmx-provider-request-id-header"),
          prompt_tokens: prompt,
          cached_prompt_tokens: cached,
          completion_tokens: completion,
          rates_per_1m: rates
            ? { input: rates.input_per_1m, cached_input: rates.cached_input_per_1m, output: rates.output_per_1m }
            : null,
          expected,
          charged,
          lmx_usage_cost: usageCost ?? null,
          balance_after: balance,
          problems,
        });
      }
    }
  }

  // Ledger: every request's row, by usage id.
  const logs = (await getJson(`${API_URL}/v1/usage/logs?limit=100&days=1`, KEY)).data as Json[];
  const byId = new Map(logs.map((l) => [String(l.id), l]));
  for (const row of rows) {
    const entry = row.usage_id ? byId.get(String(row.usage_id)) : undefined;
    const problems = row.problems as string[];
    if (!entry) {
      problems.push("no ledger row for usage id");
      continue;
    }
    row.ledger = {
      cost: Number(entry.cost),
      prompt_tokens: entry.prompt_tokens,
      completion_tokens: entry.completion_tokens,
      cached_prompt_tokens: entry.cached_prompt_tokens,
      pricing_version: entry.pricing_version,
      provider: entry.provider,
      provider_request_id: entry.provider_request_id,
    };
    if (Math.abs(Number(entry.cost) - Number(row.expected)) > EPS) problems.push(`ledger cost ${entry.cost} != ${fmt(row.expected as number)}`);
    if (entry.prompt_tokens !== row.prompt_tokens || entry.completion_tokens !== row.completion_tokens)
      problems.push("ledger token counts differ from the response");
    if (entry.pricing_version !== version) problems.push(`ledger pricing_version ${String(entry.pricing_version)}`);
    if (entry.provider !== row.provider) problems.push("ledger provider differs");
    if ((entry.provider_request_id ?? null) !== (row.provider_request_id ?? null))
      problems.push("ledger provider_request_id differs from the response");
  }

  const endBalance = Number((await getJson(`${API_URL}/v1/balance`, KEY)).balance);
  const totalExpected = round8(rows.reduce((s, r) => s + Number(r.expected ?? 0), 0));
  const totalCharged = round8(rows.reduce((s, r) => s + Number(r.charged ?? 0), 0));
  const totalLedger = round8(rows.reduce((s, r) => s + Number((r.ledger as Json | undefined)?.cost ?? 0), 0));
  const balanceDrop = round8(startBalance - endBalance);
  const totalProblems: string[] = [];
  if (Math.abs(totalCharged - totalExpected) > EPS * rows.length) totalProblems.push("total charged != total expected");
  if (Math.abs(totalLedger - totalExpected) > EPS * rows.length) totalProblems.push("ledger total != total expected");
  if (Math.abs(balanceDrop - totalCharged) > EPS * rows.length) totalProblems.push("balance drop != total charged");

  const failed = rows.filter((r) => (r.problems as string[]).length > 0);
  const md = [
    `# Pricing reconciliation: production`,
    ``,
    `API: ${API_URL} · pricing version ${version} (effective ${String(pricing.effective_from)}) · ${rows.length} requests · ${STAMP}`,
    `Each cost recomputed from the response's token counts x the rates on GET /v1/pricing, then compared with the charge, lmx.usage.cost, the ledger row and the balance change.`,
    ``,
    `| Model | Mode | Provider | Prompt / cached / completion | Expected | Charged | Ledger | Provider request id | Result |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => {
      const ledger = r.ledger as Json | undefined;
      const problems = r.problems as string[];
      return `| ${r.model} | ${r.mode} | ${r.provider} | ${r.prompt_tokens} / ${r.cached_prompt_tokens} / ${r.completion_tokens} | ${fmt(r.expected as number)} | ${fmt(r.charged as number)} | ${fmt(ledger ? Number(ledger.cost) : null)} | ${r.provider_request_id ?? "-"} | ${problems.length ? "FAIL: " + problems.join("; ") : "match"} |`;
    }),
    ``,
    `Totals: expected $${fmt(totalExpected)} · charged $${fmt(totalCharged)} · ledger $${fmt(totalLedger)} · balance ${fmt(startBalance)} -> ${fmt(endBalance)} (drop $${fmt(balanceDrop)})${totalProblems.length ? " · FAIL: " + totalProblems.join("; ") : " · all match"}`,
    ``,
    `Mismatches: ${failed.length + (totalProblems.length ? 1 : 0)}`,
    ``,
  ].join("\n");
  write("live", rows, md);
  process.exit(failed.length === 0 && totalProblems.length === 0 ? 0 : 1);
}

const recordsIdx = process.argv.indexOf("--records");
if (recordsIdx >= 0) {
  const file = process.argv[recordsIdx + 1];
  if (!file) {
    console.error("--records needs a .jsonl path");
    process.exit(2);
  }
  recordsMode(path.resolve(process.cwd(), file));
} else {
  await liveMode();
}
