import { cheapestLevel1, type ProbeResult, type ProbeTarget } from "./probe.js";
import {
  BASE_NETWORK,
  BASE_USDC,
  formatUsdc,
  MAX_CALL_ATOMIC,
  usdcToAtomic,
} from "./price.js";
import { declaredRequiredInput } from "./schema.js";
import { liveOffer } from "./drift.js";
import { selectRotation } from "./verdict.js";

/** A dry run older than this cannot clear a paid target. */
export const DRY_RUN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type PreflightStatus = "ready" | "blocked";
export type PreflightKind = "target" | "wallet" | "canary" | "spend";

export interface PreflightRow {
  kind: PreflightKind;
  target: string;
  status: PreflightStatus;
  reason: string;
}

export interface PreflightWallet {
  address: string | null;
  balanceAtomic: bigint | null;
  /** Shown when the address or balance could not be read. Must not contain the key. */
  error: string | null;
}

export interface PreflightReport {
  rows: PreflightRow[];
  ok: boolean;
}

export interface PreflightInput {
  targets: readonly ProbeTarget[];
  results: readonly ProbeResult[];
  now: Date;
  spendCapAtomic: bigint;
  wallet: PreflightWallet;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function targetLabel(target: ProbeTarget): string {
  return target.id ?? target.url;
}

function isV1Payment(value: unknown): boolean {
  return isRecord(value) && value.x402Version === 1;
}

function isV2Payment(value: unknown): boolean {
  return isRecord(value) && value.x402Version === 2 && Array.isArray(value.accepts) && value.accepts.length > 0;
}

/** Probe rows from the newest dry run. Older runs are ignored. */
export function latestDryProbes(results: readonly ProbeResult[]): Map<string, ProbeResult> {
  const probes = results.filter((result) => result.dryRun === true && result.role === "probe");
  const identified = probes.filter((result) => result.runId);
  const pool = identified.length > 0 ? identified : probes;
  let newest: ProbeResult | null = null;
  for (const result of pool) {
    if (!newest || result.timestamp >= newest.timestamp) newest = result;
  }
  if (!newest) return new Map();
  const runId = newest.runId;
  const map = new Map<string, ProbeResult>();
  for (const result of pool) {
    if (identified.length > 0 && result.runId !== runId) continue;
    const current = map.get(result.id);
    if (!current || result.timestamp >= current.timestamp) map.set(result.id, result);
  }
  return map;
}

function requestShape(target: ProbeTarget, now: Date): ProbeTarget {
  if (!target.rotateDaily || target.rotateDaily.length === 0) return target;
  const picked = selectRotation(target.rotateDaily, now);
  return {
    ...target,
    body: picked.item.body !== undefined ? picked.item.body : target.body,
    query: picked.item.query ?? target.query,
  };
}

function suppliedQuery(target: ProbeTarget): Set<string> {
  const names = new Set<string>();
  try {
    const url = new URL(target.url);
    for (const [key, value] of url.searchParams) {
      if (value.trim() !== "") names.add(key);
    }
  } catch {
    // The target URL is validated at load. A bad URL supplies no query.
  }
  if (target.query) {
    for (const [key, value] of Object.entries(target.query)) {
      if (value.trim() === "") names.delete(key);
      else names.add(key);
    }
  }
  return names;
}

function valueSupplied(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/** Top-level body fields, plus a required name nested under the JSON body. */
function suppliedBody(target: ProbeTarget, required: readonly string[]): Set<string> {
  const names = new Set<string>();
  if (!isRecord(target.body)) return names;
  for (const [key, value] of Object.entries(target.body)) {
    if (valueSupplied(value)) names.add(key);
  }
  for (const name of required) {
    if (names.has(name)) continue;
    if (bodyHas(target.body, name, 0)) names.add(name);
  }
  return names;
}

function bodyHas(value: unknown, name: string, depth: number): boolean {
  if (!isRecord(value) || depth > 4) return false;
  if (Object.prototype.hasOwnProperty.call(value, name) && valueSupplied(value[name])) return true;
  return Object.values(value).some((child) => bodyHas(child, name, depth + 1));
}

function requiredPathNames(payment: unknown): string[] {
  if (!isRecord(payment) || !isRecord(payment.extensions) || !isRecord(payment.extensions.bazaar)) return [];
  const bazaar = payment.extensions.bazaar;
  const schema = isRecord(bazaar.schema) ? bazaar.schema : undefined;
  const input = schema && isRecord(schema.properties) && isRecord(schema.properties.input)
    ? schema.properties.input
    : undefined;
  const properties = input && isRecord(input.properties) ? input.properties : undefined;
  const pathSchema = properties && isRecord(properties.pathParams) ? properties.pathParams : undefined;
  if (pathSchema && Array.isArray(pathSchema.required)) {
    return pathSchema.required.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  return [];
}

function challengeProblems(result: ProbeResult): string[] {
  if (result.httpStatus === 404 || result.finding === "listed route is dead") return ["404"];
  if (result.httpStatus !== null && result.httpStatus >= 300 && result.httpStatus < 400) return ["redirect loop"];
  if (result.refusal === "v1-unsupported" || isV1Payment(result.paymentRequirements)) return ["v1"];
  if (result.httpStatus !== 402) {
    return [result.error ?? `http ${result.httpStatus ?? "none"}`];
  }
  if (!isV2Payment(result.paymentRequirements)) {
    return [result.error ?? "402 is not x402 v2"];
  }
  return [];
}

function priceProblems(target: ProbeTarget, result: ProbeResult): string[] {
  const offer = liveOffer(result.paymentRequirements);
  const problems: string[] = [];
  const baseUsdc = offer.network === BASE_NETWORK
    && offer.asset !== null
    && offer.asset.toLowerCase() === BASE_USDC;
  if (!baseUsdc) problems.push("not Base USDC");
  if (offer.scheme !== "exact") problems.push(`scheme ${offer.scheme ?? "missing"}`);
  if (offer.priceAtomic === null) problems.push("no quoted price");
  else if (offer.priceAtomic > MAX_CALL_ATOMIC) problems.push("quoted price is over $0.05");
  if (target.listedPriceUsdc === null) problems.push("listed price unknown");
  else if (offer.priceAtomic !== null && offer.priceAtomic !== usdcToAtomic(target.listedPriceUsdc)) {
    problems.push("quoted price differs from listed");
  }
  return problems;
}

function inputProblems(target: ProbeTarget, result: ProbeResult, now: Date): string[] {
  const problems: string[] = [];
  const active = requestShape(target, now);
  const method = active.method.toUpperCase();
  const writesBody = method !== "GET" && method !== "HEAD";
  if (result.refusal === "no-input" || (writesBody && active.body === undefined)) problems.push("no-input");
  if (!isV2Payment(result.paymentRequirements)) return problems;
  const declared = declaredRequiredInput(result.paymentRequirements);
  const query = suppliedQuery(active);
  const body = suppliedBody(active, declared.body);
  const missingQuery = declared.query.filter((name) => !query.has(name));
  const missingBody = declared.body.filter((name) => !body.has(name));
  if (missingQuery.length > 0) problems.push(`missing required query ${missingQuery.join(", ")}`);
  if (missingBody.length > 0) problems.push(`missing required body ${missingBody.join(", ")}`);
  const missingPath = requiredPathNames(result.paymentRequirements).filter((name) => (
    active.url.includes(`:${name}`) || active.url.includes(`{${name}}`)
  ));
  if (missingPath.length > 0) problems.push(`missing required path ${missingPath.join(", ")}`);
  return problems;
}

function assessTarget(target: ProbeTarget, result: ProbeResult | undefined, now: Date): PreflightRow {
  const label = targetLabel(target);
  if (!result) return { kind: "target", target: label, status: "blocked", reason: "no dry-run result" };

  const problems: string[] = [];
  const stamped = Date.parse(result.timestamp);
  if (!Number.isFinite(stamped) || now.getTime() - stamped >= DRY_RUN_MAX_AGE_MS) {
    problems.push("dry run is older than 2 hours");
  }
  const challenge = challengeProblems(result);
  problems.push(...challenge);
  if (challenge.length === 0) {
    problems.push(...priceProblems(target, result));
    if (result.listingDrift.some((item) => item.field === "payTo")) problems.push("payTo changed");
    problems.push(...inputProblems(target, result, now));
  }
  if (problems.length === 0) return { kind: "target", target: label, status: "ready", reason: "" };
  return { kind: "target", target: label, status: "blocked", reason: problems.join("; ") };
}

function walletRow(wallet: PreflightWallet, spendCapAtomic: bigint): PreflightRow {
  if (wallet.error || !wallet.address) {
    return {
      kind: "wallet",
      target: wallet.address ? `wallet ${wallet.address}` : "wallet",
      status: "blocked",
      reason: wallet.error ?? "LMX_LABS_WALLET_PRIVATE_KEY is required",
    };
  }
  const label = `wallet ${wallet.address}`;
  if (wallet.balanceAtomic === null) {
    return { kind: "wallet", target: label, status: "blocked", reason: "Base USDC balance was not read" };
  }
  const balance = formatUsdc(wallet.balanceAtomic);
  const cap = formatUsdc(spendCapAtomic);
  if (wallet.balanceAtomic < spendCapAtomic) {
    return {
      kind: "wallet",
      target: label,
      status: "blocked",
      reason: `balance $${balance} is below spend cap $${cap}`,
    };
  }
  return {
    kind: "wallet",
    target: label,
    status: "ready",
    reason: `balance $${balance} >= cap $${cap}`,
  };
}

function pricedAtomic(target: ProbeTarget): bigint | null {
  if (target.listedPriceUsdc === null) return null;
  return usdcToAtomic(target.listedPriceUsdc);
}

function spendRow(
  paid: readonly ProbeTarget[],
  canary: ProbeTarget | null,
  spendCapAtomic: bigint,
): PreflightRow {
  const unknown = paid.filter((target) => target.listedPriceUsdc === null).map(targetLabel);
  if (unknown.length > 0) {
    return {
      kind: "spend",
      target: "spend",
      status: "blocked",
      reason: `listed price unknown for ${unknown.join(", ")}`,
    };
  }
  const targetsAtomic = paid.reduce((sum, target) => sum + (pricedAtomic(target) ?? 0n), 0n);
  const canaryAtomic = canary ? pricedAtomic(canary) ?? 0n : 0n;
  const rechecksAtomic = targetsAtomic;
  const expected = targetsAtomic + canaryAtomic + rechecksAtomic;
  const parts = `targets $${formatUsdc(targetsAtomic)} + canary $${formatUsdc(canaryAtomic)} + rechecks $${formatUsdc(rechecksAtomic)}`;
  if (expected > spendCapAtomic) {
    return {
      kind: "spend",
      target: "spend",
      status: "blocked",
      reason: `expected $${formatUsdc(expected)} exceeds cap $${formatUsdc(spendCapAtomic)} (${parts})`,
    };
  }
  return {
    kind: "spend",
    target: "spend",
    status: "ready",
    reason: `expected $${formatUsdc(expected)} vs cap $${formatUsdc(spendCapAtomic)} (${parts})`,
  };
}

/**
 * Readiness of every paid target, plus the wallet, canary, and worst-case spend.
 * Does not sign, fetch, or read a private key.
 */
export function buildPreflight(input: PreflightInput): PreflightReport {
  const paid = input.targets.filter((target) => target.paid === true);
  const probes = latestDryProbes(input.results);
  const targetRows = paid.map((target) => assessTarget(target, probes.get(targetLabel(target)), input.now));
  const blocked = new Map(targetRows.filter((row) => row.status === "blocked").map((row) => [row.target, row.reason]));
  const canary = cheapestLevel1(paid);
  const canaryReason = canary
    ? blocked.get(targetLabel(canary))
    : undefined;
  const canaryRow: PreflightRow = canary
    ? {
        kind: "canary",
        target: `canary ${targetLabel(canary)}`,
        status: canaryReason ? "blocked" : "ready",
        reason: canaryReason ? `cheapest L1; ${canaryReason}` : "cheapest L1",
      }
    : { kind: "canary", target: "canary", status: "ready", reason: "no level-1 paid target" };
  const rows = [
    ...targetRows,
    walletRow(input.wallet, input.spendCapAtomic),
    canaryRow,
    spendRow(paid, canary, input.spendCapAtomic),
  ];
  return { rows, ok: rows.every((row) => row.status === "ready") };
}

export function formatPreflightTable(rows: readonly PreflightRow[]): string {
  const width = Math.max("target".length, ...rows.map((row) => row.target.length));
  const lines = [`${"target".padEnd(width)}  status   reason`];
  for (const row of rows) {
    lines.push(`${row.target.padEnd(width)}  ${row.status.padEnd(7)}  ${row.reason}`);
  }
  return lines.join("\n");
}

/**
 * x402trust rows whose listing URL is not confirmed yet.
 * A 404 or a website response is not a seller finding.
 */
const URL_UNVERIFIED_REASON: Record<string, string> = {
  "ochinimus.app-get-api-liquidations": "url-unverified: 404",
  "theaslangroupllc.com-get-api-evmtoken": "url-unverified: 404",
  "underscoredone.com-get-cpi": "url-unverified: 404",
  "aidress.ai-get-pay-agent-edgar": "url-unverified: serves website HTML, not x402",
};

/**
 * Set each blocked paid target to paid:false and record why.
 * Wallet, canary, and spend rows are not targets.
 */
export function dropBlockedTargets(
  raw: readonly unknown[],
  rows: readonly PreflightRow[],
): { targets: unknown[]; dropped: string[] } {
  const reasons = new Map(
    rows
      .filter((row) => row.kind === "target" && row.status === "blocked")
      .map((row) => [row.target, row.reason]),
  );
  const dropped: string[] = [];
  const targets = raw.map((item) => {
    if (!isRecord(item)) return item;
    const label = typeof item.id === "string" && item.id !== ""
      ? item.id
      : typeof item.url === "string"
        ? item.url
        : "";
    const blockedReason = reasons.get(label);
    if (!blockedReason) return item;
    dropped.push(label);
    return { ...item, paid: false, unpaidReason: URL_UNVERIFIED_REASON[label] ?? blockedReason };
  });
  return { targets, dropped };
}
