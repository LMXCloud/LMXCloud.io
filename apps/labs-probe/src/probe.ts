import { createHash } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { createPublicClient } from "viem";
import { base } from "viem/chains";

import { isSignedPayment, type PaymentAuth } from "./auth.js";
import { applyEdge, jsonRpcMethod, notFoundPassed, parseCheck, rotationIndex, runCheck, type TargetCheck } from "./checks.js";
import { facilitatorOf, headerValueShape, identifyingHeaders, sellerErrorText, type PaymentAttempt } from "./payment-attempt.js";
import { compareListing, liveOffer, type ListingDrift, type RecordedListingFields } from "./drift.js";
import {
  decidePayment,
  formatUsdc,
  parseQuotedAtomic,
  spendCapReason,
  usdcToAtomic,
  type PriceDecision,
} from "./price.js";
import { baseTransport, retryRead } from "./rpc.js";
import { declaredRequiredInput, listingOutputSchema, matchesSchema, type DeclaredInput, type JsonSchema } from "./schema.js";
import {
  classifyOutcome,
  contentTypeAgrees,
  countsAgainstSeller,
  evaluateAssertions,
  evaluateBlockHead,
  findTimestampAge,
  isEmptyPayload,
  isStaleCache,
  isTimeoutError,
  parseAssertionList,
  schemaFromExample,
  shapeVerdict,
  type Assertion,
  type InputEdge,
  type AssertionResult,
  type ProbeOutcome,
  type RotationCase,
  type ShapeIssue,
  type ShapeWarning,
} from "./verdict.js";

const BODY_PREVIEW_CHARS = 65_536;
const BODY_MAX_BYTES = 1_000_000;

/** Generic buyer agent. Requests must not carry a lab or operator name. */
export const USER_AGENT = "Mozilla/5.0 (compatible; Agent/1.0)";

export type ProbeRole = "probe" | "prepay" | "canary" | "recheck";

export type ImportStatus = "unmatched" | "v1-only" | "price-unknown" | "needs-endpoint";

export interface ProbeTarget {
  id?: string;
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** Null when the listing has no Base USDC price. */
  listedPriceUsdc: number | null;
  /** Paid runs probe only targets with paid true. Dry runs probe every target. */
  paid?: boolean;
  source?: "bazaar" | "x402trust";
  /** Listing terms. Absent means the listing did not record the field. */
  payTo?: string | null;
  scheme?: string | null;
  asset?: string | null;
  network?: string | null;
  mimeType?: string | null;
  expectedSchema?: JsonSchema;
  /** Response schema copied from the Bazaar listing. Not the operator's expectedSchema. */
  listingOutputSchema?: JsonSchema;
  outputExample?: unknown;
  x402Version?: number | null;
  importStatus?: ImportStatus;
  /** 0 is shape and empty checks only. 1 has a known-answer assertion. */
  level?: number;
  /** A 2xx whose main payload is empty is empty_result. */
  expectNonEmpty?: boolean;
  /** When true, a paid body hash that never changes across runs is a stale cache. */
  liveData?: boolean;
  assertions?: Assertion[];
  /** One case per UTC day. The selected case replaces body, query, and assertions. */
  rotateDaily?: RotationCase[];
  /** Compare this hex field with our own chain head. */
  blockHead?: { path: string; within: number };
  /** Host the listing redirects to. Challenge and payment both use it, with no redirect in between. */
  canonicalUrl?: string;
  /** Independent check. The level is L0, L1-weak, or L1-strong. */
  check?: TargetCheck;
  /** Set from the selected rotation case. */
  edge?: InputEdge;
  direction?: "safe" | "risk";
  expect?: "not-found";
  /** Set by a stratified sample so the result can be counted by category. */
  sampleCategory?: string;
  /** The request sends input that is deliberately invalid. */
  testInduced?: boolean;
}

export interface SpendLedger {
  spentAtomic: bigint;
  capAtomic: bigint;
  /** Dry-run total of quotes that would fit. Not a refusal, and not spent. */
  projectedAtomic?: bigint;
}

export interface ProbeOptions {
  dryRun: boolean;
  ledger: SpendLedger;
  /** Signs one payment. Called at most once, and never after the paid request is sent. */
  signPayment: (required: PaymentRequired) => Promise<Record<string, string> | { headers: Record<string, string>; auth: PaymentAuth }>;
  /**
   * Atomic Base USDC balance. When set, the balance change is the live spend signal
   * for this run. Reconcile replaces paid with the chain movement.
   */
  readUsdcBalance?: () => Promise<bigint>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Paid body hashes for this target from earlier runs. Used for the stale-cache flag. */
  priorBodyHashes?: string[];
  /** Our chain head. Defaults to eth_blockNumber on rpcUrl. */
  readHeadBlock?: () => Promise<bigint>;
  rpcUrl?: string;
  /** probe is a normal call. prepay never signs. canary and recheck are marked on the result. */
  role?: ProbeRole;
  runId?: string;
  /** 4 runs the daily round in four UTC slots. Each slot picks a different pool case. */
  schedulePerDay?: number;
}

