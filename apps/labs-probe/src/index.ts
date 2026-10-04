#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { privateKeyToAccount } from "viem/accounts";

import { formatCheckList, formatSchedule, levelGroups, slotOf } from "./checks.js";
import { currentRunCanaryFailed, grade, gradedFileLines, sellerHost, withReconciled, type GradeReport, type GradedCall } from "./grade.js";
import { importListings, type DiscoveryPage } from "./import.js";
import { buildPreflight, dropBlockedTargets, formatPreflightTable, type PreflightReport, type PreflightWallet } from "./preflight.js";
import { canaryOf, cheapestLevel1, probeTarget, parseTarget, settlementWaitSeconds, type ProbeOptions, type ProbeResult, type ProbeRole, type ProbeTarget, type SpendLedger } from "./probe.js";
import { formatUsdc, MAX_CALL_USDC, resolveSpendCap, usdcToAtomic } from "./price.js";
import { fetchUsdcActivity, mergeReconciled, minutesCovering, pendingKeys, reconcile, resultKey } from "./reconcile.js";
import {
  collectCatalog,
  drawSample,
  dryRunFailure,
  endpointLabel,
  exclusionSummary,
  formatSampleTable,
  hostsFromResults,
  pilotHosts,
  poolSummary,
  SAMPLE_R3_MAX_USDC,
  SAMPLE_R3_MIN_USDC,
  toProbeTarget,
  type Replacement,
  type SampleCategory,
  type SampleRow,
} from "./sample.js";
import { formatCategoryTable, formatSummaryTable, summarize, summarizeCategories } from "./summary.js";
import { createLabsBuyer, labsAddress, normalizePrivateKey, readBaseUsdcBalance } from "./wallet.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  help: boolean;
  targets: string;
  results: string;
  spendCap: string | undefined;
  only: Set<string> | null;
  schedulePerDay: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    force: false,
    help: false,
    targets: path.join(packageRoot, "targets.json"),
    results: path.join(packageRoot, "results.jsonl"),
    spendCap: undefined,
    only: null,
    schedulePerDay: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--schedule") {
      const value = argv[index + 1];
      if (value !== "4x") throw new CliError("--schedule must be 4x", 2);
      index += 1;
      options.schedulePerDay = 4;
      continue;
    }
    if (arg === "--only") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError("--only requires a comma-separated id list", 2);
      index += 1;
      const ids = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
      if (ids.length === 0) throw new CliError("--only requires a comma-separated id list", 2);
      options.only = new Set(ids);
      continue;
    }
    if (arg === "--targets" || arg === "--results" || arg === "--spend-cap") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliError(`${arg} requires a value`, 2);
      }
      index += 1;
      if (arg === "--targets") options.targets = path.resolve(value);
      if (arg === "--results") options.results = path.resolve(value);
      if (arg === "--spend-cap") options.spendCap = value;
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }

  return options;
}

function printHelp(): void {
  console.log(`lmx-labs-probe — pay each x402 target once and record what came back

Usage:
  lmx-labs-probe [--dry-run] [--force] [--only id,id] [--schedule 4x] [--targets file] [--results file] [--spend-cap usdc]
  lmx-labs-probe preflight [--drop-blocked] [--targets file] [--results file] [--spend-cap usdc]
  lmx-labs-probe import --domain <host> [--path <substring>] [--targets file]
  lmx-labs-probe reconcile [--since-minutes 30] [--results file] [--output file]
  lmx-labs-probe grade [--results file] [--output file]
  lmx-labs-probe summary [--results file]
  lmx-labs-probe sample --n 20 --seed <timestamp> [--frame random|random-r3] [--spend-cap 0.50] [--targets file] [--results file]

A paid run probes each paid:true target once, in order. --only limits that run to those ids and skips the canary. About one second passes between paid targets. After the run it waits the longest signed maxTimeoutSeconds plus 120 seconds.
--schedule 4x selects one of four UTC slots (00:00, 06:00, 12:00, 18:00). Each slot uses a different pool case. The spend cap applies to that run. Invoke it again at the next slot.
preflight reads the latest dry-run results and the wallet. A paid run exits before signing unless every paid target is ready, the wallet covers the spend cap, and worst-case spend (targets + canary + one recheck per target) fits the cap. --force skips that gate. preflight --drop-blocked sets each blocked target to paid:false and records unpaidReason.
--dry-run probes every target, fetches the 402, and does not sign, pay, or consume the spend cap.
A quote that would exceed the run cap is printed as info, not a refusal.
sample pages the full Bazaar catalog, keeps one eligible endpoint per host, and draws --n of them with --seed. It dry-runs that draw for free and replaces a miss (not a 402, price mismatch, v1, or missing input) with the next shuffled host. --frame random-r3 keeps prices from $0.01 to $0.05, drops every host already present in results, and draws about n/5 from each category, filling a short category from "other". A miss is replaced from that same category. Then it pays the survivors once, plus the cheapest level-1 canary when the spend cap allows. It does not wait for settlement. A signed payment missing on chain is pending. A later reconcile finalizes pending rows and regrades.
import builds targets from the public x402 Bazaar. It keeps an existing
expectedSchema, body, and paid flag, and writes an unmatched, v1-only, or
price-unknown marker instead of dropping a host. A listing with no Base USDC
price is listedPriceUsdc null, never 0.

Safety (Base mainnet USDC only):
  refuse a call whose 402 price is above $0.05
  refuse a call whose 402 price differs from listedPriceUsdc
  refuse a paid call that would exceed the spend cap (default $0.25, hard max $1)
  refuse a POST with no body as no-input before any payment. That is input_fault, not a seller miss
  a paid result has one outcome: pass, no_delivery, error_body, empty_result, shape_mismatch,
  assertion_failed, charged_for_client_error, server_error_after_payment, timeout_after_payment,
  overcharged, or input_fault
  if a payment settles and the response fails, record it and do not retry that payment
  one unpaid invalid request per paid target whose 402 declares a required input or that sends its own query/body (blank or remove that field; 400/422 passes; a 402 is "validates after payment", info only). Nothing to invalidate is skipped
  one paid canary per run, on the cheapest L1 target, with an assertion that must fail
  one confirmation recheck for an unconfirmed seller S1/S2, when the spend cap allows
  grade reads reconciled.jsonl and writes onchainPaid and onchainAmount on every graded call. charged_for_client_error and server_error_after_payment require onchainPaid. Otherwise the outcome is declined_without_charge (info). A signed payment still missing on chain stays pending. grade exits 0 unless the current run's canary is not assertion_failed
  summary prints one table across every stored run, split into pilot, random, and random-r3, plus a combined row. A retest inherits that seller's original sample frame. Wilson intervals are on seller counts. random-r3 also prints per-category counts. Money lost omits deliberately invalid input; those on-chain charges are test-induced. summary does not change files
  x402 v1 requirements are refused as v1-unsupported
  a payTo that differs from the listing is high severity

Wallet:
  LMX_LABS_WALLET_PRIVATE_KEY   dedicated Labs buyer key (required unless --dry-run)
  LMX_LABS_RPC_URL              optional first Base RPC, then publicnode, 1rpc, and mainnet.base.org
  LMX_LABS_SPEND_CAP_USDC       overrides the default spend cap
  LMX_LABS_TIMEOUT_MS           per-request timeout (default 120000)

Results are appended to results.jsonl. The live USDC balance change is the spend
during the run. After a paid run, reconcile attributes each outgoing USDC
transfer to one result from chain logs and writes reconciled.jsonl.
results.jsonl is not modified. reconcile keeps every run: a new pass replaces the same call and leaves earlier runs in reconciled.jsonl. paid on a reconciled line is onchainPaid. Incoming USDC from that call's payTo within 30 minutes is recoveredUsd and refundTx. lossUsd is the on-chain amount for no_delivery, assertion_failed, error_body, timeout_after_payment, and server_error_after_payment. Net loss is lossUsd minus recoveredUsd. A format mismatch is contractBreachUsd and lossUsd 0. A call whose input was deliberately invalid has testInduced true.
An outgoing transfer that matches no result is flagged unattributed.
formatMatched is true/false against expectedSchema, else the listing output schema, else a schema derived from outputExample, else "na".
`);
}

