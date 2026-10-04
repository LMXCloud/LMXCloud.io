import { baseRpcUrls } from "./rpc.js";
import { selectRotation, valueAt, type AssertionResult, type InputEdge, type ProbeOutcome } from "./verdict.js";

export const CHECK_LEVELS = ["L0", "L1-weak", "L1-strong"] as const;
export type CheckLevel = (typeof CHECK_LEVELS)[number];

export const CHECK_KINDS = [
  "hedera-anchor-cost",
  "robots",
  "verdict-direction",
  "fresh-timestamp",
  "plausible-ranges",
  "search",
  "exact-reply",
  "ens",
  "tweet",
  "sql-guard",
  "eth-call",
  "numeric",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export interface TargetCheck {
  level: CheckLevel;
  name: string;
  summary: string;
  kind: CheckKind;
  tolerance?: number;
  withinSeconds?: number;
  path?: string;
}

const MIRROR = "https://mainnet-public.mirrornode.hedera.com/api/v1/network";
/** Published ConsensusSubmitMessage price, plus the per-byte price, from the Hedera fee table. */
export const HCS_SUBMIT_BASE_USD = 0.0008;
export const HCS_SUBMIT_BYTE_USD = 0.00000068;
export const HCS_SUBMIT_BYTES = 1024;
const CACHE_MAX_SECONDS = 60 * 60;
const HOUJIN_CORPORATIONS = { min: 1_000_000, max: 20_000_000 };
const HOUJIN_PREFECTURES = 47;
const SAFE_SECURITY = new Set(["ok", "pass", "safe", "skipped", "n/a", "na"]);
const RISK_SECURITY = new Set(["avoid", "danger", "fail", "failed", "honeypot", "risky", "high", "critical", "block"]);

export function parseCheck(value: unknown, label: string): TargetCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.level !== "string" || !CHECK_LEVELS.includes(record.level as CheckLevel)) {
    throw new Error(`${label}.level must be L0, L1-weak, or L1-strong`);
  }
  if (typeof record.name !== "string" || record.name.trim() === "") throw new Error(`${label}.name is required`);
  if (typeof record.summary !== "string" || record.summary.trim() === "") throw new Error(`${label}.summary is required`);
  if (typeof record.kind !== "string" || !CHECK_KINDS.includes(record.kind as CheckKind)) {
    throw new Error(`${label}.kind is not a known check`);
  }
  const check: TargetCheck = {
    level: record.level as CheckLevel,
    name: record.name,
    summary: record.summary,
    kind: record.kind as CheckKind,
  };
  if (record.tolerance !== undefined) {
    if (typeof record.tolerance !== "number" || record.tolerance < 0 || record.tolerance > 1) {
      throw new Error(`${label}.tolerance must be a fraction from 0 to 1`);
    }
    check.tolerance = record.tolerance;
  }
  if (record.withinSeconds !== undefined) {
    if (typeof record.withinSeconds !== "number" || record.withinSeconds < 0) {
      throw new Error(`${label}.withinSeconds must be a non-negative number`);
    }
    check.withinSeconds = record.withinSeconds;
  }
  if (record.path !== undefined) {
    if (typeof record.path !== "string" || record.path.trim() === "") throw new Error(`${label}.path is required`);
    check.path = record.path;
  }
  return check;
}

export function slotOf(now: Date, perDay: number): number {
  if (!Number.isInteger(perDay) || perDay < 1) throw new Error("schedule slots must be a positive integer");
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const width = 1440 / perDay;
  return Math.min(perDay - 1, Math.floor(minutes / width));
}

/** Golden case on an ordinary run. A multi-slot schedule rotates, including edge cases. */
export function rotationIndex(length: number, now: Date, perDay = 1): number {
  if (length <= 0) throw new Error("rotation has no cases");
  return selectRotation(Array.from({ length }, (_, index) => index), now, perDay).index;
}

export function formatSchedule(perDay: number): string {
  const width = 24 / perDay;
  return Array.from({ length: perDay }, (_, index) => {
    const hour = Math.floor(index * width);
    return `${String(hour).padStart(2, "0")}:00 UTC`;
  }).join("  ");
}