export interface ProbeResult {
  id: string;
  url: string;
  method: string;
  timestamp: string;
  dryRun: boolean;
  listedPriceUsdc: string | null;
  quotedPriceUsdc: string | null;
  scheme: string | null;
  paymentRequirements: unknown;
  settlementTx: string | null;
  settled: boolean;
  httpStatus: number | null;
  latencyMs: number;
  bodyTruncated: string | null;
  bodySha256: string | null;
  bodyBytes: number | null;
  bodyIncomplete: boolean;
  bodySource: "probe" | "paid" | null;
  balanceBeforeUsdc: string | null;
  balanceAfterUsdc: string | null;
  /** after - before. A payment is negative. Null when the wallet was not read. Live signal only. */
  balanceDeltaUsdc: string | null;
  /** Nonce and payTo captured at sign time. Null when nothing was signed. */
  paymentAuth: PaymentAuth | null;
  /** Header, version, facilitator, and seller text from a signed attempt. */
  paymentAttempt?: PaymentAttempt | null;
  delivered: boolean;
  formatMatched: true | false | "na";
  schemaSource: "expected" | "listing" | "example" | "na";
  /** 2xx whose body is an error object or HTML when JSON was expected. */
  errorLikeBody: boolean;
  /** Paid, but the response was not a real delivery. */
  noDelivery: boolean;
  /** Paid, and the body failed the output schema. */
  formatFail: boolean;
  /** noDelivery or formatFail. */
  paidButNoDelivery: boolean;
  refusal: string | null;
  error: string | null;
  /** Dry-run note when this quote would not fit the run cap. Not a refusal. */
  wouldExceedRunCap: string | null;
  /** Listing versus live 402. Empty when nothing differed or no 402 was parsed. */
  listingDrift: ListingDrift[];
  /** A result that is not a payment refusal and not a transport error. */
  finding: string | null;
  /** URL that answered. Set when a redirect was followed or an x402trust 404 was retried. */
  answeredUrl: string | null;
  /** Exactly one paid outcome. Null when this attempt was not a paid result. input_fault is ours. */
  outcome: ProbeOutcome | null;
  /** True only for outcomes that count against the seller. input_fault stays false. */
  sellerFault: boolean;
  level: number | null;
  shapeIssues: ShapeIssue[];
  shapeLenient: true | false | "na";
  shapeStrict: true | false | "na";
  assertionResults: AssertionResult[];
  contentTypeMatched: true | false | "na";
  dataAgeSeconds: number | null;
  timestampPath: string | null;
  staleCache: boolean;
  rotationIndex: number | null;
  checkLevel: TargetCheck["level"] | null;
  checkName: string | null;
  /** Strict-only absences and missing example keys. They do not change outcome. */
  warnings: ShapeWarning[];
  role: ProbeRole;
  runId: string | null;
  runSpentUsdc: string;
  /** Stratified sample category. Absent on pilot and earlier sample runs. */
  sampleCategory?: string;
  /** True when the input was deliberately invalid. */
  testInduced?: boolean;
}