async function loadTargets(file: string): Promise<ProbeTarget[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${file}: ${message}`, 2);
  }
  if (!Array.isArray(raw)) {
    throw new CliError("targets.json must be a JSON array", 2);
  }
  try {
    return raw.map((item, index) => parseTarget(item, index));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, 2);
  }
}

function timeoutMs(): number {
  const raw = process.env.LMX_LABS_TIMEOUT_MS;
  if (!raw) return 120_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError("LMX_LABS_TIMEOUT_MS must be a positive integer", 2);
  }
  return value;
}

function printResult(result: ProbeResult): void {
  for (const item of result.listingDrift) {
    if (item.severity !== "high") continue;
    console.error(`HIGH ${item.field} changed  ${result.id}  listed ${String(item.listed)}  live ${String(item.live)}`);
  }
  const drift = result.listingDrift
    .map((item) => (item.severity === "high" ? `HIGH ${item.field}` : item.field))
    .join(",");
  const verdict = [
    result.outcome,
    result.refusal ? `REFUSED ${result.refusal}` : null,
    result.error ? `ERROR ${result.error}` : null,
    result.finding ? `FINDING ${result.finding}` : null,
    result.wouldExceedRunCap ? `INFO ${result.wouldExceedRunCap}` : null,
    result.outcome || result.refusal || result.error || result.finding ? null : result.delivered ? "delivered" : "not-delivered",
    `format=${result.formatMatched}`,
    drift ? `drift ${drift}` : null,
    result.answeredUrl && result.answeredUrl !== result.url ? `answered ${result.answeredUrl}` : null,
    result.paidButNoDelivery ? "paid-but-no-delivery" : null,
    result.noDelivery ? "no-delivery" : null,
    result.formatFail ? "format-fail" : null,
    result.role !== "probe" ? result.role : null,
    result.warnings.length > 0 ? `warnings ${result.warnings.length}` : null,
    result.errorLikeBody ? "error-like-body" : null,
    result.checkLevel ? `${result.checkLevel} ${result.checkName ?? ""}`.trim() : null,
    result.staleCache ? "stale-cache" : null,
    result.dataAgeSeconds !== null ? `age ${result.dataAgeSeconds}s` : null,
    result.balanceDeltaUsdc ? `delta ${result.balanceDeltaUsdc}` : null,
    result.settlementTx ? `tx ${result.settlementTx}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const price = result.quotedPriceUsdc ?? result.listedPriceUsdc ?? "null";
  console.log(`${result.id}  ${result.httpStatus ?? "-"}  ${price} USDC  ${result.latencyMs}ms  ${verdict}`);
}