export function formatCheckList(
  targets: readonly { id?: string; url: string; paid?: boolean; check?: TargetCheck; rotateDaily?: readonly unknown[] }[],
  now: Date,
  perDay = 1,
): string {
  const paid = targets.filter((target) => target.paid === true);
  const lines = ["checks"];
  for (const level of CHECK_LEVELS) {
    const group = paid.filter((target) => target.check?.level === level);
    lines.push(`${level}  ${group.length}`);
    for (const target of group) {
      const check = target.check;
      if (!check) continue;
      const pool = target.rotateDaily?.length ?? 0;
      const today = pool === 0
        ? "standing"
        : perDay <= 1
          ? "golden"
          : `case ${rotationIndex(pool, now, perDay) + 1}/${pool}`;
      lines.push(`  ${target.id ?? target.url}  ${check.name}  ${check.summary}  ${today}`);
    }
  }
  const missing = paid.filter((target) => !target.check);
  if (missing.length > 0) {
    lines.push(`unchecked  ${missing.map((target) => target.id ?? target.url).join(", ")}`);
  }
  return lines.join("\n");
}

export function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= Math.abs(expected) * tolerance;
}

export function hbarPriceUsd(rate: { cent_equivalent: number; hbar_equivalent: number }): number {
  return rate.cent_equivalent / rate.hbar_equivalent / 100;
}

export function publishedHcsSubmitUsd(bytes = HCS_SUBMIT_BYTES): number {
  return HCS_SUBMIT_BASE_USD + bytes * HCS_SUBMIT_BYTE_USD;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberAt(body: unknown, path: string): number | null {
  const looked = valueAt(body, path);
  if (!looked.found) return null;
  if (typeof looked.actual === "number" && Number.isFinite(looked.actual)) return looked.actual;
  if (typeof looked.actual === "string" && looked.actual.trim() !== "" && Number.isFinite(Number(looked.actual))) {
    return Number(looked.actual);
  }
  return null;
}

function checkResult(path: string, pass: boolean, actual: unknown, fault: "seller" | "input"): AssertionResult {
  return { path, op: "check", pass, actual, fault };
}

/** Prefer a ConsensusSubmitMessage row from the mirror fee document. Tinycents are 1e-8 USD. */
export function hcsSubmitUsdFromSchedule(payload: unknown, bytes = HCS_SUBMIT_BYTES): number | null {
  const found: { usd: number; perByte: number }[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const type = typeof record.transaction_type === "string" ? record.transaction_type : "";
    if (/ConsensusSubmitMessage/i.test(type) && !/custom fee/i.test(type)) {
      const usd = typeof record.usd === "number"
        ? record.usd
        : typeof record.tinycents === "number"
          ? record.tinycents / 1e8
          : null;
      const perByte = typeof record.bytes_usd === "number" ? record.bytes_usd : 0;
      if (usd !== null) found.push({ usd, perByte });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  const row = found[0];
  if (!row) return null;
  return row.usd + bytes * row.perByte;
}

interface RobotRule { allow: boolean; path: string }
interface RobotGroup { agents: string[]; rules: RobotRule[]; delay: number | null }

function newRobotGroup(agent: string): RobotGroup {
  return { agents: [agent], rules: [], delay: null };
}

export function parseRobots(text: string): RobotGroup[] {
  const groups: RobotGroup[] = [];
  let current: RobotGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === "user-agent") {
      if (current === null || current.rules.length > 0 || current.delay !== null) {
        current = newRobotGroup(value);
        groups.push(current);
      } else {
        current.agents.push(value);
      }
      continue;
    }
    if (current === null) {
      current = newRobotGroup("*");
      groups.push(current);
    }
    if (key === "allow" || key === "disallow") current.rules.push({ allow: key === "allow", path: value });
    if (key === "crawl-delay") {
      const delay = Number(value);
      current.delay = Number.isFinite(delay) ? delay : null;
    }
  }
  return groups;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleMatches(pattern: string, path: string): boolean {
  if (pattern === "") return true;
  const end = pattern.endsWith("$");
  const body = end ? pattern.slice(0, -1) : pattern;
  const source = `^${body.split("*").map(escapeRegex).join(".*")}${end ? "$" : ""}`;
  return new RegExp(source).test(path);
}

export function robotsDecision(text: string, userAgent: string, resourceUrl: string): { allowed: boolean; crawlDelay: number | null } {
  const groups = parseRobots(text);
  let best: RobotGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      const matches = agent === "*" || userAgent.toLowerCase().includes(agent.toLowerCase());
      if (!matches) continue;
      const len = agent === "*" ? 0 : agent.length;
      if (len > bestLen) {
        best = group;
        bestLen = len;
      }
    }
  }
  const path = new URL(resourceUrl).pathname || "/";
  if (!best) return { allowed: true, crawlDelay: null };
  let winner: { allow: boolean; length: number } | null = null;
  for (const rule of best.rules) {
    if (rule.path === "" && !rule.allow) continue;
    if (!ruleMatches(rule.path, path)) continue;
    const length = rule.path.length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow && !winner.allow)) {
      winner = { allow: rule.allow, length };
    }
  }
  return { allowed: winner ? winner.allow : true, crawlDelay: best.delay };
}