export function parseTarget(value: unknown, index: number): ProbeTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`targets[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || !/^https?:\/\//i.test(record.url)) {
    throw new Error(`targets[${index}].url must be an http(s) URL`);
  }
  if (record.canonicalUrl !== undefined && (typeof record.canonicalUrl !== "string" || !/^https?:\/\//i.test(record.canonicalUrl))) {
    throw new Error(`targets[${index}].canonicalUrl must be an http(s) URL`);
  }
  if (typeof record.method !== "string" || record.method.trim() === "") {
    throw new Error(`targets[${index}].method is required`);
  }
  if (record.listedPriceUsdc !== null && (typeof record.listedPriceUsdc !== "number" || !Number.isFinite(record.listedPriceUsdc) || record.listedPriceUsdc < 0)) {
    throw new Error(`targets[${index}].listedPriceUsdc must be a non-negative number or null`);
  }
  if (record.paid !== undefined && typeof record.paid !== "boolean") {
    throw new Error(`targets[${index}].paid must be a boolean`);
  }
  if (record.source !== undefined && record.source !== "bazaar" && record.source !== "x402trust") {
    throw new Error(`targets[${index}].source must be "bazaar" or "x402trust"`);
  }
  if (record.headers !== undefined) {
    if (!record.headers || typeof record.headers !== "object" || Array.isArray(record.headers)) {
      throw new Error(`targets[${index}].headers must be an object of strings`);
    }
    for (const [key, header] of Object.entries(record.headers)) {
      if (typeof header !== "string") {
        throw new Error(`targets[${index}].headers.${key} must be a string`);
      }
    }
  }
  if (record.expectedSchema !== undefined && (!record.expectedSchema || typeof record.expectedSchema !== "object" || Array.isArray(record.expectedSchema))) {
    throw new Error(`targets[${index}].expectedSchema must be an object`);
  }
  if (record.id !== undefined && typeof record.id !== "string") {
    throw new Error(`targets[${index}].id must be a string`);
  }
  if (
    record.importStatus !== undefined &&
    record.importStatus !== "unmatched" &&
    record.importStatus !== "v1-only" &&
    record.importStatus !== "price-unknown" &&
    record.importStatus !== "needs-endpoint"
  ) {
    throw new Error(`targets[${index}].importStatus must be "unmatched", "v1-only", "price-unknown", or "needs-endpoint"`);
  }
  if ("x402Version" in record && record.x402Version !== null && typeof record.x402Version !== "number") {
    throw new Error(`targets[${index}].x402Version must be a number or null`);
  }
  for (const key of ["payTo", "scheme", "asset", "network", "mimeType"] as const) {
    if (key in record && record[key] !== null && typeof record[key] !== "string") {
      throw new Error(`targets[${index}].${key} must be a string or null`);
    }
  }
  if (
    record.listingOutputSchema !== undefined &&
    (!record.listingOutputSchema || typeof record.listingOutputSchema !== "object" || Array.isArray(record.listingOutputSchema))
  ) {
    throw new Error(`targets[${index}].listingOutputSchema must be an object`);
  }
  if (record.query !== undefined) {
    if (!record.query || typeof record.query !== "object" || Array.isArray(record.query)) {
      throw new Error(`targets[${index}].query must be an object of strings`);
    }
    for (const [key, value] of Object.entries(record.query)) {
      if (typeof value !== "string") throw new Error(`targets[${index}].query.${key} must be a string`);
    }
  }
  if (record.level !== undefined && (typeof record.level !== "number" || !Number.isInteger(record.level) || record.level < 0)) {
    throw new Error(`targets[${index}].level must be a non-negative integer`);
  }
  if (record.expectNonEmpty !== undefined && typeof record.expectNonEmpty !== "boolean") {
    throw new Error(`targets[${index}].expectNonEmpty must be a boolean`);
  }
  if (record.liveData !== undefined && typeof record.liveData !== "boolean") {
    throw new Error(`targets[${index}].liveData must be a boolean`);
  }
  if (record.assertions !== undefined) {
    parseAssertionList(record.assertions, `targets[${index}].assertions`);
  }
  if (record.rotateDaily !== undefined) {
    if (!Array.isArray(record.rotateDaily)) throw new Error(`targets[${index}].rotateDaily must be an array`);
    record.rotateDaily.forEach((item, caseIndex) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`targets[${index}].rotateDaily[${caseIndex}] must be an object`);
      }
      const rotation = item as Record<string, unknown>;
      parseAssertionList(rotation.assertions ?? [], `targets[${index}].rotateDaily[${caseIndex}].assertions`);
      if (rotation.edge !== undefined && rotation.edge !== "empty" && rotation.edge !== "unicode" && rotation.edge !== "long") {
        throw new Error(`targets[${index}].rotateDaily[${caseIndex}].edge must be empty, unicode, or long`);
      }
      if (rotation.direction !== undefined && rotation.direction !== "safe" && rotation.direction !== "risk") {
        throw new Error(`targets[${index}].rotateDaily[${caseIndex}].direction must be safe or risk`);
      }
      if (rotation.expect !== undefined && rotation.expect !== "not-found") {
        throw new Error(`targets[${index}].rotateDaily[${caseIndex}].expect must be not-found`);
      }
      if (rotation.query !== undefined) {
        if (!rotation.query || typeof rotation.query !== "object" || Array.isArray(rotation.query)) {
          throw new Error(`targets[${index}].rotateDaily[${caseIndex}].query must be an object of strings`);
        }
        for (const [key, queryValue] of Object.entries(rotation.query)) {
          if (typeof queryValue !== "string") {
            throw new Error(`targets[${index}].rotateDaily[${caseIndex}].query.${key} must be a string`);
          }
        }
      }
    });
  }
  if (record.check !== undefined) parseCheck(record.check, `targets[${index}].check`);
  if (record.blockHead !== undefined) {
    if (!record.blockHead || typeof record.blockHead !== "object" || Array.isArray(record.blockHead)) {
      throw new Error(`targets[${index}].blockHead must be an object`);
    }
    const head = record.blockHead as Record<string, unknown>;
    if (typeof head.path !== "string" || head.path.trim() === "") {
      throw new Error(`targets[${index}].blockHead.path is required`);
    }
    if (typeof head.within !== "number" || !Number.isFinite(head.within) || head.within < 0) {
      throw new Error(`targets[${index}].blockHead.within must be a non-negative number`);
    }
  }

  const target: ProbeTarget = {
    id: typeof record.id === "string" ? record.id : undefined,
    url: record.url,
    method: record.method,
    body: record.body,
    headers: record.headers as Record<string, string> | undefined,
    query: record.query as Record<string, string> | undefined,
    listedPriceUsdc: record.listedPriceUsdc as number | null,
    expectedSchema: record.expectedSchema as JsonSchema | undefined,
    listingOutputSchema: record.listingOutputSchema as JsonSchema | undefined,
    outputExample: record.outputExample,
    importStatus: record.importStatus as ProbeTarget["importStatus"],
  };
  if (typeof record.paid === "boolean") target.paid = record.paid;
  if (record.source === "bazaar" || record.source === "x402trust") target.source = record.source;
  if ("x402Version" in record) target.x402Version = record.x402Version as number | null;
  for (const key of ["payTo", "scheme", "asset", "network", "mimeType"] as const) {
    if (key in record) target[key] = record[key] as string | null;
  }
  if (typeof record.level === "number") target.level = record.level;
  if (typeof record.expectNonEmpty === "boolean") target.expectNonEmpty = record.expectNonEmpty;
  if (typeof record.liveData === "boolean") target.liveData = record.liveData;
  if (record.assertions !== undefined) target.assertions = parseAssertionList(record.assertions, `targets[${index}].assertions`);
  if (Array.isArray(record.rotateDaily)) {
    target.rotateDaily = record.rotateDaily.map((item, caseIndex) => {
      const rotation = item as Record<string, unknown>;
      const parsed: RotationCase = {
        assertions: parseAssertionList(rotation.assertions ?? [], `targets[${index}].rotateDaily[${caseIndex}].assertions`),
      };
      if ("body" in rotation) parsed.body = rotation.body;
      if (rotation.query && typeof rotation.query === "object" && !Array.isArray(rotation.query)) {
        parsed.query = rotation.query as Record<string, string>;
      }
      if (rotation.edge === "empty" || rotation.edge === "unicode" || rotation.edge === "long") parsed.edge = rotation.edge;
      if (rotation.direction === "safe" || rotation.direction === "risk") parsed.direction = rotation.direction;
      if (rotation.expect === "not-found") parsed.expect = rotation.expect;
      return parsed;
    });
  }
  if (record.blockHead && typeof record.blockHead === "object" && !Array.isArray(record.blockHead)) {
    const head = record.blockHead as { path: string; within: number };
    target.blockHead = { path: head.path, within: head.within };
  }
  if (typeof record.canonicalUrl === "string") target.canonicalUrl = record.canonicalUrl;
  if (record.check !== undefined) target.check = parseCheck(record.check, `targets[${index}].check`);
  return target;
}

function recordedListing(target: ProbeTarget): RecordedListingFields {
  return {
    payTo: "payTo" in target,
    scheme: "scheme" in target,
    asset: "asset" in target,
    network: "network" in target,
    x402Version: "x402Version" in target,
    mimeType: "mimeType" in target,
  };
}

function listingDriftFor(target: ProbeTarget, payment: unknown): ListingDrift[] {
  return compareListing(
    {
      price: target.listedPriceUsdc,
      payTo: target.payTo,
      scheme: target.scheme,
      asset: target.asset,
      network: target.network,
      x402Version: target.x402Version,
      mimeType: target.mimeType,
    },
    liveOffer(payment),
    recordedListing(target),
  );
}

function listedPriceLabel(target: ProbeTarget): string | null {
  return target.listedPriceUsdc === null ? null : formatUsdc(usdcToAtomic(target.listedPriceUsdc));
}

/** Second try for a hand-entered seller: https://api.{host}/... */
function apiSubdomain(resource: string): string | null {
  const url = new URL(resource);
  if (url.hostname.toLowerCase().startsWith("api.")) return null;
  url.hostname = `api.${url.hostname}`;
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resourceUrl(target: ProbeTarget): string {
  const base = target.canonicalUrl ?? target.url;
  if (!target.query || Object.keys(target.query).length === 0) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(target.query)) url.searchParams.set(key, value);
  return url.toString();
}

function requestInit(
  target: ProbeTarget,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
): RequestInit {
  const headers = new Headers(target.headers);
  headers.set("user-agent", USER_AGENT);

  const method = target.method.toUpperCase();
  let body: string | undefined;
  if (target.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof target.body === "string") {
      body = target.body;
    } else {
      body = JSON.stringify(target.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  }

  return {
    method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

function expectsJson(target: ProbeTarget, contentType: string | null, schema: JsonSchema | undefined): boolean {
  if (schema) return true;
  if (contentType?.includes("json")) return true;
  const requestType = target.headers?.["content-type"] ?? target.headers?.["Content-Type"];
  if (typeof requestType === "string" && requestType.includes("json")) return true;
  return target.body !== undefined && typeof target.body !== "string";
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  if (contentType?.includes("html")) return true;
  return /^\s*(<!doctype|<html|<head|<body)/i.test(text);
}

/** 2xx body that is an error object or HTML when JSON was expected. Emptiness is a separate check. */
export function isErrorLikeBody(args: {
  httpStatus: number;
  bodyText: string;
  contentType: string | null;
  jsonExpected: boolean;
}): boolean {
  if (args.httpStatus < 200 || args.httpStatus >= 300) return false;
  const text = args.bodyText.trim();
  if (text.length === 0) return false;
  if (args.jsonExpected && looksLikeHtml(text, args.contentType)) return true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  if (record.success === false) return true;
  if (Array.isArray(record.errors) && record.errors.length > 0) return true;
  const error = record.error;
  if (typeof error === "string" && error.length > 0) return true;
  if (Array.isArray(error) && error.length > 0) return true;
  if (typeof error === "object" && error !== null) return true;
  return false;
}

async function readBody(response: Response): Promise<{ text: string; incomplete: boolean }> {
  if (!response.body) {
    return { text: await response.text(), incomplete: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let incomplete = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (bytes + value.byteLength > BODY_MAX_BYTES) {
      chunks.push(value.subarray(0, BODY_MAX_BYTES - bytes));
      incomplete = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), incomplete };
}

function capturedBody(text: string, source: "probe" | "paid", incomplete: boolean) {
  return {
    bodyTruncated: text.slice(0, BODY_PREVIEW_CHARS),
    bodySha256: createHash("sha256").update(text).digest("hex"),
    bodyBytes: Buffer.byteLength(text),
    bodyIncomplete: incomplete,
    bodySource: source,
  };
}

function judge(args: {
  paid: boolean;
  httpStatus: number;
  bodyText: string;
  contentType: string | null;
  schema: JsonSchema | undefined;
  jsonExpected: boolean;
}): Pick<ProbeResult, "delivered" | "formatMatched" | "errorLikeBody" | "noDelivery" | "formatFail" | "paidButNoDelivery"> {
  const nonempty = args.bodyText.trim().length > 0;
  const errorLikeBody = isErrorLikeBody({
    httpStatus: args.httpStatus,
    bodyText: args.bodyText,
    contentType: args.contentType,
    jsonExpected: args.jsonExpected,
  });
  const delivered = args.paid && args.httpStatus >= 200 && args.httpStatus < 300 && nonempty && !errorLikeBody;

  let formatMatched: true | false | "na" = "na";
  if (args.schema) {
    if (!nonempty) {
      formatMatched = false;
    } else {
      try {
        formatMatched = matchesSchema(JSON.parse(args.bodyText), args.schema);
      } catch {
        formatMatched = false;
      }
    }
  }

  const noDelivery = args.paid && !delivered;
  const formatFail = args.paid && formatMatched === false;
  return {
    delivered,
    formatMatched,
    errorLikeBody,
    noDelivery,
    formatFail,
    paidButNoDelivery: noDelivery || formatFail,
  };
}

async function readBalance(read: ProbeOptions["readUsdcBalance"]): Promise<bigint | null> {
  if (!read) return null;
  return read();
}

/** A balance read after the paid request was sent. Failure leaves the payment unknown. */
async function readBalanceAfter(read: ProbeOptions["readUsdcBalance"]): Promise<bigint | null> {
  try {
    return await readBalance(read);
  } catch {
    return null;
  }
}

function maxTimeoutSeconds(requirements: unknown): number {
  if (!requirements || typeof requirements !== "object") return 0;
  const accepts = (requirements as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) return 0;
  let max = 0;
  for (const accept of accepts) {
    if (!accept || typeof accept !== "object") continue;
    const seconds = (accept as { maxTimeoutSeconds?: unknown }).maxTimeoutSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > max) max = seconds;
  }
  return max;
}

/** Seconds to wait after a paid run: the longest signed maxTimeoutSeconds, plus 120. */
export function settlementWaitSeconds(
  results: readonly Pick<ProbeResult, "paymentAuth" | "settlementTx" | "paymentRequirements">[],
): number {
  let maxTimeout = 0;
  for (const result of results) {
    const signed = result.paymentAuth !== null || (result.settlementTx !== null && result.settlementTx !== "");
    if (!signed) continue;
    maxTimeout = Math.max(maxTimeout, maxTimeoutSeconds(result.paymentRequirements));
  }
  return maxTimeout + 120;
}

function balanceFields(before: bigint | null, after: bigint | null) {
  if (before === null || after === null) {
    return { balanceBeforeUsdc: before === null ? null : formatUsdc(before), balanceAfterUsdc: null, balanceDeltaUsdc: null };
  }
  return {
    balanceBeforeUsdc: formatUsdc(before),
    balanceAfterUsdc: formatUsdc(after),
    balanceDeltaUsdc: formatUsdc(after - before),
  };
}

/**
 * Live spend for the cap and the immediate verdict.
 * When both balance reads succeed, USDC that left the wallet is the spend and
 * the call counts as paid only if the balance fell. Reconcile later replaces
 * that paid verdict with the chain movement. Without a balance reader, fall
 * back to the settlement header so a run without a wallet still records a result.
 */
function accountSpend(args: {
  ledger: SpendLedger;
  reserved: bigint;
  before: bigint | null;
  after: bigint | null;
  explicitReject: boolean;
  settlement: SettleResponse | null;
}): { paid: boolean } {
  if (args.before !== null && args.after !== null) {
    const spent = args.before > args.after ? args.before - args.after : 0n;
    args.ledger.spentAtomic -= args.reserved;
    args.ledger.spentAtomic += spent;
    return { paid: spent > 0n };
  }
  if (args.explicitReject) {
    args.ledger.spentAtomic -= args.reserved;
    return { paid: false };
  }
  if (args.settlement?.success === true && typeof args.settlement.amount === "string") {
    try {
      const actual = parseQuotedAtomic(args.settlement.amount);
      args.ledger.spentAtomic -= args.reserved;
      args.ledger.spentAtomic += actual;
    } catch {
      // Keep the authorized reservation when the settled amount is unreadable.
    }
  }
  return { paid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A declared required name that this request sends, otherwise the request's own first field. */
function fieldToInvalidate(declared: readonly string[], actual: readonly string[]): string | undefined {
  return declared.find((name) => actual.includes(name)) ?? actual[0];
}

/**
 * One unpaid request with a required field blanked or removed.
 * Null when the target and the live 402 give us nothing required to invalidate.
 * Never adds an unknown parameter.
 */
export function invalidInputTarget(target: ProbeTarget, declared: DeclaredInput): ProbeTarget | null {
  const method = target.method.toUpperCase();
  const queryMethod = method === "GET" || method === "HEAD" || method === "DELETE";
  const queryKeys = target.query ? Object.keys(target.query) : [];
  const bodyObject = isRecord(target.body) ? target.body : null;
  const bodyKeys = bodyObject ? Object.keys(bodyObject) : [];
  const queryField = fieldToInvalidate(declared.query, queryKeys);
  const bodyField = fieldToInvalidate(declared.body, bodyKeys);

  if (queryMethod && queryField && queryKeys.includes(queryField)) {
    return { ...target, query: { ...target.query, [queryField]: "" }, body: undefined };
  }
  if (bodyField && bodyObject && bodyKeys.includes(bodyField)) {
    const body = { ...bodyObject };
    delete body[bodyField];
    return { ...target, body };
  }
  if (!queryMethod && queryField && queryKeys.includes(queryField)) {
    return { ...target, query: { ...target.query, [queryField]: "" } };
  }
  if (!queryMethod && target.body !== undefined && bodyObject === null) {
    return { ...target, body: typeof target.body === "string" ? "" : null };
  }
  return null;
}

function sameRequest(left: ProbeTarget, right: ProbeTarget): boolean {
  return left.method.toUpperCase() === right.method.toUpperCase()
    && JSON.stringify(left.query ?? null) === JSON.stringify(right.query ?? null)
    && JSON.stringify(left.body ?? null) === JSON.stringify(right.body ?? null);
}

function challengeDocument(response: Response, bodyText: string, httpClient: x402HTTPClient): unknown | null {
  let parsedBody: unknown;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = undefined;
    }
  }
  try {
    const parsed: unknown = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      parsedBody,
    );
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // The 402 did not carry a readable payment document.
  }
  return parsedBody && typeof parsedBody === "object" ? parsedBody : null;
}

/**
 * Same paid call as the target, with an assertion that cannot succeed.
 * Schemas are dropped so a missing example key cannot hide the assertion.
 */
export function canaryOf(target: ProbeTarget, now: Date, perDay = 1): ProbeTarget {
  const rotated = target.rotateDaily && target.rotateDaily.length > 0
    ? target.rotateDaily[rotationIndex(target.rotateDaily.length, now, perDay)]
    : null;
  return {
    ...target,
    id: `${target.id ?? target.url}#canary`,
    body: rotated && rotated.body !== undefined ? rotated.body : target.body,
    query: rotated?.query ?? target.query,
    rotateDaily: undefined,
    assertions: [{ path: "__canary", op: "eq", value: "___canary_must_fail___" }],
    expectedSchema: undefined,
    listingOutputSchema: undefined,
    outputExample: undefined,
    expectNonEmpty: false,
    blockHead: undefined,
    liveData: false,
    check: undefined,
    edge: undefined,
    direction: undefined,
    expect: undefined,
  };
}