async function readExistingTargets(file: string): Promise<unknown[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(raw)) throw new CliError("targets.json must be a JSON array", 2);
    return raw;
  } catch (error) {
    if (error instanceof CliError) throw error;
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${file}: ${message}`, 2);
  }
}

async function fetchDiscoveryPage(offset: number, limit: number): Promise<DiscoveryPage> {
  const url = new URL("https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  let status = 0;
  let lastError = "Discovery API request failed";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 429 || response.status >= 500) {
        status = response.status;
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(30_000, retryAfter * 1000)
          : Math.min(20_000, 1_000 * 2 ** attempt);
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        throw new CliError(`Discovery API returned ${response.status}`, 1);
      }
      return await response.json() as DiscoveryPage;
    } catch (error) {
      if (error instanceof CliError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(Math.min(20_000, 1_000 * 2 ** attempt));
    }
  }
  throw new CliError(status > 0 ? `Discovery API returned ${status}` : lastError, 1);
}

async function runImport(argv: string[]): Promise<void> {
  let domain: string | undefined;
  let pathFilter: string | undefined;
  let targets = path.join(packageRoot, "targets.json");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--domain" || arg === "--path" || arg === "--targets") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${arg} requires a value`, 2);
      index += 1;
      if (arg === "--domain") domain = value;
      if (arg === "--path") pathFilter = value;
      if (arg === "--targets") targets = path.resolve(value);
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }
  if (!domain) throw new CliError("import requires --domain <host>", 2);

  const existing = await readExistingTargets(targets);
  const result = await importListings({
    domain,
    path: pathFilter,
    existing,
    fetchPage: fetchDiscoveryPage,
    onPage: (info) => {
      const total = Number.isFinite(info.total) ? String(info.total) : "?";
      console.log(`discovery offset ${info.offset} / ${total}`);
    },
  });
  await writeFile(targets, `${JSON.stringify(result.targets, null, 2)}\n`, "utf8");
  const outcome = result.unmatched
    ? "host unmatched"
    : `${result.matched} listed, ${result.v1Only} v1-only, ${result.priceUnknown} price-unknown`;
  console.log(`import ${domain}${pathFilter ? ` path ${pathFilter}` : ""}  ${outcome}  -> ${targets}`);
  if (result.unmatched) process.exitCode = 1;
}

async function priorPaidHashes(file: string): Promise<Map<string, string[]>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return new Map();
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${file}: ${message}`, 2);
  }
  const prior = new Map<string, string[]>();
  for (const line of text.split(/\n/)) {
    if (line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.bodySource !== "paid" || typeof record.id !== "string" || typeof record.bodySha256 !== "string") continue;
    const hashes = prior.get(record.id) ?? [];
    hashes.push(record.bodySha256);
    prior.set(record.id, hashes);
  }
  return prior;
}

async function readResultLines(file: string): Promise<ProbeResult[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${file}: ${message}`, 2);
  }
  const results: ProbeResult[] = [];
  for (const line of text.split(/\n/)) {
    if (line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CliError(`A result line in ${file} is not an object`, 2);
    }
    results.push(parsed as ProbeResult);
  }
  return results;
}

async function runReconcile(argv: string[]): Promise<void> {
  let sinceMinutes: number | null = null;
  let results = path.join(packageRoot, "results.jsonl");
  let output = path.join(packageRoot, "reconciled.jsonl");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--since-minutes" || arg === "--results" || arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${arg} requires a value`, 2);
      index += 1;
      if (arg === "--since-minutes") {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          throw new CliError("--since-minutes must be a positive number", 2);
        }
        sinceMinutes = minutes;
      }
      if (arg === "--results") results = path.resolve(value);
      if (arg === "--output") output = path.resolve(value);
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }

  const privateKey = process.env.LMX_LABS_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new CliError("LMX_LABS_WALLET_PRIVATE_KEY is required to reconcile the Labs wallet", 2);
  }
  const labsAddress = privateKeyToAccount(normalizePrivateKey(privateKey)).address;
  const rpcUrl = process.env.LMX_LABS_RPC_URL;
  const now = new Date();
  const recorded = await readResultLines(results);
  const earlier = await readJsonl(output);
  const fullScan = sinceMinutes === null;
  const windowMinutes = sinceMinutes ?? minutesCovering(recorded, now);
  const stillPending = pendingKeys(earlier);
  const activity = await fetchUsdcActivity({ rpcUrl, labsAddress, sinceMinutes: windowMinutes, now });
  const report = reconcile({
    results: recorded,
    transfers: activity.transfers,
    incoming: activity.incoming,
    authorizations: activity.authorizations,
    labsAddress,
    sinceMinutes: windowMinutes,
    now,
    alsoInclude: (result) => stillPending.has(resultKey(result)),
  });
  const merged = mergeReconciled(earlier, report.lines, fullScan);
  const body = merged.map((line) => JSON.stringify(line)).join("\n");
  await writeFile(output, body.length > 0 ? `${body}\n` : "", "utf8");
  const overcharged = merged.filter((line) => !("kind" in line) && line.overcharged).length;
  const onFile = merged.filter((line) => !("kind" in line) && line.onchainPaid).length;
  console.log(
    `reconcile  ${windowMinutes} min  wallet ${labsAddress}  ${report.onchainPaid} onchain paid this pass  ${onFile} on file  ${report.pending} pending  ${report.unattributed} unattributed  ${overcharged} overcharged  -> ${output}`,
  );
  for (const line of merged) {
    if ("kind" in line && line.kind === "unattributed") {
      console.log(`unattributed  ${line.onchainAmountUsdc} USDC  ${line.from} -> ${line.to}  tx ${line.onchainTx}`);
    } else if (!("kind" in line) && line.overcharged) {
      console.log(`overcharged  ${line.id}  ${line.overchargeReason ?? ""}  tx ${line.onchainTx ?? "-"}`);
    }
  }
  const gradedPath = path.join(path.dirname(results), "graded.jsonl");
  const graded = grade(withReconciled(recorded, merged), now);
  await writeGrade(gradedPath, graded);
  const pendingLeft = graded.calls.filter((call) => call.paid === "pending reconcile").length;
  console.log(`regrade  ${pendingLeft} pending  -> ${gradedPath}`);
  if (report.unattributed > 0 || overcharged > 0) process.exitCode = 1;
}