function sameDelay(actual: unknown, expected: number | null): boolean {
  if (expected === null) return actual === null || actual === undefined;
  return typeof actual === "number" && actual === expected;
}

function requestQuery(body: unknown, query: Record<string, string> | undefined): string | null {
  const record = asRecord(body);
  if (record && typeof record.query === "string") return record.query;
  if (query) {
    const value = query.q ?? query.query ?? query.name ?? query.id ?? query.url;
    if (typeof value === "string") return value;
  }
  return null;
}

function collectUrls(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, into));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (typeof record.url === "string" && /^https?:\/\//i.test(record.url)) into.push(record.url);
  for (const child of Object.values(record)) collectUrls(child, into);
}

function collectText(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, into));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const child of Object.values(record)) collectText(child, into);
}

function firstString(body: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const looked = valueAt(body, path);
    if (looked.found && typeof looked.actual === "string") return looked.actual;
  }
  return null;
}

function securityLevel(body: unknown): string | null {
  const level = firstString(body, ["result.factors.security.level", "factors.security.level"]);
  return level === null ? null : level.trim().toLowerCase();
}

function verdictOf(body: unknown): string | null {
  const verdict = firstString(body, ["result.verdict", "verdict"]);
  return verdict === null ? null : verdict.trim().toLowerCase();
}

export function tokenDirectionsDiffer(safe: string | null, risk: string | null): boolean {
  if (!safe || !risk) return false;
  return SAFE_SECURITY.has(safe) && RISK_SECURITY.has(risk) && safe !== risk;
}

function numbersIn(value: unknown, into: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => numbersIn(item, into));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const child of Object.values(record)) numbersIn(child, into);
}

async function readJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { method: "GET", redirect: "follow" });
  if (!response.ok) throw new Error(`reference ${response.status} ${url}`);
  return response.json() as Promise<unknown>;
}

