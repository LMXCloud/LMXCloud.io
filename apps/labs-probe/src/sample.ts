import type { DiscoveryPage } from "./import.js";
import { resourceToListing, type ImportedTarget } from "./import.js";
import type { ProbeResult, ProbeTarget } from "./probe.js";
import { usdcToAtomic } from "./price.js";
import { declaredRequiredInput } from "./schema.js";

/** Default sample round pays listings above zero and at or under this price. */
export const SAMPLE_MAX_USDC = 0.02;

/** Higher-value round. Inclusive on both ends. */
export const SAMPLE_R3_MIN_USDC = 0.01;
export const SAMPLE_R3_MAX_USDC = 0.05;

export const SAMPLE_CATEGORIES = [
  "ai-generation",
  "scraping/extraction",
  "search/research",
  "finance/market-data",
  "onchain/crypto-data",
  "other",
] as const;

export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

const NAMED_CATEGORIES = SAMPLE_CATEGORIES.filter((category) => category !== "other");

export const LMX_HOST = "api.lmxcloud.io";

export const EXCLUSION_REASONS = [
  "invalid",
  "not-v2",
  "not-exact-base-usdc",
  "price",
  "missing-input",
  "missing-output",
  "lmxcloud",
  "pilot-host",
  "tested-host",
  "side-effect",
  "async",
  "duplicate-host",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type ExclusionCounts = Record<ExclusionReason, number>;

const SIDE_EFFECT = /\b(buy|purchase|order|send|transfer|mint|deploy|provision|create|sms|email|call|phone|post-to|publish|trade|swap|bridge|book|reserve|reservation|schedule|register|subscribe|apply|link|claim)\b/i;

const QUEUE_STATUS = /^(pending|queued|queue|processing|in_progress|in-progress|submitted|accepted|running|started|waiting)$/i;
const JOB_KEY = /^(job_?id|jobid|task_?id|taskid|queue_?id|queueid|queue)$/i;
const HANDLE_KEY = /^(id|job_?id|jobid|task_?id|taskid|status|state|queue|queue_?id|queueid|message|created_?at|createdat|updated_?at|updatedat|eta|progress|request_?id|requestid)$/i;
const PAYLOAD_KEY = /^(data|result|results|output|content|body|items|text|value|payload|response|answer|choices)$/i;

const WRITE_METHOD = new Set(["POST", "PUT", "PATCH"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function emptyExclusions(): ExclusionCounts {
  return {
    invalid: 0,
    "not-v2": 0,
    "not-exact-base-usdc": 0,
    price: 0,
    "missing-input": 0,
    "missing-output": 0,
    lmxcloud: 0,
    "pilot-host": 0,
    "tested-host": 0,
    "side-effect": 0,
    async: 0,
    "duplicate-host": 0,
  };
}

/** FNV-1a over the seed string. The same seed always rebuilds the same sample. */
export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = next[index]!;
    next[index] = next[swap]!;
    next[swap] = current;
  }
  return next;
}

export function hostOfUrl(resource: string): string | null {
  try {
    return new URL(resource).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts that already appear on a stored result, paid or dry-run. */
export function hostsFromResults(results: readonly { url?: string }[]): Set<string> {
  const hosts = new Set<string>();
  for (const result of results) {
    if (typeof result.url !== "string") continue;
    const host = hostOfUrl(result.url);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function pilotHosts(targets: readonly unknown[]): Set<string> {
  const hosts = new Set<string>();
  for (const item of targets) {
    if (!isRecord(item) || typeof item.url !== "string") continue;
    const host = hostOfUrl(item.url);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * The advertised output is a job handle: a job id, a queue, or a status that is not a result.
 * A payload field next to a finished status stays eligible.
 */
export function isAsyncJobExample(example: unknown): boolean {
  if (!isRecord(example)) return false;
  const keys = Object.keys(example);
  if (keys.length === 0) return false;
  const hasJob = keys.some((key) => JOB_KEY.test(key));
  const hasPayload = keys.some((key) => PAYLOAD_KEY.test(key));
  const status = example.status ?? example.state;
  const queued = typeof status === "string" && QUEUE_STATUS.test(status.trim());
  if (hasPayload && !queued) return false;
  if (queued && !hasPayload) return true;
  if (hasJob && !hasPayload && keys.every((key) => HANDLE_KEY.test(key))) return true;
  return false;
}

function listingBlurb(resource: unknown, url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const parts = [path];
  if (isRecord(resource) && typeof resource.description === "string") parts.push(resource.description);
  const info = isRecord(resource) && isRecord(resource.extensions) && isRecord(resource.extensions.bazaar)
    && isRecord(resource.extensions.bazaar.info)
    ? resource.extensions.bazaar.info
    : undefined;
  if (info && typeof info.description === "string") parts.push(info.description);
  return parts.join("\n");
}

const CATEGORY_RULES: readonly { category: SampleCategory; pattern: RegExp }[] = [
  { category: "ai-generation", pattern: /\b(llm|chat|completions?|embeddings?|image|audio|speech|tts|whisper|transcri\w*|summar\w*|gpt|diffusion|generat\w*|inference|prompt|vision)\b/i },
  { category: "scraping/extraction", pattern: /\b(scrap\w*|crawl\w*|extract\w*|web-?fetch|readability|html|browser)\b/i },
  { category: "search/research", pattern: /\b(search|research|serp|news)\b/i },
  { category: "finance/market-data", pattern: /\b(stock|forex|ohlcv|candles?|ticker|market|trading|portfolio|equity|quote|prices?)\b/i },
  { category: "onchain/crypto-data", pattern: /\b(rpc|on-?chain|blockchain|wallets?|ens|nft|tokens?|transactions?|blocks?|crypto|defi|mempool|gas)\b/i },
];

/** First matching path or description rule. Unmatched listings are "other". */
export function classifyListing(resource: unknown, url: string): SampleCategory {
  const blurb = listingBlurb(resource, url);
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(blurb)) return rule.category;
  }
  return "other";
}

export function emptyQueues(): Record<SampleCategory, SampleCandidate[]> {
  return {
    "ai-generation": [],
    "scraping/extraction": [],
    "search/research": [],
    "finance/market-data": [],
    "onchain/crypto-data": [],
    other: [],
  };
}

function unsubstitutedPath(url: string): boolean {
  try {
    return /\{[^}]+\}|\/:[A-Za-z_][\w-]*/.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

/** True when the listing example covers every required input, or the call needs none. */
export function hasCallableInput(resource: unknown, target: ImportedTarget): boolean {
  if (unsubstitutedPath(target.url)) return false;
  const required = declaredRequiredInput(resource);
  const bodyKeys = isRecord(target.body) ? Object.keys(target.body) : [];
  const queryKeys = target.query ? Object.keys(target.query) : [];
  if (!required.body.every((name) => bodyKeys.includes(name))) return false;
  if (!required.query.every((name) => queryKeys.includes(name))) return false;
  const hasExample = target.body !== undefined || queryKeys.length > 0;
  const noRequired = required.body.length === 0 && required.query.length === 0;
  if (WRITE_METHOD.has(target.method.toUpperCase()) && target.body === undefined) return false;
  return hasExample || noRequired;
}

function hasGradeableOutput(target: ImportedTarget): boolean {
  return target.outputExample !== undefined || target.listingOutputSchema !== undefined;
}

export interface SampleCandidate {
  target: ImportedTarget;
  host: string;
  category: SampleCategory;
}

function exclusionOf(
  resource: unknown,
  pilot: ReadonlySet<string>,
  tested: ReadonlySet<string>,
  minAtomic: bigint,
  maxAtomic: bigint,
): { reason: ExclusionReason } | { candidate: SampleCandidate } {
  const target = resourceToListing(resource);
  if (!target) return { reason: "invalid" };
  if (target.x402Version !== 2) return { reason: "not-v2" };
  const host = hostOfUrl(target.url);
  if (!host) return { reason: "invalid" };
  if (target.scheme !== "exact" || target.listedPriceUsdc === null || target.importStatus === "price-unknown") {
    return { reason: "not-exact-base-usdc" };
  }
  const atomic = usdcToAtomic(target.listedPriceUsdc);
  if (atomic <= 0n || atomic < minAtomic || atomic > maxAtomic) return { reason: "price" };
  if (!hasCallableInput(resource, target)) return { reason: "missing-input" };
  if (!hasGradeableOutput(target)) return { reason: "missing-output" };
  if (host === LMX_HOST) return { reason: "lmxcloud" };
  if (tested.has(host)) return { reason: "tested-host" };
  if (pilot.has(host)) return { reason: "pilot-host" };
  if (SIDE_EFFECT.test(listingBlurb(resource, target.url))) return { reason: "side-effect" };
  if (isAsyncJobExample(target.outputExample)) return { reason: "async" };
  return { candidate: { target, host, category: classifyListing(resource, target.url) } };
}

function keepOnePerHost(candidates: SampleCandidate[], counts: ExclusionCounts): SampleCandidate[] {
  const best = new Map<string, SampleCandidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.host);
    if (!current || prefer(candidate, current) < 0) {
      if (current) counts["duplicate-host"] += 1;
      best.set(candidate.host, candidate);
      continue;
    }
    counts["duplicate-host"] += 1;
  }
  return [...best.values()];
}

function prefer(left: SampleCandidate, right: SampleCandidate): number {
  const leftPrice = left.target.listedPriceUsdc ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.target.listedPriceUsdc ?? Number.POSITIVE_INFINITY;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return left.target.url.localeCompare(right.target.url);
}

export interface SampleDraw {
  catalog: number;
  eligible: SampleCandidate[];
  selected: SampleCandidate[];
  queue: SampleCandidate[];
  /** Remainder after the stratified draw, used to replace a dry-run miss in that category. */
  queues: Record<SampleCategory, SampleCandidate[]>;
  pools: Record<SampleCategory, number>;
  stratified: boolean;
  exclusions: ExclusionCounts;
  seed: string;
}

function poolCounts(eligible: readonly SampleCandidate[]): Record<SampleCategory, number> {
  const pools = Object.fromEntries(SAMPLE_CATEGORIES.map((category) => [category, 0])) as Record<SampleCategory, number>;
  for (const candidate of eligible) pools[candidate.category] += 1;
  return pools;
}

/**
 * About n/5 from each named category. A short category is filled from "other",
 * then from whatever named category still has hosts left.
 */
export function stratifySample(
  eligible: readonly SampleCandidate[],
  n: number,
  random: () => number,
): { selected: SampleCandidate[]; queues: Record<SampleCategory, SampleCandidate[]> } {
  const grouped = emptyQueues();
  for (const candidate of eligible) grouped[candidate.category].push(candidate);
  const shuffled = emptyQueues();
  for (const category of SAMPLE_CATEGORIES) shuffled[category] = shuffle(grouped[category], random);
  const quota = Math.floor(n / NAMED_CATEGORIES.length);
  const selected: SampleCandidate[] = [];
  const queues = emptyQueues();
  for (const category of NAMED_CATEGORIES) {
    const pool = shuffled[category];
    const take = Math.min(quota, pool.length);
    selected.push(...pool.slice(0, take));
    queues[category] = pool.slice(take);
  }
  const need = Math.max(0, n - selected.length);
  selected.push(...shuffled.other.slice(0, need));
  queues.other = shuffled.other.slice(need);
  for (const category of NAMED_CATEGORIES) {
    while (selected.length < n && queues[category].length > 0) {
      const next = queues[category].shift();
      if (next) selected.push(next);
    }
  }
  return { selected: selected.slice(0, n), queues };
}

/**
 * Page-independent eligibility, then one endpoint per host, then a seeded shuffle.
 * `selected` is the first n. `queue` is the rest, in the same shuffle order, for dry-run replacements.
 */
export function drawSample(args: {
  resources: readonly unknown[];
  pilotHosts: ReadonlySet<string>;
  testedHosts?: ReadonlySet<string>;
  n: number;
  seed: string;
  /** Inclusive lower bound. Omitted means any positive price. */
  minUsdc?: number;
  /** Inclusive upper bound. Defaults to SAMPLE_MAX_USDC. */
  maxUsdc?: number;
  stratify?: boolean;
}): SampleDraw {
  if (!Number.isInteger(args.n) || args.n <= 0) {
    throw new Error(`sample size must be a positive integer, got ${args.n}`);
  }
  const exclusions = emptyExclusions();
  const minAtomic = args.minUsdc === undefined ? 0n : usdcToAtomic(args.minUsdc);
  const maxAtomic = usdcToAtomic(args.maxUsdc ?? SAMPLE_MAX_USDC);
  const tested = args.testedHosts ?? new Set<string>();
  const candidates: SampleCandidate[] = [];
  for (const resource of args.resources) {
    const judged = exclusionOf(resource, args.pilotHosts, tested, minAtomic, maxAtomic);
    if ("reason" in judged) {
      exclusions[judged.reason] += 1;
      continue;
    }
    candidates.push(judged.candidate);
  }
  const eligible = keepOnePerHost(candidates, exclusions);
  const pools = poolCounts(eligible);
  if (args.stratify) {
    const stratified = stratifySample(eligible, args.n, mulberry32(hashSeed(args.seed)));
    return {
      catalog: args.resources.length,
      eligible,
      selected: stratified.selected,
      queue: [],
      queues: stratified.queues,
      pools,
      stratified: true,
      exclusions,
      seed: args.seed,
    };
  }
  const ordered = shuffle(eligible, mulberry32(hashSeed(args.seed)));
  return {
    catalog: args.resources.length,
    eligible,
    selected: ordered.slice(0, args.n),
    queue: ordered.slice(args.n),
    queues: emptyQueues(),
    pools,
    stratified: false,
    exclusions,
    seed: args.seed,
  };
}

export function toProbeTarget(imported: ImportedTarget, category?: SampleCategory): ProbeTarget {
  return {
    id: imported.id,
    url: imported.url,
    ...(category ? { sampleCategory: category } : {}),
    method: imported.method,
    listedPriceUsdc: imported.listedPriceUsdc,
    paid: true,
    source: "bazaar",
    payTo: imported.payTo,
    scheme: imported.scheme,
    asset: imported.asset,
    network: imported.network,
    mimeType: imported.mimeType,
    x402Version: imported.x402Version,
    ...(imported.body !== undefined ? { body: imported.body } : {}),
    ...(imported.query ? { query: imported.query } : {}),
    ...(imported.outputExample !== undefined ? { outputExample: imported.outputExample } : {}),
    ...(imported.listingOutputSchema ? { listingOutputSchema: imported.listingOutputSchema } : {}),
    level: 0,
  };
}

/**
 * Dry-run failures that must be replaced: not a 402, a price mismatch, v1, or a missing input.
 * A clean 402 whose quote matches is ready to pay.
 */
export function dryRunFailure(result: ProbeResult): string | null {
  if (result.refusal === "v1-unsupported") return "v1";
  if (result.refusal === "no-input" || result.outcome === "input_fault") return "missing input";
  if (result.refusal && /differs from listed|exceeds the \$0\.05/.test(result.refusal)) return "price mismatch";
  if (result.httpStatus !== 402) {
    return result.error ?? `not 402 (${result.httpStatus ?? "no response"})`;
  }
  if (result.refusal) return result.refusal;
  if (result.error) return result.error;
  return null;
}

export interface Replacement {
  droppedId: string;
  droppedUrl: string;
  reason: string;
  replacementId: string | null;
  replacementUrl: string | null;
}

export async function collectCatalog(options: {
  fetchPage: (offset: number, limit: number) => Promise<DiscoveryPage>;
  pageSize?: number;
  concurrency?: number;
  onPage?: (info: { offset: number; total: number }) => void;
}): Promise<unknown[]> {
  const pageSize = options.pageSize ?? 100;
  const concurrency = options.concurrency ?? 2;
  const first = await options.fetchPage(0, pageSize);
  const firstItems = Array.isArray(first.items) ? first.items : [];
  const total = typeof first.pagination?.total === "number" ? first.pagination.total : firstItems.length;
  options.onPage?.({ offset: 0, total });
  const pages = new Map<number, unknown[]>();
  pages.set(0, firstItems);
  const offsets: number[] = [];
  for (let offset = pageSize; offset < total; offset += pageSize) offsets.push(offset);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < offsets.length) {
      const offset = offsets[cursor]!;
      cursor += 1;
      const page = await options.fetchPage(offset, pageSize);
      const items = Array.isArray(page.items) ? page.items : [];
      pages.set(offset, items);
      options.onPage?.({ offset, total });
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
    }
  };
  const workers = Math.min(concurrency, Math.max(offsets.length, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  const resources: unknown[] = [];
  for (const offset of [0, ...offsets]) {
    resources.push(...(pages.get(offset) ?? []));
  }
  return resources;
}

export function exclusionSummary(counts: ExclusionCounts): string {
  return EXCLUSION_REASONS
    .filter((reason) => counts[reason] > 0)
    .map((reason) => `${reason} ${counts[reason]}`)
    .join("  ");
}

export function poolSummary(pools: Record<SampleCategory, number>): string {
  return SAMPLE_CATEGORIES.map((category) => `${category} ${pools[category]}`).join("  ");
}

export interface SampleRow {
  host: string;
  category: string;
  endpoint: string;
  price: string;
  httpStatus: string;
  outcome: string;
  severity: string;
  fault: string;
  chain: string;
  latency: string;
  warnings: string;
}

const SAMPLE_COLUMNS: { header: string; key: keyof SampleRow; max: number }[] = [
  { header: "host", key: "host", max: 40 },
  { header: "category", key: "category", max: 22 },
  { header: "endpoint", key: "endpoint", max: 56 },
  { header: "price", key: "price", max: 12 },
  { header: "http", key: "httpStatus", max: 6 },
  { header: "outcome", key: "outcome", max: 28 },
  { header: "severity", key: "severity", max: 10 },
  { header: "fault", key: "fault", max: 14 },
  { header: "on-chain", key: "chain", max: 14 },
  { header: "latency", key: "latency", max: 10 },
  { header: "warnings", key: "warnings", max: 80 },
];

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function formatSampleTable(rows: readonly SampleRow[]): string {
  const widths = SAMPLE_COLUMNS.map((column) => Math.max(
    column.header.length,
    ...rows.map((row) => clip(row[column.key], column.max).length),
  ));
  const line = (cells: string[]): string => cells.map((cell, index) => clip(cell, SAMPLE_COLUMNS[index]!.max).padEnd(widths[index]!)).join("  ");
  return [line(SAMPLE_COLUMNS.map((column) => column.header)), ...rows.map((row) => line(SAMPLE_COLUMNS.map((column) => row[column.key])))].join("\n");
}

export function endpointLabel(target: { method: string; url: string }): string {
  try {
    const url = new URL(target.url);
    const path = `${url.pathname}${url.search}` || "/";
    return `${target.method.toUpperCase()} ${path}`;
  } catch {
    return `${target.method.toUpperCase()} ${target.url}`;
  }
}