async function readJsonl(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${file}: ${message}`, 2);
  }
  const lines: unknown[] = [];
  for (const line of text.split(/\n/)) {
    if (line.trim() === "") continue;
    lines.push(JSON.parse(line) as unknown);
  }
  return lines;
}

function canAfford(target: ProbeTarget, ledger: SpendLedger): boolean {
  if (target.listedPriceUsdc === null || target.listedPriceUsdc > MAX_CALL_USDC) return false;
  return ledger.spentAtomic + usdcToAtomic(target.listedPriceUsdc) <= ledger.capAtomic;
}

function printPilot(report: GradeReport): void {
  const summary = report.summary;
  const wilson = summary.wilson
    ? `  Wilson 95% [${summary.wilson.low.toFixed(3)}, ${summary.wilson.high.toFixed(3)}]`
    : "";
  console.log(
    `pilot  confirmed S1/S2 ${summary.sellersConfirmedS1S2}/${summary.sellersTestedL1} sellers at L1+${wilson}`,
  );
  const rate = summary.secondary.rate === null ? "n/a" : summary.secondary.rate.toFixed(3);
  console.log(
    `secondary  per-call seller faults ${summary.secondary.sellerFaultCalls}/${summary.secondary.calls}  rate ${rate}`,
  );
  for (const seller of report.sellers) {
    console.log(`${seller.label}  ${seller.seller}${seller.pendingRecheck ? "  recheck pending" : ""}`);
  }
  if (summary.canary) {
    console.log(`canary  ${summary.canary.id}  ${summary.canary.outcome ?? "-"}  ${summary.canary.ok ? "ok" : "not assertion_failed"}`);
  }
  if (summary.runInvalid) console.log("run invalid  canary graded pass");
  for (const group of levelGroups(report.calls)) {
    console.log(`${group.level}  ${group.rows.length}`);
    for (const row of group.rows) {
      console.log(`  ${row.id}  ${row.checkName ?? "-"}  ${row.outcome ?? "-"}  ${row.fault ?? "-"}`);
    }
  }
  for (const job of summary.rechecks) console.log(`recheck due  ${job.id}  before ${job.dueBefore}`);
}

async function overlayReconciled(resultsPath: string, recorded: ProbeResult[]): Promise<ProbeResult[]> {
  const reconciledPath = path.join(path.dirname(resultsPath), "reconciled.jsonl");
  let raw: string;
  try {
    raw = await readFile(reconciledPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return recorded;
    throw error;
  }
  const lines: unknown[] = [];
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed) as unknown);
  }
  return withReconciled(recorded, lines);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function writeGrade(file: string, report: GradeReport): Promise<void> {
  const lines = gradedFileLines(report);
  const body = lines.map((line) => JSON.stringify(line)).join("\n");
  await writeFile(file, body.length > 0 ? `${body}\n` : "", "utf8");
}

function gradeFailed(report: GradeReport): boolean {
  return currentRunCanaryFailed(report);
}

async function runGrade(argv: string[]): Promise<void> {
  let results = path.join(packageRoot, "results.jsonl");
  let output = path.join(packageRoot, "graded.jsonl");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--results" || arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${arg} requires a value`, 2);
      index += 1;
      if (arg === "--results") results = path.resolve(value);
      if (arg === "--output") output = path.resolve(value);
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }
  const recorded = await readResultLines(results);
  const reconciledPath = path.join(path.dirname(results), "reconciled.jsonl");
  let reconciledRaw: string;
  try {
    reconciledRaw = await readFile(reconciledPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") throw new CliError(`grade requires ${reconciledPath}`, 2);
    throw error;
  }
  const reconciledLines: unknown[] = [];
  for (const line of reconciledRaw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    reconciledLines.push(JSON.parse(trimmed) as unknown);
  }
  const report = grade(withReconciled(recorded, reconciledLines), new Date());
  await writeGrade(output, report);
  printPilot(report);
  console.log(`grade  ${report.calls.length} call(s)  ${report.sellers.length} seller(s)  -> ${output}`);
  if (gradeFailed(report)) process.exitCode = 1;
}

async function runSummary(argv: string[]): Promise<void> {
  let results = path.join(packageRoot, "results.jsonl");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--results") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError("--results requires a value", 2);
      index += 1;
      results = path.resolve(value);
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }
  const recorded = await readResultLines(results);
  const overlay = await overlayReconciled(results, recorded);
  console.log(formatSummaryTable(summarize(overlay)));
  console.log(formatCategoryTable(summarizeCategories(overlay)));
}

