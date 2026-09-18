#!/usr/bin/env node
/**
 * LMX Cloud load test — hits real /v1/chat/completions on the credit-balance
 * path and tallies real success rate, latency, provider used, and whether
 * the router had to fall back to a secondary provider.
 *
 * Usage:
 *   LMX_API_KEY=sk_... node scripts/lmx-loadtest.mjs
 *
 * Optional env vars:
 *   LMX_API_BASE     default https://api.lmxcloud.io
 *   LMX_MODELS       comma-separated aliases, default "qwen-3.6-35b,llama-3.3-70b"
 *   LMX_COUNT        requests per model, default 20
 *   LMX_DELAY_MS     delay between requests, default 2100 (keeps you under 30/min)
 *
 * This does NOT artificially force a provider failure — it just runs enough
 * real volume that a genuine fallback (if one happens) shows up in the data
 * via the x-lmx-fallback header. It is not a substitute for chaos-testing
 * the failover path on purpose.
 */

const API_BASE = process.env.LMX_API_BASE || "https://api.lmxcloud.io";
const API_KEY = process.env.LMX_API_KEY;
const MODELS = (process.env.LMX_MODELS || "qwen-3.6-35b,llama-3.3-70b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const COUNT_PER_MODEL = Number(process.env.LMX_COUNT || 20);
const DELAY_MS = Number(process.env.LMX_DELAY_MS || 2100);

if (!API_KEY) {
  console.error("Missing LMX_API_KEY. Usage: LMX_API_KEY=sk_... node scripts/lmx-loadtest.mjs");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStatus() {
  try {
    const res = await fetch(`${API_BASE}/v1/status`);
    return await res.json();
  } catch (err) {
    return { error: String(err) };
  }
}

async function oneRequest(model) {
  const started = Date.now();
  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with only the word: ok" }],
        max_tokens: 5,
        stream: false,
      }),
    });

    const clientLatencyMs = Date.now() - started;

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || 5);
      return {
        model,
        ok: false,
        status: 429,
        retryAfterSec: retryAfter,
        clientLatencyMs,
      };
    }

    const bodyText = await res.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText.slice(0, 300) };
    }

    return {
      model,
      ok: res.ok,
      status: res.status,
      clientLatencyMs,
      provider: res.headers.get("x-lmx-provider"),
      fallbackUsed: res.headers.get("x-lmx-fallback") === "true",
      serverLatencyMs: Number(res.headers.get("x-lmx-latency") || NaN),
      cost: res.headers.get("x-lmx-cost"),
      balance: res.headers.get("x-lmx-balance"),
      error: res.ok ? null : body,
    };
  } catch (err) {
    return {
      model,
      ok: false,
      status: 0,
      clientLatencyMs: Date.now() - started,
      error: String(err),
    };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(results) {
  const byModel = {};
  for (const r of results) {
    byModel[r.model] ??= [];
    byModel[r.model].push(r);
  }

  const summary = {};
  for (const [model, rows] of Object.entries(byModel)) {
    const ok = rows.filter((r) => r.ok);
    const failed = rows.filter((r) => !r.ok);
    const latencies = ok.map((r) => r.serverLatencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const fallbacks = ok.filter((r) => r.fallbackUsed);
    const providers = {};
    for (const r of ok) {
      if (r.provider) providers[r.provider] = (providers[r.provider] || 0) + 1;
    }

    summary[model] = {
      attempts: rows.length,
      successes: ok.length,
      successRate: rows.length ? +(ok.length / rows.length * 100).toFixed(1) : 0,
      failures: failed.map((f) => ({ status: f.status, error: f.error })),
      fallbackCount: fallbacks.length,
      providerBreakdown: providers,
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        min: latencies[0] ?? null,
        max: latencies[latencies.length - 1] ?? null,
      },
    };
  }
  return summary;
}

async function main() {
  console.log(`LMX Cloud load test — ${MODELS.length} model(s) x ${COUNT_PER_MODEL} requests, ${DELAY_MS}ms apart`);
  console.log(`Target: ${API_BASE}`);
  console.log("");

  const statusBefore = await getStatus();

  const results = [];
  for (const model of MODELS) {
    console.log(`-- ${model} --`);
    for (let i = 0; i < COUNT_PER_MODEL; i++) {
      let result = await oneRequest(model);

      if (result.status === 429) {
        console.log(`  [${i + 1}/${COUNT_PER_MODEL}] 429, waiting ${result.retryAfterSec}s then retrying once`);
        await sleep(result.retryAfterSec * 1000);
        result = await oneRequest(model);
      }

      results.push(result);
      const tag = result.ok
        ? `ok  provider=${result.provider} latency=${result.serverLatencyMs}ms fallback=${result.fallbackUsed}`
        : `FAIL status=${result.status} ${JSON.stringify(result.error).slice(0, 120)}`;
      console.log(`  [${i + 1}/${COUNT_PER_MODEL}] ${tag}`);

      await sleep(DELAY_MS);
    }
  }

  const statusAfter = await getStatus();
  const summary = summarize(results);

  const output = {
    ranAt: new Date().toISOString(),
    apiBase: API_BASE,
    statusBefore,
    statusAfter,
    summary,
    raw: results,
  };

  const fs = await import("node:fs");
  const outPath = `lmx-loadtest-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`Full results written to ${outPath}`);
}

main();