/** Cheapest paid level-1 target. The live canary uses this call. */
export function cheapestLevel1(targets: readonly ProbeTarget[]): ProbeTarget | null {
  let best: ProbeTarget | null = null;
  for (const target of targets) {
    if (target.paid !== true || (target.level ?? 0) < 1 || target.listedPriceUsdc === null) continue;
    if (!best || target.listedPriceUsdc < (best.listedPriceUsdc ?? Infinity)) best = target;
    else if (target.listedPriceUsdc === best.listedPriceUsdc && (target.id ?? target.url) < (best.id ?? best.url)) {
      best = target;
    }
  }
  return best;
}

function activeTarget(target: ProbeTarget, now: Date, perDay = 1): { target: ProbeTarget; rotationIndex: number | null } {
  if (!target.rotateDaily || target.rotateDaily.length === 0) return { target, rotationIndex: null };
  const index = rotationIndex(target.rotateDaily.length, now, perDay);
  const picked = target.rotateDaily[index];
  if (!picked) throw new Error("rotation index missed");
  return {
    rotationIndex: index,
    target: {
      ...target,
      body: picked.body !== undefined ? picked.body : target.body,
      query: picked.query ?? target.query,
      assertions: picked.assertions,
      edge: picked.edge,
      direction: picked.direction,
      expect: picked.expect,
    },
  };
}