function redactSecrets(message: string): string {
  return message
    .replace(/0x[0-9a-fA-F]{64}/g, "0x[redacted]")
    .replace(/(^|[^0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, "$1[redacted]");
}

async function loadPreflightWallet(): Promise<PreflightWallet> {
  const privateKey = process.env.LMX_LABS_WALLET_PRIVATE_KEY;
  if (!privateKey || privateKey.trim() === "" || privateKey.trim() === "0x") {
    return { address: null, balanceAtomic: null, error: "LMX_LABS_WALLET_PRIVATE_KEY is required" };
  }
  let address;
  try {
    address = labsAddress(privateKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid LMX_LABS_WALLET_PRIVATE_KEY";
    return { address: null, balanceAtomic: null, error: redactSecrets(message) };
  }
  try {
    const balanceAtomic = await readBaseUsdcBalance(address, process.env.LMX_LABS_RPC_URL);
    return { address, balanceAtomic, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read Base USDC balance";
    return { address, balanceAtomic: null, error: redactSecrets(message) };
  }
}

async function readOptionalResults(file: string): Promise<ProbeResult[]> {
  try {
    return await readResultLines(file);
  } catch (error) {
    if (error instanceof CliError && error.message.includes("ENOENT")) return [];
    throw error;
  }
}

function preflightTally(report: PreflightReport): string {
  const ready = report.rows.filter((row) => row.kind === "target" && row.status === "ready").length;
  const blocked = report.rows.filter((row) => row.kind === "target" && row.status === "blocked").length;
  return `preflight  ${ready} ready  ${blocked} blocked`;
}

async function runPreflight(argv: string[]): Promise<void> {
  let targetsPath = path.join(packageRoot, "targets.json");
  let resultsPath = path.join(packageRoot, "results.jsonl");
  let spendCapRaw: string | undefined;
  let drop = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--drop-blocked") {
      drop = true;
      continue;
    }
    if (arg === "--targets" || arg === "--results" || arg === "--spend-cap") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${arg} requires a value`, 2);
      index += 1;
      if (arg === "--targets") targetsPath = path.resolve(value);
      if (arg === "--results") resultsPath = path.resolve(value);
      if (arg === "--spend-cap") spendCapRaw = value;
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }

  let spendCap: number;
  try {
    spendCap = resolveSpendCap(spendCapRaw ?? process.env.LMX_LABS_SPEND_CAP_USDC);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, 2);
  }
  const targets = await loadTargets(targetsPath);
  const report = buildPreflight({
    targets,
    results: await readOptionalResults(resultsPath),
    now: new Date(),
    spendCapAtomic: usdcToAtomic(spendCap),
    wallet: await loadPreflightWallet(),
  });
  console.log(formatPreflightTable(report.rows));
  console.log(preflightTally(report));
  if (drop) {
    const raw = await readExistingTargets(targetsPath);
    const next = dropBlockedTargets(raw, report.rows);
    if (next.dropped.length > 0) {
      await writeFile(targetsPath, `${JSON.stringify(next.targets, null, 2)}\n`, "utf8");
      console.log(`dropped ${next.dropped.length} blocked target(s) to paid:false  -> ${targetsPath}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

function chainLabel(call: GradedCall | undefined, result: ProbeResult, onchainAmount: string | null): string {
  if (call?.paid === "pending reconcile") return "pending";
  if (onchainAmount) return onchainAmount;
  if (call?.paid === true) return "paid";
  if (result.paymentAuth) return "unpaid";
  return "-";
}

function onchainAmountOf(result: ProbeResult, lines: readonly unknown[]): string | null {
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as {
      kind?: string;
      id?: string;
      role?: string;
      timestamp?: string;
      onchainPaid?: boolean;
      onchainAmountUsdc?: string | null;
    };
    if (record.kind === "unattributed") continue;
    if (record.id !== result.id || record.role !== result.role || record.timestamp !== result.timestamp) continue;
    if (record.onchainPaid === true && record.onchainAmountUsdc) return record.onchainAmountUsdc;
  }
  return null;
}

async function runSample(argv: string[]): Promise<void> {
  let count: number | undefined;
  let seed: string | undefined;
  let spendCapRaw: string | undefined;
  let frame: "random" | "random-r3" = "random";
  let targetsPath = path.join(packageRoot, "targets.json");
  let resultsPath = path.join(packageRoot, "results.jsonl");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--n" || arg === "--seed" || arg === "--spend-cap" || arg === "--targets" || arg === "--results" || arg === "--frame") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${arg} requires a value`, 2);
      index += 1;
      if (arg === "--n") {
        count = Number(value);
        if (!Number.isInteger(count) || count <= 0) throw new CliError("--n must be a positive integer", 2);
      }
      if (arg === "--seed") seed = value;
      if (arg === "--spend-cap") spendCapRaw = value;
      if (arg === "--targets") targetsPath = path.resolve(value);
      if (arg === "--results") resultsPath = path.resolve(value);
      if (arg === "--frame") {
        if (value !== "random" && value !== "random-r3") {
          throw new CliError("--frame must be random or random-r3", 2);
        }
        frame = value;
      }
      continue;
    }
    throw new CliError(`Unknown argument: ${arg}`, 2);
  }
  if (count === undefined) throw new CliError("sample requires --n <count>", 2);
  if (!seed) throw new CliError("sample requires --seed <timestamp>", 2);
  if (!/^[A-Za-z0-9._-]+$/.test(seed)) {
    throw new CliError("--seed must be letters, numbers, dots, underscores, or dashes", 2);
  }

  let spendCap: number;
  try {
    spendCap = resolveSpendCap(spendCapRaw ?? process.env.LMX_LABS_SPEND_CAP_USDC);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, 2);
  }

  const higher = frame === "random-r3";
  const runId = higher ? `sample-r3-${seed}` : `sample-${seed}`;
  const samplePath = path.join(packageRoot, "samples", `${runId}.json`);
  const capAtomic = usdcToAtomic(spendCap);
  const sampleTimeout = higher ? 120_000 : timeoutMs();
  console.log(`lmx-labs-probe  sample  ${frame}  n ${count}  seed ${seed}  timeout ${sampleTimeout}ms  spend cap $${formatUsdc(capAtomic)}`);

  const hosts = pilotHosts(await readExistingTargets(targetsPath));
  const tested = higher ? hostsFromResults(await readResultLines(resultsPath)) : new Set<string>();
  let loggedOffset = -1_000;
  const resources = await collectCatalog({
    fetchPage: fetchDiscoveryPage,
    onPage: ({ offset, total }) => {
      if (offset === 0 || offset >= loggedOffset + 1_000) {
        console.log(`discovery offset ${offset} / ${total}`);
        loggedOffset = offset;
      }
    },
  });
  const draw = drawSample({
    resources,
    pilotHosts: hosts,
    testedHosts: tested,
    n: count,
    seed,
    ...(higher ? { minUsdc: SAMPLE_R3_MIN_USDC, maxUsdc: SAMPLE_R3_MAX_USDC, stratify: true } : {}),
  });
  console.log(`eligible ${draw.eligible.length}  catalog ${draw.catalog}`);
  console.log(`exclusions  ${exclusionSummary(draw.exclusions) || "none"}`);
  if (draw.stratified) console.log(`pools  ${poolSummary(draw.pools)}`);

  const replacements: Replacement[] = [];
  const queue = [...draw.queue];
  const categoryQueues = draw.queues;
  const takeReplacement = (category: SampleCategory): { next: (typeof draw.selected)[number] | null; note: string } => {
    if (!draw.stratified) return { next: queue.shift() ?? null, note: "" };
    const next = categoryQueues[category].shift() ?? null;
    return { next, note: next ? "" : "category pool empty" };
  };
  const passed: typeof draw.selected = [];
  const dryLedger: SpendLedger = { spentAtomic: 0n, capAtomic, projectedAtomic: 0n };
  const dryOptions = {
    dryRun: true as const,
    ledger: dryLedger,
    signPayment: async () => {
      throw new Error("dry-run does not sign payments");
    },
    timeoutMs: sampleTimeout,
    rpcUrl: process.env.LMX_LABS_RPC_URL,
    role: "probe" as const,
    runId,
  };
  const waiting = [...draw.selected];
  while (passed.length < count && waiting.length > 0) {
    const candidate = waiting.shift();
    if (!candidate) break;
    const probed = await probeTarget(toProbeTarget(candidate.target, candidate.category), dryOptions);
    const reason = dryRunFailure(probed);
    if (!reason) {
      passed.push(candidate);
      console.log(`dry-run ok  ${candidate.category}  ${candidate.host}  ${probed.quotedPriceUsdc ?? candidate.target.listedPriceUsdc} USDC`);
      continue;
    }
    const { next, note } = takeReplacement(candidate.category);
    replacements.push({
      droppedId: candidate.target.id,
      droppedUrl: candidate.target.url,
      reason,
      replacementId: next?.target.id ?? null,
      replacementUrl: next?.target.url ?? null,
    });
    console.log(`replace  ${candidate.category}  ${candidate.target.id}  ${reason}  -> ${next?.target.id ?? note}`);
    if (next) waiting.push(next);
  }
  if (passed.length < count) {
    console.log(`dry-run pool ran out  ${passed.length} of ${count}`);
  }

  const pilot = await loadTargets(targetsPath);
  const canarySource = cheapestLevel1(pilot);
  let canaryTarget: ProbeTarget | null = null;
  let canarySkip = "no level-1 paid target";
  if (canarySource) {
    const canaryDry = await probeTarget(canarySource, dryOptions);
    const reason = dryRunFailure(canaryDry);
    if (reason) {
      canarySkip = `dry-run ${reason}`;
      console.log(`canary dry-run failed  ${canarySource.id ?? canarySource.url}  ${reason}`);
    } else {
      canaryTarget = canaryOf(canarySource, new Date());
      canarySkip = "";
    }
  }

  const selectedAtomic = passed.reduce((sum, item) => sum + usdcToAtomic(item.target.listedPriceUsdc ?? 0), 0n);
  let canaryAtomic = canaryTarget?.listedPriceUsdc != null ? usdcToAtomic(canaryTarget.listedPriceUsdc) : 0n;
  if (canaryTarget && selectedAtomic + canaryAtomic > capAtomic) {
    canarySkip = `cap $${formatUsdc(selectedAtomic + canaryAtomic)} exceeds $${formatUsdc(capAtomic)}`;
    console.log(`canary skipped cap  ${canarySource?.id ?? ""}`);
    canaryTarget = null;
    canaryAtomic = 0n;
  }
  if (selectedAtomic > capAtomic) {
    throw new CliError(
      `sample quotes $${formatUsdc(selectedAtomic)} exceed the $${formatUsdc(capAtomic)} spend cap`,
      1,
    );
  }
  if (passed.length === 0) {
    await mkdir(path.dirname(samplePath), { recursive: true });
    await writeFile(samplePath, `${JSON.stringify({ runId, seed, n: count, eligible: draw.eligible.length, exclusions: draw.exclusions, replacements, selected: [] }, null, 2)}\n`);
    throw new CliError("no eligible seller passed the dry-run", 1);
  }

  const privateKey = process.env.LMX_LABS_WALLET_PRIVATE_KEY;
  if (!privateKey || privateKey.trim() === "" || privateKey.trim() === "0x") {
    throw new CliError("LMX_LABS_WALLET_PRIVATE_KEY is required to pay. The dry-run did not spend.", 2);
  }
  const buyer = createLabsBuyer(privateKey, process.env.LMX_LABS_RPC_URL);
  const before = await buyer.readUsdcBalance();
  console.log(`wallet ${buyer.address}  ${formatUsdc(before)} USDC`);
  if (before < capAtomic) {
    throw new CliError(`wallet ${formatUsdc(before)} USDC is below the $${formatUsdc(capAtomic)} spend cap`, 1);
  }

  const ledger: SpendLedger = { spentAtomic: 0n, capAtomic, projectedAtomic: 0n };
  const paidResults: ProbeResult[] = [];
  let paidCalls = 0;
  const recordPaid = async (target: ProbeTarget, role: ProbeRole): Promise<ProbeResult> => {
    if (paidCalls > 0) await sleep(1_000);
    paidCalls += 1;
    const result = await probeTarget(target, {
      dryRun: false,
      ledger,
      signPayment: (required) => buyer.signPayment(required),
      readUsdcBalance: () => buyer.readUsdcBalance(),
      timeoutMs: sampleTimeout,
      rpcUrl: process.env.LMX_LABS_RPC_URL,
      role,
      runId,
    });
    await appendFile(resultsPath, `${JSON.stringify(result)}\n`, "utf8");
    printResult(result);
    paidResults.push(result);
    return result;
  };

  const paidAt = Date.now();
  for (const candidate of passed) {
    await recordPaid(toProbeTarget(candidate.target, candidate.category), "probe");
  }
  if (canaryTarget) await recordPaid(canaryTarget, "canary");

  const recorded = await readResultLines(resultsPath);
  const immediate = grade(recorded, new Date());
  const gradedPath = path.join(path.dirname(resultsPath), "graded.jsonl");
  await writeGrade(gradedPath, immediate);

  const sinceMinutes = Math.max(30, Math.ceil((Date.now() - paidAt) / 60_000) + 5);
  const activity = await fetchUsdcActivity({
    rpcUrl: process.env.LMX_LABS_RPC_URL,
    labsAddress: buyer.address,
    sinceMinutes,
    now: new Date(),
  });
  const chain = reconcile({
    results: recorded,
    transfers: activity.transfers,
    incoming: activity.incoming,
    authorizations: activity.authorizations,
    labsAddress: buyer.address,
    sinceMinutes,
    pendingRunId: runId,
  });
  const reconciledPath = path.join(path.dirname(resultsPath), "reconciled.jsonl");
  const earlierReconciled = await readJsonl(reconciledPath);
  const merged = mergeReconciled(earlierReconciled, chain.lines, false);
  const reconciledBody = merged.map((line) => JSON.stringify(line)).join("\n");
  await writeFile(reconciledPath, reconciledBody.length > 0 ? `${reconciledBody}\n` : "", "utf8");
  const report = grade(withReconciled(recorded, chain.lines), new Date());
  await writeGrade(gradedPath, report);

  const calls = new Map(report.calls.map((call) => [`${call.role}|${call.id}|${call.timestamp}`, call]));
  const rows: SampleRow[] = paidResults.filter((result) => result.role === "probe").map((result) => {
    const call = calls.get(`${result.role}|${result.id}|${result.timestamp}`);
    return {
      host: sellerHost(result.url),
      category: result.sampleCategory ?? "-",
      endpoint: endpointLabel(result),
      price: result.quotedPriceUsdc ?? result.listedPriceUsdc ?? "-",
      httpStatus: result.httpStatus === null ? "-" : String(result.httpStatus),
      outcome: call?.outcome ?? result.outcome ?? "-",
      severity: call?.severity ?? "-",
      fault: call?.fault ?? "-",
      chain: chainLabel(call, result, onchainAmountOf(result, chain.lines)),
      latency: `${result.latencyMs}ms`,
      warnings: result.warnings.length === 0 ? "-" : result.warnings.map((item) => item.reason).join("; "),
    };
  });
  console.log(formatSampleTable(rows));
  const summarized = withReconciled(recorded, merged);
  console.log(formatSummaryTable(summarize(summarized)));
  console.log(formatCategoryTable(summarizeCategories(summarized)));
  console.log(`eligible ${draw.eligible.length}  catalog ${draw.catalog}`);
  console.log(`exclusions  ${exclusionSummary(draw.exclusions) || "none"}`);
  console.log(`replacements ${replacements.length}`);
  for (const item of replacements) {
    console.log(`  ${item.droppedId}  ${item.reason}  -> ${item.replacementId ?? "pool empty"}`);
  }
  const canaryResult = paidResults.find((result) => result.role === "canary") ?? null;
  const canaryCall = canaryResult ? calls.get(`canary|${canaryResult.id}|${canaryResult.timestamp}`) : undefined;
  if (canaryResult && canaryCall) {
    const ok = canaryCall.outcome === "assertion_failed" ? "ok" : "not assertion_failed";
    console.log(`canary  ${canaryResult.id}  ${canaryResult.httpStatus ?? "-"}  ${canaryCall.outcome ?? "-"}  ${ok}  chain ${chainLabel(canaryCall, canaryResult, onchainAmountOf(canaryResult, chain.lines))}`);
  } else {
    console.log(`canary  skipped  ${canarySkip}`);
  }
  let afterLabel = "unread";
  let deltaLabel = "unread";
  try {
    const after = await buyer.readUsdcBalance();
    afterLabel = formatUsdc(after);
    deltaLabel = formatUsdc(before - after);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    afterLabel = `unread (${redactSecrets(message)})`;
  }
  console.log(`spend $${deltaLabel}  wallet before $${formatUsdc(before)}  after $${afterLabel}  -> ${samplePath}`);
  if (chain.unattributed > 0) {
    console.log(`unattributed ${chain.unattributed}`);
  }

  await mkdir(path.dirname(samplePath), { recursive: true });
  await writeFile(samplePath, `${JSON.stringify({
    runId,
    seed,
    n: count,
    catalog: draw.catalog,
    eligible: draw.eligible.length,
    exclusions: draw.exclusions,
    replacements,
    frame,
    pools: draw.pools,
    selected: passed.map((item) => toProbeTarget(item.target, item.category)),
    canary: canaryTarget ? { id: canaryTarget.id, url: canaryTarget.url, listedPriceUsdc: canaryTarget.listedPriceUsdc } : null,
    walletBeforeUsdc: formatUsdc(before),
    walletAfterUsdc: afterLabel,
    spendUsdc: deltaLabel,
  }, null, 2)}\n`, "utf8");

  const short = passed.length < count;
  const sellerFault = rows.some((row) => row.fault === "seller");
  const canaryBad = canaryResult ? canaryCall?.outcome !== "assertion_failed" : canarySkip !== "no level-1 paid target";
  if (short || sellerFault || canaryBad) process.exitCode = 1;
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(packageRoot, ".env") });
  dotenv.config({ path: path.resolve(packageRoot, "../../.env") });

  const argv = process.argv.slice(2);
  if (argv[0] === "import") {
    await runImport(argv.slice(1));
    return;
  }
  if (argv[0] === "reconcile") {
    await runReconcile(argv.slice(1));
    return;
  }
  if (argv[0] === "grade") {
    await runGrade(argv.slice(1));
    return;
  }
  if (argv[0] === "summary") {
    await runSummary(argv.slice(1));
    return;
  }
  if (argv[0] === "preflight") {
    await runPreflight(argv.slice(1));
    return;
  }
  if (argv[0] === "sample") {
    await runSample(argv.slice(1));
    return;
  }

  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  let spendCap: number;
  try {
    spendCap = resolveSpendCap(options.spendCap ?? process.env.LMX_LABS_SPEND_CAP_USDC);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, 2);
  }
  const targets = await loadTargets(options.targets);
  if (!options.dryRun && !options.force) {
    const report = buildPreflight({
      targets,
      results: await readOptionalResults(options.results),
      now: new Date(),
      spendCapAtomic: usdcToAtomic(spendCap),
      wallet: await loadPreflightWallet(),
    });
    console.log(formatPreflightTable(report.rows));
    console.log(preflightTally(report));
    if (!report.ok) {
      throw new CliError(
        "preflight blocked the paid run. Use preflight --drop-blocked to set blocked targets paid:false, or --force to skip this gate.",
        1,
      );
    }
  }
  const included = (target: ProbeTarget): boolean => {
    if (!options.only) return true;
    return options.only.has(target.id ?? target.url);
  };
  const selected = (options.dryRun ? targets : targets.filter((target) => target.paid === true)).filter(included);
  const ledger: SpendLedger = { spentAtomic: 0n, capAtomic: usdcToAtomic(spendCap), projectedAtomic: 0n };
  const mode = options.dryRun ? "dry-run" : "pay";
  const count = options.dryRun
    ? `${selected.length} target(s)`
    : `${selected.length} paid target(s) of ${targets.length}`;
  console.log(
    `lmx-labs-probe  ${mode}  ${count}  Base USDC  per-call max $0.050000  spend cap $${formatUsdc(ledger.capAtomic)}`,
  );
  if (options.schedulePerDay > 1) {
    const now = new Date();
    console.log(`schedule ${options.schedulePerDay}x  ${formatSchedule(options.schedulePerDay)}  this run is slot ${slotOf(now, options.schedulePerDay)}`);
  }
  console.log(formatCheckList(targets, new Date(), options.schedulePerDay));

  let readUsdcBalance: (() => Promise<bigint>) | undefined;
  let signPayment: ProbeOptions["signPayment"] = async () => {
    throw new Error("dry-run does not sign payments");
  };
  if (!options.dryRun) {
    const privateKey = process.env.LMX_LABS_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new CliError(
        "LMX_LABS_WALLET_PRIVATE_KEY is required to pay. Use --dry-run to fetch 402s without a wallet.",
        2,
      );
    }
    const buyer = createLabsBuyer(privateKey, process.env.LMX_LABS_RPC_URL);
    console.log(`wallet ${buyer.address}`);
    signPayment = (required) => buyer.signPayment(required);
    readUsdcBalance = () => buyer.readUsdcBalance();
  }

  const prior = await priorPaidHashes(options.results);
  const runId = new Date().toISOString();
  const paidTargets = targets.filter((target) => target.paid === true);
  const results: ProbeResult[] = [];
  const probeOptions = (role: ProbeRole): ProbeOptions => ({
    dryRun: options.dryRun,
    ledger,
    signPayment,
    readUsdcBalance,
    timeoutMs: timeoutMs(),
    rpcUrl: process.env.LMX_LABS_RPC_URL,
    role,
    runId,
    schedulePerDay: options.schedulePerDay,
  });
  const record = async (target: ProbeTarget, role: ProbeRole): Promise<ProbeResult> => {
    const result = await probeTarget(target, {
      ...probeOptions(role),
      priorBodyHashes: prior.get(target.id ?? target.url) ?? [],
    });
    await appendFile(options.results, `${JSON.stringify(result)}\n`, "utf8");
    printResult(result);
    results.push(result);
    return result;
  };
  let paidCalls = 0;
  const recordPaid = async (target: ProbeTarget, role: ProbeRole): Promise<ProbeResult> => {
    if (paidCalls > 0) await sleep(1_000);
    paidCalls += 1;
    return record(target, role);
  };

  for (const target of paidTargets.filter(included)) {
    await record(target, "prepay");
  }
  for (const target of selected) {
    await recordPaid(target, "probe");
  }
  if (!options.dryRun) {
    const canarySource = options.only ? null : cheapestLevel1(paidTargets);
    if (canarySource && canAfford(canarySource, ledger)) {
      await recordPaid(canaryOf(canarySource, new Date(), options.schedulePerDay), "canary");
    } else if (canarySource) {
      console.log(`canary skipped cap  ${canarySource.id ?? canarySource.url}`);
    }
    let recorded: ProbeResult[];
    try {
      recorded = await readResultLines(options.results);
    } catch {
      recorded = results;
    }
    let report = grade(recorded, new Date());
    for (const job of report.rechecks) {
      const target = paidTargets.find((item) => (item.id ?? item.url) === job.id);
      if (!target || !canAfford(target, ledger)) {
        console.log(`recheck skipped cap  ${job.id}`);
        continue;
      }
      await recordPaid(target, "recheck");
    }
    recorded = await readResultLines(options.results);
    report = grade(recorded, new Date());
    const graded = path.join(path.dirname(options.results), "graded.jsonl");
    await writeGrade(graded, report);
    printPilot(report);
    console.log(`grade  -> ${graded}`);
    if (gradeFailed(report)) process.exitCode = 1;
  }

  const scored = results.filter((result) => result.role !== "canary");
  const refused = scored.filter((result) => result.refusal && result.outcome !== "input_fault").length;
  const sellerFaults = scored.filter((result) => result.sellerFault).length;
  const inputFaults = scored.filter((result) => result.outcome === "input_fault").length;
  const stale = scored.filter((result) => result.staleCache).length;
  const failed = scored.filter((result) => result.error && !result.sellerFault && result.outcome !== "input_fault").length;
  const delivered = scored.filter((result) => result.delivered).length;
  const wouldExceed = scored.filter((result) => result.wouldExceedRunCap).length;
  const payToChanged = scored.filter((result) => result.listingDrift.some((item) => item.severity === "high")).length;
  const dead = scored.filter((result) => result.finding === "listed route is dead").length;
  const validatesAfter = scored.filter((result) => result.finding === "validates after payment").length;
  const spentAtomic = options.dryRun ? ledger.projectedAtomic ?? 0n : ledger.spentAtomic;
  const spentLabel = options.dryRun ? "would spend" : "spent";
  console.log(
    `${results.length} call(s)  ${delivered} delivered  ${sellerFaults} seller-fault  ${inputFaults} input-fault  ${refused} refused  ${failed} failed  ${stale} stale  ${wouldExceed} would-exceed  ${payToChanged} payTo-changed  ${dead} dead  ${validatesAfter} validates-after-payment  ${spentLabel} $${formatUsdc(spentAtomic)}  -> ${options.results}`,
  );

  if (!options.dryRun) {
    const seconds = settlementWaitSeconds(results);
    console.log(`waiting ${seconds}s for settlement`);
    await sleep(seconds * 1000);
  }

  if (refused > 0 || sellerFaults > 0 || inputFaults > 0 || failed > 0 || stale > 0 || payToChanged > 0 || dead > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