async function hederaCheck(body: unknown, fetchImpl: typeof fetch, tolerance: number): Promise<AssertionResult[]> {
  const hbar = numberAt(body, "value.hbar");
  const usd = numberAt(body, "value.usd");
  try {
    const ratePayload = await readJson(fetchImpl, `${MIRROR}/exchangerate`);
    const feesPayload = await readJson(fetchImpl, `${MIRROR}/fees`);
    const current = asRecord(asRecord(ratePayload)?.current_rate);
    const cents = current && typeof current.cent_equivalent === "number" ? current.cent_equivalent : null;
    const hbars = current && typeof current.hbar_equivalent === "number" ? current.hbar_equivalent : null;
    if (cents === null || hbars === null || hbars === 0) {
      return [checkResult("value.hbar", false, null, "input")];
    }
    const price = hbarPriceUsd({ cent_equivalent: cents, hbar_equivalent: hbars });
    const expectedUsd = hcsSubmitUsdFromSchedule(feesPayload) ?? publishedHcsSubmitUsd();
    const expectedHbar = expectedUsd / price;
    return [
      checkResult("value.usd", usd !== null && withinTolerance(usd, expectedUsd, tolerance), { usd, expectedUsd }, "seller"),
      checkResult("value.hbar", hbar !== null && withinTolerance(hbar, expectedHbar, tolerance), { hbar, expectedHbar }, "seller"),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [checkResult("value.hbar", false, message, "input")];
  }
}

async function robotsCheck(body: unknown, pageUrl: string | null, fetchImpl: typeof fetch, nowMs: number): Promise<AssertionResult[]> {
  const data = valueAt(body, "results.0.data");
  const record = data.found ? asRecord(data.actual) : null;
  const targetUrl = (record && typeof record.url === "string" ? record.url : null) ?? pageUrl;
  const userAgent = record && asRecord(record.proxy) && typeof asRecord(record.proxy)?.userAgent === "string"
    ? String(asRecord(record.proxy)?.userAgent)
    : null;
  if (!targetUrl || !userAgent) return [checkResult("results.0.data", false, null, "seller")];
  let decision: { allowed: boolean; crawlDelay: number | null };
  try {
    const robotsUrl = new URL("/robots.txt", targetUrl).toString();
    const response = await fetchImpl(robotsUrl, { method: "GET", redirect: "follow" });
    if (!response.ok) return [checkResult("robots", false, response.status, "input")];
    decision = robotsDecision(await response.text(), userAgent, targetUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [checkResult("robots", false, message, "input")];
  }
  const cache = record ? asRecord(record.minifetchCache) : null;
  const cachedAt = cache && typeof cache.cachedAt === "string" ? Date.parse(cache.cachedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(cachedAt) ? Math.round((nowMs - cachedAt) / 1000) : null;
  return [
    checkResult("allowed", record?.allowed === decision.allowed, { actual: record?.allowed, expected: decision.allowed }, "seller"),
    checkResult("crawlDelay", sameDelay(record?.crawlDelay, decision.crawlDelay), { actual: record?.crawlDelay ?? null, expected: decision.crawlDelay }, "seller"),
    checkResult("cachedAt", ageSeconds !== null && ageSeconds <= CACHE_MAX_SECONDS, { ageSeconds }, "seller"),
  ];
}

function directionCheck(body: unknown, direction: "safe" | "risk" | undefined): AssertionResult[] {
  const security = securityLevel(body);
  const verdict = verdictOf(body);
  if (!direction) return [checkResult("direction", false, null, "input")];
  const pass = direction === "safe"
    ? security !== null && SAFE_SECURITY.has(security) && verdict !== "avoid"
    : security !== null && RISK_SECURITY.has(security) && verdict !== "ok";
  return [checkResult("verdict", pass, { direction, security, verdict }, "seller")];
}

function freshCheck(body: unknown, path: string, withinSeconds: number, nowMs: number): AssertionResult[] {
  const looked = valueAt(body, path);
  const stamped = looked.found ? Date.parse(String(looked.actual)) : Number.NaN;
  const ageSeconds = Number.isFinite(stamped) ? Math.round((nowMs - stamped) / 1000) : null;
  const pass = ageSeconds !== null && ageSeconds >= -60 && ageSeconds <= withinSeconds;
  return [checkResult(path, pass, { ageSeconds }, "seller")];
}

function houjinCheck(body: unknown): AssertionResult[] {
  const corporations = numberAt(body, "corporation_count");
  const prefectures = numberAt(body, "prefecture_count");
  const names = valueAt(body, "prefectures");
  const listed = names.found && Array.isArray(names.actual) ? names.actual.length : null;
  const numbers: number[] = [];
  numbersIn(body, numbers);
  return [
    checkResult("corporation_count", corporations !== null && corporations >= HOUJIN_CORPORATIONS.min && corporations <= HOUJIN_CORPORATIONS.max, corporations, "seller"),
    checkResult("prefecture_count", prefectures === HOUJIN_PREFECTURES && listed === HOUJIN_PREFECTURES, { prefectures, listed }, "seller"),
    checkResult("numbers", numbers.length > 0 && numbers.every((item) => item >= 0), numbers.length, "seller"),
  ];
}

function numericCheck(body: unknown): AssertionResult[] {
  const numbers: number[] = [];
  numbersIn(body, numbers);
  const pass = numbers.length > 0 && numbers.every((item) => item >= 0);
  return [checkResult("numbers", pass, numbers.length, "seller")];
}

async function searchCheck(body: unknown, query: string | null, fetchImpl: typeof fetch): Promise<AssertionResult[]> {
  if (!query) return [checkResult("query", false, null, "input")];
  const urls: string[] = [];
  collectUrls(body, urls);
  const texts: string[] = [];
  collectText(body, texts);
  const term = query.toLowerCase();
  const mentioned = texts.some((text) => text.toLowerCase().includes(term));
  const heads = await Promise.all(urls.map(async (url) => {
    try {
      await fetchImpl(url, { method: "HEAD", redirect: "follow" });
      return true;
    } catch {
      return false;
    }
  }));
  return [
    checkResult("results.url", urls.length > 0 && heads.every(Boolean), { urls: urls.length, resolved: heads.filter(Boolean).length }, "seller"),
    checkResult("query", mentioned, { query }, "seller"),
  ];
}

function exactReplyCheck(body: unknown): AssertionResult[] {
  const content = firstString(body, ["choices.0.message.content"]);
  const reasoning = firstString(body, ["choices.0.message.reasoning_content"]) ?? "";
  const prompt = numberAt(body, "usage.prompt_tokens");
  const completion = numberAt(body, "usage.completion_tokens");
  const total = numberAt(body, "usage.total_tokens");
  const exact = content !== null && content.trim().toLowerCase() === "pong";
  const visible = (content?.trim().length ?? 0) + reasoning.length;
  const cap = Math.max(8, Math.ceil(visible / 2));
  const usageOk = prompt !== null && completion !== null && total !== null
    && total === prompt + completion
    && completion >= 1
    && completion <= cap;
  return [
    checkResult("choices.0.message.content", exact, content, "seller"),
    checkResult("usage", usageOk, { prompt, completion, total, cap }, "seller"),
  ];
}

function notFoundCheck(body: unknown, kind: "ens" | "tweet"): AssertionResult[] {
  if (kind === "ens") {
    const resolved = valueAt(body, "resolved");
    const address = valueAt(body, "address");
    const fabricated = address.found && address.actual !== null && address.actual !== "";
    const pass = resolved.found && resolved.actual === false && !fabricated;
    return [checkResult("resolved", pass, { resolved: resolved.actual, address: address.actual ?? null }, "seller")];
  }
  const text = valueAt(body, "data.text");
  const data = valueAt(body, "data");
  const empty = !text.found || text.actual === null || text.actual === "";
  const pass = empty && (!data.found || data.actual === null || empty);
  return [checkResult("data.text", pass, text.found ? text.actual : null, "seller")];
}

export function jsonRpcMethod(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const method = (body as { method?: unknown }).method;
  return typeof method === "string" && method.length > 0 ? method : null;
}

function hexEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

async function ethCallCheck(seller: unknown, request: unknown, fetchImpl: typeof fetch, rpcUrl: string | undefined): Promise<AssertionResult[]> {
  const endpoint = rpcUrl && rpcUrl.trim() !== "" ? rpcUrl : baseRpcUrls()[0];
  if (!endpoint) return [checkResult("result", false, "no rpc", "input")];
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return [checkResult("result", false, response.status, "input")];
    const payload: unknown = await response.json();
    const ours = valueAt(payload, "result").actual;
    const theirs = valueAt(seller, "result").actual;
    return [checkResult("result", hexEqual(theirs, ours), { seller: theirs, rpc: ours }, "seller")];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [checkResult("result", false, message, "input")];
  }
}

export interface CheckRequest {
  check: TargetCheck | undefined;
  body: unknown;
  httpStatus: number | null;
  requestBody?: unknown;
  query?: Record<string, string>;
  edge?: InputEdge;
  direction?: "safe" | "risk";
  expect?: "not-found";
  nowMs: number;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
}

export async function runCheck(args: CheckRequest): Promise<AssertionResult[]> {
  const check = args.check;
  if (!check) return [];
  const fetchImpl = args.fetchImpl ?? fetch;
  if (args.expect === "not-found") {
    if (check.kind === "ens" || check.kind === "tweet") return notFoundCheck(args.body, check.kind);
    return [];
  }
  if (args.edge === "unicode" || args.edge === "long") {
    const status = args.httpStatus;
    const pass = status !== null && status < 500;
    return [checkResult("http", pass, status, "seller")];
  }
  if (args.edge === "empty") {
    return [];
  }
  switch (check.kind) {
    case "hedera-anchor-cost":
      return hederaCheck(args.body, fetchImpl, check.tolerance ?? 0.2);
    case "robots":
      return robotsCheck(args.body, requestQuery(undefined, args.query), fetchImpl, args.nowMs);
    case "verdict-direction":
      return directionCheck(args.body, args.direction);
    case "fresh-timestamp":
      return freshCheck(args.body, check.path ?? "data.items.0.launched_at", check.withinSeconds ?? 86_400, args.nowMs);
    case "plausible-ranges":
      return houjinCheck(args.body);
    case "search":
      return searchCheck(args.body, requestQuery(args.requestBody, args.query), fetchImpl);
    case "exact-reply":
      return exactReplyCheck(args.body);
    case "ens":
    case "tweet":
    case "sql-guard":
      return [];
    case "eth-call":
      if (jsonRpcMethod(args.requestBody) === "eth_blockNumber") return [];
      return ethCallCheck(args.body, args.requestBody, fetchImpl, args.rpcUrl);
    case "numeric":
      return numericCheck(args.body);
    default:
      return [checkResult("check", false, check.kind, "input")];
  }
}

export function notFoundPassed(results: readonly AssertionResult[], expect: "not-found" | undefined): boolean {
  if (expect !== "not-found") return false;
  return results.some((item) => item.op === "check") && results.every((item) => item.op !== "check" || item.pass);
}

/**
 * Edge and not-found inputs are honest documented cases.
 * A 4xx on unicode or long input is handled. A 5xx is not.
 * An empty query must be an empty 2xx. A not-found must not be a 500 or a fabricated value.
 */
export function applyEdge(args: {
  edge?: InputEdge;
  expect?: "not-found";
  outcome: ProbeOutcome | null;
  httpStatus: number | null;
  emptyPayload: boolean;
  nonempty: boolean;
  notFoundPass: boolean;
}): ProbeOutcome | null {
  const http = args.httpStatus;
  if (args.expect === "not-found" && http !== null) {
    if (http >= 500) return "server_error_after_payment";
    return args.notFoundPass ? "pass" : "assertion_failed";
  }
  if (!args.edge || http === null) return args.outcome;
  if (args.edge === "unicode" || args.edge === "long") {
    if (http >= 500) return "server_error_after_payment";
    return "pass";
  }
  if (args.edge === "empty") {
    if (http >= 500) return "server_error_after_payment";
    if (http >= 200 && http < 300 && (args.emptyPayload || !args.nonempty)) return "pass";
    if (http >= 200 && http < 300) return "assertion_failed";
  }
  return args.outcome;
}

export function levelGroups(
  calls: readonly { role: string; checkLevel?: CheckLevel | null; id: string; checkName?: string | null; outcome: string | null; fault: string | null }[],
): { level: CheckLevel; rows: { id: string; checkName: string | null; outcome: string | null; fault: string | null }[] }[] {
  return CHECK_LEVELS.map((level) => ({
    level,
    rows: calls
      .filter((call) => call.role === "probe" && call.checkLevel === level)
      .map((call) => ({
        id: call.id,
        checkName: call.checkName ?? null,
        outcome: call.outcome,
        fault: call.fault,
      })),
  }));
}