async function followOneRedirect(
  response: Response,
  fromUrl: string,
  target: ProbeTarget,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; url: string } | null> {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, fromUrl);
  } catch {
    return null;
  }
  if (next.protocol !== "https:") return null;
  const followed = await fetchImpl(next.toString(), requestInit(target, timeoutMs));
  return { response: followed, url: next.toString() };
}

async function readBaseHead(rpcUrl?: string | null): Promise<bigint> {
  const client = createPublicClient({ chain: base, transport: baseTransport(rpcUrl) });
  return retryRead(() => client.getBlockNumber());
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function assessPaid(args: {
  target: ProbeTarget;
  bodyText: string;
  contentType: string | null;
  declaredMime: string | null | undefined;
  listingSchema: JsonSchema | undefined;
  formatMatched: true | false | "na";
  errorLikeBody: boolean;
  httpStatus: number | null;
  didPay: boolean;
  paymentSent: boolean;
  inputFault: boolean;
  timeout: boolean;
  /** Settlement header succeeded. Grades the 2xx even when the balance read has not moved yet. */
  settleSucceeded?: boolean;
  nowMs: number;
  options: ProbeOptions;
  bodySha256: string | null;
  schemaSource: ProbeResult["schemaSource"];
}): Promise<Pick<
  ProbeResult,
  | "outcome"
  | "sellerFault"
  | "shapeIssues"
  | "shapeLenient"
  | "shapeStrict"
  | "assertionResults"
  | "contentTypeMatched"
  | "dataAgeSeconds"
  | "timestampPath"
  | "staleCache"
  | "warnings"
>> {
  const text = args.bodyText.trim();
  const parsed = text.length > 0 ? parsedJson(args.bodyText) : undefined;
  const listing = args.listingSchema;
  const example = args.target.outputExample !== undefined ? schemaFromExample(args.target.outputExample) : undefined;
  const shape = shapeVerdict({
    parsed,
    unparsed: text.length > 0 && parsed === undefined,
    listingSchema: listing,
    exampleSchema: example,
    expectedFailed: args.schemaSource === "expected" && args.formatMatched === false,
    listingFormatFailed: args.schemaSource === "listing" && args.formatMatched === false,
  });
  const warnings = [...shape.warnings];

  const contentTypeMatched = contentTypeAgrees(args.declaredMime, args.contentType);
  if (contentTypeMatched === false) {
    warnings.push({
      path: "$",
      reason: `content-type ${args.contentType ?? "missing"} does not match mime ${args.declaredMime ?? "missing"}`,
    });
  }

  const paidForOutcome = args.didPay || args.settleSucceeded === true;
  const assertionResults = evaluateAssertions(parsed ?? null, args.target.assertions ?? [], args.nowMs);
  const status = args.httpStatus;
  const rpcMethod = jsonRpcMethod(args.target.body);
  const headSpec = args.target.blockHead;
  const headApplies = Boolean(headSpec) && (rpcMethod === null || rpcMethod === "eth_blockNumber");
  if (headSpec && headApplies && paidForOutcome && !args.timeout && status !== null && status >= 200 && status < 300) {
    let head: bigint | null = null;
    let unavailable = false;
    try {
      head = args.options.readHeadBlock
        ? await args.options.readHeadBlock()
        : await readBaseHead(args.options.rpcUrl ?? "https://mainnet.base.org");
    } catch {
      unavailable = true;
    }
    assertionResults.push(evaluateBlockHead({
      body: parsed ?? null,
      path: headSpec.path,
      within: headSpec.within,
      head,
      unavailable,
    }));
  }

  const shouldCheck = args.paymentSent && !args.timeout && status !== null && (
    (status >= 200 && status < 300)
    || args.target.expect === "not-found"
    || args.target.edge !== undefined
  );
  if (shouldCheck) {
    assertionResults.push(...await runCheck({
      check: args.target.check,
      body: parsed ?? null,
      httpStatus: status,
      requestBody: args.target.body,
      query: args.target.query,
      edge: args.target.edge,
      direction: args.target.direction,
      expect: args.target.expect,
      nowMs: args.nowMs,
      fetchImpl: args.options.fetchImpl,
      rpcUrl: args.options.rpcUrl,
    }));
  }

  const sellerAssertion = assertionResults.some((item) => !item.pass && item.fault === "seller");
  const inputAssertion = assertionResults.some((item) => !item.pass && item.fault === "input");
  const nonempty = text.length > 0;
  const emptyPayload = parsed !== undefined && isEmptyPayload(parsed);
  const classified = classifyOutcome({
    paymentSent: args.paymentSent,
    didPay: paidForOutcome,
    inputFault: args.inputFault,
    timeout: args.timeout,
    httpStatus: args.httpStatus,
    errorLikeBody: args.errorLikeBody,
    nonempty,
    emptyPayload,
    expectNonEmpty: args.target.expectNonEmpty === true && args.target.edge !== "empty",
    shapeFailed: shape.shapeFailed,
    assertionFailed: sellerAssertion,
    assertionInputFault: inputAssertion && !sellerAssertion,
  });
  const outcome = applyEdge({
    edge: args.target.edge,
    expect: args.target.expect,
    outcome: classified,
    httpStatus: args.httpStatus,
    emptyPayload,
    nonempty,
    notFoundPass: notFoundPassed(assertionResults, args.target.expect),
  });
  const age = parsed !== undefined ? findTimestampAge(parsed, args.nowMs) : null;
  return {
    outcome,
    sellerFault: countsAgainstSeller(outcome),
    shapeIssues: shape.issues,
    shapeLenient: shape.shapeLenient,
    shapeStrict: shape.shapeStrict,
    warnings,
    assertionResults,
    contentTypeMatched,
    dataAgeSeconds: age?.ageSeconds ?? null,
    timestampPath: age?.path ?? null,
    staleCache: isStaleCache({
      liveData: args.target.liveData === true,
      priorHashes: args.options.priorBodyHashes ?? [],
      current: args.bodySha256,
    }),
  };
}

/**
 * One target, one attempt.
 * Fetches the 402, then either stops or sends exactly one paid request.
 * A payment whose response fails is recorded and not retried.
 * x402 v1 requirements are refused as "v1-unsupported" rather than paid.
 * Prepay never signs. It sends one invalid request only when a required field can be blanked or removed.
 */
export async function probeTarget(target: ProbeTarget, options: ProbeOptions): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const httpClient = new x402HTTPClient(new x402Client());
  const clock = (options.now ?? (() => new Date()))();
  const rotation = activeTarget(target, clock, options.schedulePerDay ?? 1);
  const active = rotation.target;
  const url = resourceUrl(active);

  const finish = (patch: Partial<ProbeResult>): ProbeResult => ({
    id: target.id ?? target.url,
    url: target.url,
    method: target.method.toUpperCase(),
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    dryRun: options.dryRun,
    listedPriceUsdc: listedPriceLabel(target),
    quotedPriceUsdc: null,
    scheme: null,
    paymentRequirements: null,
    settlementTx: null,
    settled: false,
    httpStatus: null,
    latencyMs: 0,
    bodyTruncated: null,
    bodySha256: null,
    bodyBytes: null,
    bodyIncomplete: false,
    bodySource: null,
    balanceBeforeUsdc: null,
    balanceAfterUsdc: null,
    balanceDeltaUsdc: null,
    paymentAuth: null,
    paymentAttempt: null,
    delivered: false,
    formatMatched: "na",
    schemaSource: "na",
    errorLikeBody: false,
    noDelivery: false,
    formatFail: false,
    paidButNoDelivery: false,
    refusal: null,
    error: null,
    wouldExceedRunCap: null,
    listingDrift: [],
    finding: null,
    answeredUrl: null,
    outcome: null,
    sellerFault: false,
    level: target.level ?? null,
    shapeIssues: [],
    shapeLenient: "na",
    shapeStrict: "na",
    assertionResults: [],
    contentTypeMatched: "na",
    dataAgeSeconds: null,
    timestampPath: null,
    staleCache: false,
    rotationIndex: rotation.rotationIndex,
    checkLevel: target.check?.level ?? null,
    checkName: target.check?.name ?? null,
    warnings: [],
    role: options.role ?? "probe",
    runId: options.runId ?? null,
    ...(target.sampleCategory ? { sampleCategory: target.sampleCategory } : {}),
    ...(active.testInduced === true || active.edge !== undefined ? { testInduced: true } : {}),
    ...patch,
    runSpentUsdc: formatUsdc(options.ledger.spentAtomic),
  });

  if (target.importStatus === "needs-endpoint") {
    return finish({ finding: "needs-endpoint" });
  }
  if (target.importStatus === "unmatched") {
    return finish({ refusal: "unmatched" });
  }

  const started = Date.now();
  let response: Response;
  let answeredUrl = url;
  try {
    response = await fetchImpl(url, requestInit(active, timeoutMs));
    const redirected = await followOneRedirect(response, url, active, timeoutMs, fetchImpl);
    if (redirected) {
      response = redirected.response;
      answeredUrl = redirected.url;
    }
  } catch (error) {
    return finish({
      latencyMs: Date.now() - started,
      error: errorMessage(error),
    });
  }

  if (response.status === 404 && active.source === "x402trust") {
    const alternate = apiSubdomain(url);
    if (!alternate || answeredUrl === alternate) {
      return finish({
        httpStatus: 404,
        latencyMs: Date.now() - started,
        answeredUrl,
        finding: "listed route is dead",
      });
    }
    try {
      const second = await fetchImpl(alternate, requestInit(active, timeoutMs));
      if (second.status === 404) {
        return finish({
          httpStatus: 404,
          latencyMs: Date.now() - started,
          answeredUrl: alternate,
          finding: "listed route is dead",
        });
      }
      response = second;
      answeredUrl = alternate;
    } catch {
      return finish({
        httpStatus: 404,
        latencyMs: Date.now() - started,
        answeredUrl: url,
        finding: "listed route is dead",
      });
    }
  }

  const probeBody = await readBody(response);
  const latencyMs = Date.now() - started;
  const body = capturedBody(probeBody.text, "probe", probeBody.incomplete);

  if ((options.role ?? "probe") === "prepay") {
    const declared = response.status === 402
      ? declaredRequiredInput(challengeDocument(response, probeBody.text, httpClient))
      : { query: [], body: [] };
    const invalid = invalidInputTarget(active, declared);
    if (!invalid || sameRequest(active, invalid)) {
      return finish({
        httpStatus: response.status,
        latencyMs,
        answeredUrl,
        ...body,
        sellerFault: false,
        finding: "no required input to invalidate",
      });
    }

    let judged: Response;
    let judgedBody: ReturnType<typeof capturedBody>;
    let judgedUrl: string;
    let judgedLatency: number;
    const invalidStarted = Date.now();
    try {
      judged = await fetchImpl(resourceUrl(invalid), requestInit(invalid, timeoutMs));
      judgedUrl = resourceUrl(invalid);
      const redirected = await followOneRedirect(judged, judgedUrl, invalid, timeoutMs, fetchImpl);
      if (redirected) {
        judged = redirected.response;
        judgedUrl = redirected.url;
      }
      const invalidRead = await readBody(judged);
      judgedBody = capturedBody(invalidRead.text, "probe", invalidRead.incomplete);
      judgedLatency = Date.now() - invalidStarted;
    } catch (error) {
      return finish({
        latencyMs: Date.now() - started,
        answeredUrl,
        error: errorMessage(error),
      });
    }

    const accepted = judged.status === 400 || judged.status === 422;
    const validatesAfter = judged.status === 402;
    return finish({
      httpStatus: judged.status,
      latencyMs: judgedLatency,
      answeredUrl: judgedUrl,
      ...judgedBody,
      outcome: accepted ? "pass" : null,
      sellerFault: false,
      finding: validatesAfter ? "validates after payment" : null,
      error: accepted || validatesAfter ? null : `prepay validation got ${judged.status}`,
      testInduced: true,
    });
  }

  if (response.status !== 402) {
    return finish({
      httpStatus: response.status,
      latencyMs,
      answeredUrl,
      ...body,
      error: `Expected 402 Payment Required, got ${response.status}`,
    });
  }

  let parsedBody: unknown;
  if (probeBody.text) {
    try {
      parsedBody = JSON.parse(probeBody.text);
    } catch {
      parsedBody = undefined;
    }
  }

  const noInput = active.method.toUpperCase() === "POST" && active.body === undefined;
  const v1Refusal = (requirements: unknown): ProbeResult => finish({
    httpStatus: 402,
    latencyMs,
    answeredUrl,
    ...body,
    paymentRequirements: requirements,
    listingDrift: listingDriftFor(target, requirements),
    refusal: "v1-unsupported",
  });

  if (isV1PaymentRequired(parsedBody)) return v1Refusal(parsedBody);

  let required: PaymentRequired;
  try {
    const parsed: unknown = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      parsedBody,
    );
    if (isV1PaymentRequired(parsed)) return v1Refusal(parsed);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as PaymentRequired).x402Version !== 2 ||
      !Array.isArray((parsed as PaymentRequired).accepts)
    ) {
      throw new Error("402 response did not include x402 v2 payment requirements");
    }
    required = parsed as PaymentRequired;
  } catch (error) {
    if (isV1PaymentRequired(parsedBody)) return v1Refusal(parsedBody);
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      error: errorMessage(error),
    });
  }

  const drift = listingDriftFor(target, required);
  const offer = liveOffer(required);
  if (target.listedPriceUsdc === null) {
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: offer.priceAtomic === null ? null : formatUsdc(offer.priceAtomic),
      scheme: offer.scheme,
      paymentRequirements: required,
      listingDrift: drift,
      refusal: "price-unknown",
    });
  }

  const decision: PriceDecision = decidePayment(
    required.accepts,
    target.listedPriceUsdc,
    options.ledger.spentAtomic,
    options.ledger.capAtomic,
    { enforceSpendCap: !options.dryRun },
  );
  if (!decision.ok) {
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: decision.quotedUsdc,
      paymentRequirements: required,
      listingDrift: drift,
      refusal: decision.reason,
    });
  }

  if (noInput) {
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: decision.usdc,
      scheme: decision.scheme,
      paymentRequirements: required,
      listingDrift: drift,
      refusal: "no-input",
      outcome: "input_fault",
      sellerFault: false,
    });
  }

  const from402 = listingOutputSchema(required);
  const exampleSchema = active.outputExample !== undefined ? schemaFromExample(active.outputExample) : undefined;
  const listingSchema = active.listingOutputSchema ?? from402;
  const schema = active.expectedSchema ?? listingSchema ?? exampleSchema;
  const schemaSource = active.expectedSchema
    ? "expected"
    : listingSchema
      ? "listing"
      : exampleSchema
        ? "example"
        : "na";

  if (options.dryRun) {
    const projected = options.ledger.projectedAtomic ?? 0n;
    let wouldExceedRunCap: string | null = null;
    if (projected + decision.atomic > options.ledger.capAtomic) {
      wouldExceedRunCap = spendCapReason(decision.usdc, projected, options.ledger.capAtomic);
    } else {
      options.ledger.projectedAtomic = projected + decision.atomic;
    }
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: decision.usdc,
      scheme: decision.scheme,
      paymentRequirements: required,
      schemaSource,
      listingDrift: drift,
      wouldExceedRunCap,
    });
  }

  const selected = required.accepts[decision.index];
  if (!selected) {
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      paymentRequirements: required,
      listingDrift: drift,
      error: "Selected payment requirement disappeared",
    });
  }
  const narrowed: PaymentRequired = { ...required, accepts: [selected] };

  let paymentHeaders: Record<string, string>;
  let paymentAuth: PaymentAuth | null = null;
  try {
    const signed = await options.signPayment(narrowed);
    if (isSignedPayment(signed)) {
      paymentHeaders = signed.headers;
      paymentAuth = signed.auth;
    } else {
      paymentHeaders = signed;
    }
  } catch (error) {
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: decision.usdc,
      scheme: decision.scheme,
      paymentRequirements: required,
      schemaSource,
      listingDrift: drift,
      outcome: "input_fault",
      sellerFault: false,
      error: errorMessage(error),
    });
  }

  // Reserve the authorized amount before the request leaves. The wallet balance
  // read after the call replaces this reservation when it succeeds.
  // A failed balance read here is ours: do not send the paid request.
  options.ledger.spentAtomic += decision.atomic;
  let before: bigint | null;
  try {
    before = await readBalance(options.readUsdcBalance);
  } catch (error) {
    options.ledger.spentAtomic -= decision.atomic;
    return finish({
      httpStatus: 402,
      latencyMs,
      answeredUrl,
      ...body,
      quotedPriceUsdc: decision.usdc,
      scheme: decision.scheme,
      paymentRequirements: required,
      paymentAuth,
      schemaSource,
      listingDrift: drift,
      outcome: "input_fault",
      sellerFault: false,
      error: errorMessage(error),
    });
  }
  const paidStarted = Date.now();
  let paid: Response;
  try {
    // One paid HTTP request. Transport failures are not retried.
    paid = await fetchImpl(answeredUrl, requestInit(active, timeoutMs, paymentHeaders));
  } catch (error) {
    const after = await readBalanceAfter(options.readUsdcBalance);
    const { paid: didPay } = accountSpend({
      ledger: options.ledger,
      reserved: decision.atomic,
      before,
      after,
      explicitReject: false,
      settlement: null,
    });
    const timeout = isTimeoutError(error);
    const assessment = await assessPaid({
      target: active,
      bodyText: "",
      contentType: null,
      declaredMime: offer.mimeType,
      listingSchema,
      formatMatched: "na",
      errorLikeBody: false,
      httpStatus: null,
      didPay,
      paymentSent: true,
      inputFault: false,
      timeout,
      nowMs: clock.getTime(),
      options,
      bodySha256: null,
      schemaSource,
    });
    return finish({
      httpStatus: null,
      latencyMs: Date.now() - paidStarted,
      answeredUrl,
      quotedPriceUsdc: decision.usdc,
      scheme: decision.scheme,
      paymentRequirements: required,
      paymentAuth,
      schemaSource,
      listingDrift: drift,
      ...balanceFields(before, after),
      noDelivery: didPay,
      paidButNoDelivery: didPay && assessment.outcome !== "input_fault",
      ...assessment,
      error: errorMessage(error),
    });
  }

  const after = await readBalanceAfter(options.readUsdcBalance);
  const paidBody = await readBody(paid);
  const paidCapture = capturedBody(paidBody.text, "paid", paidBody.incomplete);
  let settlement: SettleResponse | null = null;
  try {
    settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
  } catch {
    settlement = null;
  }

  const explicitReject = paid.status === 402 || settlement?.success === false;
  const { paid: didPay } = accountSpend({
    ledger: options.ledger,
    reserved: decision.atomic,
    before,
    after,
    explicitReject,
    settlement,
  });

  const contentType = paid.headers.get("content-type");
  const verdict = judge({
    paid: didPay,
    httpStatus: paid.status,
    bodyText: paidBody.text,
    contentType,
    schema,
    jsonExpected: expectsJson(active, contentType, schema),
  });
  const assessment = await assessPaid({
    target: active,
    bodyText: paidBody.text,
    contentType,
    declaredMime: offer.mimeType,
    listingSchema,
    formatMatched: verdict.formatMatched,
    errorLikeBody: verdict.errorLikeBody,
    httpStatus: paid.status,
    didPay,
    paymentSent: true,
    inputFault: false,
    timeout: false,
    settleSucceeded: settlement?.success === true,
    nowMs: clock.getTime(),
    options,
    bodySha256: paidCapture.bodySha256,
    schemaSource,
  });

  let error: string | null = null;
  if (!didPay && settlement?.success === false) {
    error = settlement.errorMessage ?? settlement.errorReason ?? "settlement failed";
  } else if (!didPay && paid.status === 402) {
    error = "payment rejected";
  } else if (paidCapture.bodyIncomplete) {
    error = "Response body exceeded 1MB; hash covers the first 1MB only";
  }

  const rejected = (!didPay && settlement?.success === false) || (!didPay && paid.status === 402);
  const headerName = Object.keys(paymentHeaders)[0] ?? "PAYMENT-SIGNATURE";
  const headerValue = paymentHeaders[headerName] ?? "";
  const responseHeaders: Record<string, string> = {};
  paid.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const signed402 = paid.status === 402;
  return finish({
    httpStatus: paid.status,
    latencyMs: Date.now() - paidStarted,
    answeredUrl,
    ...paidCapture,
    ...balanceFields(before, after),
    quotedPriceUsdc: decision.usdc,
    scheme: decision.scheme,
    paymentRequirements: required,
    paymentAuth,
    paymentAttempt: {
      header: headerName,
      headerValueShape: headerValueShape(headerName, headerValue),
      x402Version: required.x402Version,
      facilitator: facilitatorOf(required),
      sellerError: rejected ? sellerErrorText(paidBody.text, settlement) : "",
      ...(signed402 ? { responseHeaders: identifyingHeaders(paid.headers) } : {}),
      ...(!signed402 && rejected ? { responseHeaders } : {}),
      ...(rejected ? { responseBody: paidBody.text } : {}),
    },
    listingDrift: drift,
    settlementTx: settlement?.transaction ?? null,
    settled: settlement?.success === true,
    schemaSource,
    ...verdict,
    ...assessment,
    paidButNoDelivery: assessment.outcome === "input_fault" ? false : verdict.paidButNoDelivery,
    error,
  });
}

function isV1PaymentRequired(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { x402Version?: number }).x402Version === 1;
}
