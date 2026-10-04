import { paymentRejectionDetail } from "./payment-attempt.js";
import { formatUsdc, parseQuotedAtomic } from "./price.js";
import type { ProbeResult } from "./probe.js";
import { classifyOutcome, type ProbeOutcome } from "./verdict.js";

/** Bump this when seller grades or severities change meaning. */
export const RUBRIC_VERSION = "8";

export type PaidMark = boolean | "pending reconcile";
export type SampleFrame = "pilot" | "random" | "random-r3";

/** A stored result, plus chain payment when reconciled.jsonl supplied it. */
export interface GradeSource extends ProbeResult {
  onchainPaid?: boolean;
  onchainAmountUsdc?: string | null;
  /** Signed, and this reconcile has not found the transfer yet. A later reconcile clears it. */
  settlementPending?: boolean;
  /** USDC sent back to the Labs wallet by this call's payTo within 30 minutes. */
  recoveredUsd?: string;
  refundTx?: string | null;
}

const RECHECK_MS = 60 * 60 * 1000;
const WILSON_Z = 1.96;

export type Fault = "seller" | "ours" | "indeterminate";
export type Severity = "S1" | "S2" | "S3" | "S4";
export type SellerMark = "Fail" | "Warn" | "Pass";

export interface GradedCall {
  kind: "call";
  rubricVersion: string;
  id: string;
  seller: string;
  url: string;
  timestamp: string;
  role: ProbeResult["role"];
  runId: string | null;
  level: number | null;
  checkLevel: ProbeResult["checkLevel"];
  checkName: string | null;
  outcome: ProbeResult["outcome"];
  fault: Fault | null;
  severity: Severity | null;
  /** Set for seller S1/S2. True when a recheck failed or the previous run failed the same target. */
  confirmed: boolean | null;
  reasons: string[];
  finding: string | null;
  /** pilot targets.json runs, a random Bazaar sample, or a retest of that seller's sample. */
  sampleFrame: SampleFrame;
  /** True when the call's input was deliberately invalid. */
  testInduced: boolean;
  /** Chain payment from reconciled.jsonl. Null when that file has no line for this call. */
  onchainPaid: boolean | null;
  /** Settled USDC from reconciled.jsonl. Null when the call was not charged. */
  onchainAmount: string | null;
  /** On-chain amount when the paid call did not deliver a usable answer. Format mismatch is 0. */
  lossUsd: string;
  /** lossUsd minus a refund from that call's payTo. */
  netLossUsd: string;
  recoveredUsd: string;
  refundTx: string | null;
  /** On-chain amount when the body arrived but broke the output contract. */
  contractBreachUsd: string;
  /** Chain payment when known. "pending reconcile" when a payment was sent and the chain has not confirmed it. */
  paid: PaidMark;
  /** False when our signing, RPC, or balance read failed before the paid request. */
  tested: boolean;
}

export interface SellerGradeLine {
  kind: "seller";
  rubricVersion: string;
  seller: string;
  grade: SellerMark;
  /** Deepest level executed in the window, for example "Pass (L0)". */
  label: string;
  level: number;
  pendingRecheck: boolean;
}

export interface PilotSummary {
  kind: "summary";
  rubricVersion: string;
  windowRunId: string | null;
  /** Sellers with a confirmed S1 or S2, over sellers tested at L1 or above. */
  sellersConfirmedS1S2: number;
  sellersTestedL1: number;
  wilson: { low: number; high: number; z: number } | null;
  /** Per-call seller-fault rate. Not the pilot headline. */
  secondary: {
    label: "secondary";
    calls: number;
    sellerFaultCalls: number;
    rate: number | null;
  };
  runInvalid: boolean;
  canary: { id: string; outcome: ProbeResult["outcome"]; ok: boolean } | null;
  rechecks: { id: string; dueBefore: string }[];
}

export type GradedLine = GradedCall | SellerGradeLine | PilotSummary;

export interface GradeReport {
  lines: GradedLine[];
  calls: GradedCall[];
  sellers: SellerGradeLine[];
  summary: PilotSummary;
  rechecks: { id: string; dueBefore: string }[];
}

function rank(severity: Severity): number {
  if (severity === "S1") return 1;
  if (severity === "S2") return 2;
  if (severity === "S3") return 3;
  return 4;
}

export function sellerHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 95% Wilson interval for k successes in n trials. Null when n is 0. */
export function wilsonInterval(
  successes: number,
  total: number,
  z = WILSON_Z,
): { low: number; high: number; z: number } | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    z,
  };
}

const INFRASTRUCTURE_ERROR = /RPC Request failed|over rate limit|eth_call|eth_blockNumber|balanceOf\(|viem@|Refusing to sign|Labs wallet has|Labs wallet needs|Selected payment requirement disappeared|Unexpected Permit2|approve Permit2|could not read Base/i;

function http2xx(result: ProbeResult): boolean {
  return result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300;
}

/**
 * Our signing, RPC, or balance read failed before a payment was sent.
 * That call was not a seller test.
 */
export function blockedBeforePayment(result: GradeSource): boolean {
  if (result.role === "prepay") return false;
  if (result.settlementPending === true) return false;
  if (result.onchainPaid === true || result.settled) return false;
  if (result.settlementTx) return false;
  if (result.paymentAuth) return false;
  if (result.refusal === "no-input") return false;
  if (!result.error) return false;
  return INFRASTRUCTURE_ERROR.test(result.error);
}

function paidMark(result: GradeSource): PaidMark {
  if (blockedBeforePayment(result)) return false;
  if (result.settlementPending === true && result.onchainPaid !== true) return "pending reconcile";
  if (typeof result.onchainPaid === "boolean") return result.onchainPaid;
  if (result.httpStatus === 402 && result.error === "payment rejected") return false;
  const sent = result.paymentAuth !== null || result.settled || (result.settlementTx !== null && result.settlementTx !== "");
  if (!sent) return false;
  const delta = result.balanceDeltaUsdc;
  if (typeof delta === "string" && delta.startsWith("-") && delta !== "-0.000000") return true;
  return "pending reconcile";
}

function outcomeFromDelivery(result: ProbeResult): ProbeOutcome {
  const nonempty = (result.bodyBytes ?? 0) > 0 || (result.bodyTruncated?.trim().length ?? 0) > 0;
  const shapeFailed = result.shapeLenient === false || result.shapeIssues.length > 0;
  const sellerAssertion = result.assertionResults.some((item) => !item.pass && item.fault === "seller");
  const inputAssertion = result.assertionResults.some((item) => !item.pass && item.fault === "input");
  return classifyOutcome({
    paymentSent: true,
    didPay: true,
    inputFault: false,
    timeout: false,
    httpStatus: result.httpStatus,
    errorLikeBody: result.errorLikeBody,
    nonempty,
    emptyPayload: false,
    expectNonEmpty: false,
    shapeFailed,
    assertionFailed: sellerAssertion,
    assertionInputFault: inputAssertion && !sellerAssertion,
  }) ?? "pass";
}

function complete(result: GradeSource): GradeSource {
  return {
    ...result,
    url: typeof result.url === "string" ? result.url : "",
    method: typeof result.method === "string" ? result.method : "GET",
    role: result.role ?? "probe",
    dryRun: result.dryRun === true,
    listingDrift: Array.isArray(result.listingDrift) ? result.listingDrift : [],
    shapeIssues: Array.isArray(result.shapeIssues) ? result.shapeIssues : [],
    assertionResults: Array.isArray(result.assertionResults) ? result.assertionResults : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function gradeView(input: GradeSource): ProbeResult & { paid: PaidMark; tested: boolean } {
  const result = complete(input);
  if (blockedBeforePayment(result)) {
    return { ...result, outcome: "input_fault", sellerFault: false, paid: false, tested: false };
  }
  const paid = paidMark(result);
  let outcome = revisedOutcome(result);
  let finding = result.finding;
  const chargeOutcome = outcome === "charged_for_client_error" || outcome === "server_error_after_payment";
  if (chargeOutcome && result.settlementPending === true && result.onchainPaid !== true) {
    outcome = null;
  } else if (chargeOutcome && result.onchainPaid !== true) {
    outcome = "declined_without_charge";
    finding = "declined without charge";
  }
  const settled = result.onchainPaid === true || result.settled === true;
  if (
    outcome == null
    && http2xx(result)
    && result.onchainPaid !== false
    && (settled || paid === true || paid === "pending reconcile")
  ) {
    outcome = outcomeFromDelivery(result);
  }
  return { ...result, outcome, finding, paid, tested: true };
}

/**
 * Overlay chain payment onto stored results. Unattributed rows are ignored.
 * paid on the overlay is onchainPaid.
 */
export function withReconciled(results: readonly ProbeResult[], reconciled: readonly unknown[]): GradeSource[] {
  const byKey = new Map<string, GradeSource>();
  for (const line of reconciled) {
    if (!line || typeof line !== "object") continue;
    const record = line as GradeSource & { kind?: string };
    if (record.kind === "unattributed" || record.kind === "summary" || record.kind === "seller") continue;
    if (typeof record.id !== "string" || record.id.length === 0 || typeof record.timestamp !== "string") continue;
    byKey.set(`${record.runId ?? ""}|${record.role}|${record.id}|${record.timestamp}`, record);
  }
  return results.map((result) => {
    const found = byKey.get(`${result.runId ?? ""}|${result.role}|${result.id}|${result.timestamp}`);
    if (!found) return result;
    if (found.settlementPending === true && found.onchainPaid !== true) {
      return { ...result, settlementPending: true };
    }
    if (typeof found.onchainPaid !== "boolean") return result;
    return { ...result, ...found, onchainPaid: found.onchainPaid, settlementPending: false };
  });
}

/** Call rows only. Summary lines and rows without an id are not written. */
export function gradedFileLines(report: GradeReport): GradedCall[] {
  return report.lines.filter((line): line is GradedCall => (
    line.kind === "call" && typeof line.id === "string" && line.id.length > 0
  ));
}

function ourRpcFailed(result: ProbeResult): boolean {
  return result.assertionResults.some((item) => item.op === "withinBlocks" && !item.pass && item.fault === "input");
}

function movedHost(result: ProbeResult): boolean {
  const listed = hostOf(result.url);
  const answered = hostOf(result.answeredUrl);
  return listed !== null && answered !== null && listed !== answered;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const METHOD_CHANGE_STATUS = new Set([301, 302, 303]);

/**
 * A paid POST whose response is itself a redirect.
 * 301/302/303 change the method. Any of these, followed, would drop the payment header.
 */
function postRedirectFault(result: ProbeResult): "method" | "header" | null {
  if (result.method.toUpperCase() !== "POST") return null;
  if (result.httpStatus === null || !REDIRECT_STATUS.has(result.httpStatus)) return null;
  return METHOD_CHANGE_STATUS.has(result.httpStatus) ? "method" : "header";
}

function paymentRejected(result: ProbeResult): boolean {
  return result.error === "payment rejected" || (result.httpStatus === 402 && (result.error ?? "").startsWith("payment rejected"));
}

function nullCompatibleIssue(issue: ProbeResult["shapeIssues"][number]): boolean {
  return issue.kind === "type" && (issue.expected === "null" || issue.actual === "null");
}

function sampleRun(result: Pick<ProbeResult, "runId">): boolean {
  return (result.runId ?? "").startsWith("sample-");
}

const PILOT_RUN = /^\d{4}-\d{2}-\d{2}T/;
const DELIBERATE_INVALID = /(?:^|[/])not-an-address(?:[/?#]|$)/i;

/** A sample draw's frame, pilot, or a named follow-up that should inherit. */
function ownFrame(runId: string | null): SampleFrame | "retest" {
  const id = runId ?? "";
  if (id.startsWith("sample-r3-")) return "random-r3";
  if (id.startsWith("sample-")) return "random";
  if (id === "" || PILOT_RUN.test(id)) return "pilot";
  return "retest";
}

export interface SellerOrigin {
  sampleFrame: SampleFrame;
  sampleCategory: string | null;
}

/** Earliest paid sample draw for each seller. Retests inherit this frame. */
export function sellerOrigins(
  results: readonly Pick<ProbeResult, "runId" | "url" | "timestamp" | "sampleCategory" | "dryRun">[],
): Map<string, SellerOrigin> {
  const best = new Map<string, { origin: SellerOrigin; stamp: number }>();
  for (const result of results) {
    if (result.dryRun === true) continue;
    const frame = ownFrame(result.runId);
    if (frame === "pilot" || frame === "retest") continue;
    const seller = sellerHost(result.url);
    const parsed = Date.parse(result.timestamp);
    const when = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    const current = best.get(seller);
    if (current && when >= current.stamp) continue;
    best.set(seller, {
      stamp: when,
      origin: { sampleFrame: frame, sampleCategory: result.sampleCategory ?? null },
    });
  }
  const origins = new Map<string, SellerOrigin>();
  for (const [seller, row] of best) origins.set(seller, row.origin);
  return origins;
}

export function sampleFrameOf(
  result: Pick<ProbeResult, "runId" | "url">,
  origins?: ReadonlyMap<string, SellerOrigin>,
): SampleFrame {
  const frame = ownFrame(result.runId);
  if (frame !== "retest") return frame;
  return origins?.get(sellerHost(result.url))?.sampleFrame ?? "pilot";
}

/**
 * Prepay that actually sent a blanked field, an edge case, or a named invalid input.
 * A prepay that found nothing to invalidate is not one of these.
 */
export function testInducedOf(result: Pick<ProbeResult, "testInduced" | "role" | "finding" | "url" | "id">): boolean {
  if (result.testInduced === true) return true;
  if (result.role === "prepay" && result.finding !== "no required input to invalidate") return true;
  return DELIBERATE_INVALID.test(result.url) || DELIBERATE_INVALID.test(result.id);
}

const PLACEHOLDER_INPUT = /example\.(com|org)|placeholder|changeme|your-?api|0x0{16,}/i;
const SAMPLE_REJECTION = /sample URL|placeholder input|from the listing|Replace it with your own/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listingQuery(payment: unknown): Record<string, string> | null {
  if (!isRecord(payment) || !isRecord(payment.extensions)) return null;
  const bazaar = payment.extensions.bazaar;
  if (!isRecord(bazaar) || !isRecord(bazaar.info) || !isRecord(bazaar.info.input)) return null;
  const query = bazaar.info.input.queryParams;
  if (!isRecord(query)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function queryMatchesListing(url: string, payment: unknown): boolean {
  const example = listingQuery(payment);
  if (!example) return false;
  let live: URLSearchParams;
  try {
    live = new URL(url).searchParams;
  } catch {
    return false;
  }
  const keys = Object.keys(example);
  if ([...live.keys()].length !== keys.length) return false;
  return keys.every((key) => live.get(key) === example[key]);
}

/**
 * The call sent the catalog example or another placeholder, so a rejection is our input.
 * A random sample copies the listing example. A pilot call matches when its query is that example.
 */
export function usedListingSample(result: Pick<ProbeResult, "runId" | "url" | "bodyTruncated" | "paymentRequirements">): boolean {
  if (sampleRun(result)) return true;
  if (queryMatchesListing(result.url, result.paymentRequirements)) return true;
  if (PLACEHOLDER_INPUT.test(result.url)) return true;
  return SAMPLE_REJECTION.test(result.bodyTruncated ?? "");
}

/**
 * Null values and null-typed examples are not type failures.
 * A random sample never sets expectNonEmpty, so a stored empty_result on a sample run is not that fault.
 */
function revisedOutcome(result: ProbeResult): ProbeResult["outcome"] {
  const issues = result.shapeIssues;
  if (
    result.outcome === "shape_mismatch"
    && issues.length > 0
    && issues.every(nullCompatibleIssue)
  ) {
    return "pass";
  }
  if (result.outcome === "empty_result" && sampleRun(result)) {
    const real = issues.filter((issue) => !nullCompatibleIssue(issue));
    if (real.length > 0 || result.formatMatched === false) return "shape_mismatch";
    return "pass";
  }
  return result.outcome;
}

/** One call, ignoring confirmation. Canary calls are not seller faults. */
export function assessCall(result: ProbeResult): { fault: Fault | null; severity: Severity | null; reasons: string[] } {
  if (result.role === "canary") return { fault: null, severity: null, reasons: ["canary"] };
  if (result.outcome === "declined_without_charge") {
    const reasons = ["declined without charge"];
    if (paymentRejected(result)) reasons.push(paymentRejectionDetail(result));
    return { fault: null, severity: null, reasons };
  }
  if (result.outcome === "input_fault") {
    return { fault: "ours", severity: null, reasons: [ourRpcFailed(result) ? "head rpc" : "input"] };
  }
  if (movedHost(result) && paymentRejected(result)) {
    return {
      fault: "indeterminate",
      severity: null,
      reasons: ["listing URL redirects", "payment rejected", paymentRejectionDetail(result)],
    };
  }

  const reasons: string[] = [];
  let severity: Severity | null = null;
  const bump = (next: Severity, reason: string) => {
    reasons.push(reason);
    if (severity === null || rank(next) < rank(severity)) severity = next;
  };

  if (result.listingDrift.some((item) => item.field === "payTo" && item.severity === "high")) bump("S1", "payTo changed");
  if (
    result.outcome === "no_delivery"
    || result.outcome === "timeout_after_payment"
    || result.outcome === "server_error_after_payment"
    || result.outcome === "overcharged"
  ) {
    bump("S1", result.outcome);
  }
  if (result.outcome === "empty_result" || result.outcome === "error_body" || result.outcome === "assertion_failed") {
    bump("S2", result.outcome);
  }
  if (result.staleCache) bump("S2", "stale");
  if (result.outcome === "shape_mismatch" || result.outcome === "charged_for_client_error") bump("S3", result.outcome);
  if (
    result.finding === "validates after payment"
    || result.finding === "no required input to invalidate"
    || result.finding === "rejected input without charging"
  ) {
    reasons.push(result.finding);
  }
  if (result.listingDrift.some((item) => item.field === "price")) bump("S4", "price drift");
  if (result.finding === "listed route is dead") bump("S4", "dead route");
  if (result.refusal === "v1-unsupported") bump("S4", "v1-unsupported");
  const redirectFault = postRedirectFault(result);
  if (redirectFault === "method") bump("S4", "POST redirect changed method");
  else if (redirectFault === "header") bump("S4", "POST redirect dropped payment header");
  else if (movedHost(result)) reasons.push("listing URL redirects");

  if (paymentRejected(result)) reasons.push(paymentRejectionDetail(result));

  if (severity === null && result.finding === "rejected input without charging") {
    if (!reasons.includes(result.finding)) reasons.push(result.finding);
    return {
      fault: usedListingSample(result) ? "ours" : null,
      severity: null,
      reasons,
    };
  }

  if (severity === null) {
    if (result.error || (result.refusal && result.outcome !== "pass")) {
      const detail = result.refusal ?? result.error ?? "unknown";
      if (!reasons.includes(detail)) reasons.push(detail);
      return { fault: "indeterminate", severity: null, reasons };
    }
    return { fault: null, severity: null, reasons };
  }
  return { fault: "seller", severity, reasons };
}

function isSellerBand(call: Pick<GradedCall, "fault" | "severity">, band: "S1" | "S2"): boolean {
  return call.fault === "seller" && call.severity !== null && rank(call.severity) <= rank(band);
}

const LOSS_OUTCOMES = new Set([
  "no_delivery",
  "wrong_result",
  "assertion_failed",
  "error_body",
  "timeout_after_payment",
  "server_error_after_payment",
]);

/** Charged amount counts as lost only when nothing usable came back. A format mismatch is a contract breach. */
export function lossAmounts(call: {
  outcome: string | null;
  onchainPaid: boolean | null;
  onchainAmount: string | null;
}): { lossUsd: string; contractBreachUsd: string } {
  const amount = call.onchainPaid === true && call.onchainAmount ? call.onchainAmount : "0.000000";
  if (call.outcome === "shape_mismatch" && call.onchainPaid === true && call.onchainAmount) {
    return { lossUsd: "0.000000", contractBreachUsd: call.onchainAmount };
  }
  if (call.outcome !== null && LOSS_OUTCOMES.has(call.outcome)) {
    return { lossUsd: amount, contractBreachUsd: "0.000000" };
  }
  return { lossUsd: "0.000000", contractBreachUsd: "0.000000" };
}

/** Money still gone after a refund from the same payTo. A refund cannot make this negative. */
export function netLossOf(lossUsd: string, recoveredUsd: string | null | undefined): string {
  try {
    const net = parseQuotedAtomic(lossUsd) - parseQuotedAtomic(recoveredUsd || "0");
    return formatUsdc(net < 0n ? 0n : net);
  } catch {
    return lossUsd;
  }
}

function chainFields(result: GradeSource): { onchainPaid: boolean | null; onchainAmount: string | null } {
  const onchainPaid = typeof result.onchainPaid === "boolean" ? result.onchainPaid : null;
  const onchainAmount = onchainPaid === true && typeof result.onchainAmountUsdc === "string"
    ? result.onchainAmountUsdc
    : null;
  return { onchainPaid, onchainAmount };
}

export interface CallFacts {
  seller: string;
  role: ProbeResult["role"];
  dryRun: boolean;
  sampleFrame: SampleFrame;
  outcome: ProbeResult["outcome"];
  fault: Fault | null;
  severity: Severity | null;
  finding: string | null;
  reasons: string[];
  paid: PaidMark;
  tested: boolean;
  onchainPaid: boolean | null;
  onchainAmount: string | null;
  lossUsd: string;
  netLossUsd: string;
  recoveredUsd: string;
  refundTx: string | null;
  contractBreachUsd: string;
  paymentRejected: boolean;
  priceDrift: boolean;
  sampleCategory: string | null;
  testInduced: boolean;
}

/** One stored call under the current rubric, including chain payment from reconcile. */
export function interpretCall(
  result: GradeSource,
  origins: ReadonlyMap<string, SellerOrigin> = sellerOrigins([result]),
): CallFacts {
  const view = gradeView(result);
  const assessed = view.tested
    ? assessCall(view)
    : { fault: "ours" as const, severity: null, reasons: ["not tested"] };
  const chain = chainFields(result);
  const amounts = lossAmounts({ outcome: view.outcome, ...chain });
  const recoveredUsd = typeof result.recoveredUsd === "string" ? result.recoveredUsd : "0.000000";
  const retest = ownFrame(result.runId) === "retest";
  const origin = retest ? origins.get(sellerHost(view.url)) : undefined;
  return {
    seller: sellerHost(view.url),
    role: view.role,
    dryRun: view.dryRun,
    sampleFrame: origin?.sampleFrame ?? sampleFrameOf(result, origins),
    outcome: view.outcome,
    fault: assessed.fault,
    severity: assessed.severity,
    finding: view.finding,
    reasons: assessed.reasons,
    paid: view.paid,
    tested: view.tested,
    ...chain,
    ...amounts,
    recoveredUsd,
    refundTx: result.refundTx ?? null,
    netLossUsd: netLossOf(amounts.lossUsd, recoveredUsd),
    paymentRejected: paymentRejected(view),
    priceDrift: view.listingDrift.some((item) => item.field === "price"),
    sampleCategory: result.sampleCategory ?? origin?.sampleCategory ?? null,
    testInduced: testInducedOf(view),
  };
}

function stamp(result: ProbeResult): number {
  const value = Date.parse(result.timestamp);
  return Number.isFinite(value) ? value : 0;
}

function windowOf(results: readonly ProbeResult[]): { runId: string | null; rows: ProbeResult[] } {
  const stamped = results.filter((result) => result.runId);
  if (stamped.length === 0) return { runId: null, rows: [...results] };
  let latest = stamped[0]!;
  for (const result of stamped) {
    if (stamp(result) >= stamp(latest)) latest = result;
  }
  const runId = latest.runId;
  return { runId, rows: results.filter((result) => result.runId === runId) };
}

/**
 * Grade stored results. Does not modify them.
 * The window is the latest runId, or the whole file when results have no run id.
 */
export function grade(results: readonly GradeSource[], now: Date = new Date()): GradeReport {
  const sorted = [...results].sort((left, right) => stamp(left) - stamp(right) || left.id.localeCompare(right.id));
  const origins = sellerOrigins(sorted);
  const window = windowOf(sorted);
  const rechecks: { id: string; dueBefore: string }[] = [];
  const seenRecheck = new Set<string>();

  const calls: GradedCall[] = window.rows.map((result) => {
    const facts = interpretCall(result, origins);
    let confirmed: boolean | null = null;
    const sellerHigh = facts.fault === "seller" && (facts.severity === "S1" || facts.severity === "S2");
    if (result.role !== "canary" && result.role !== "prepay" && sellerHigh) {
      if (result.role === "recheck") {
        confirmed = true;
      } else {
        const previous = [...sorted].reverse().find((earlier) => (
          earlier.id === result.id
          && earlier.role !== "canary"
          && earlier.role !== "prepay"
          && earlier.role !== "recheck"
          && stamp(earlier) < stamp(result)
          && (result.runId === null || earlier.runId !== result.runId)
        ));
        const previousFailed = previous ? isSellerBand(toCall(previous, origins), "S2") : false;
        const followUps = sorted.filter((later) => (
          later.id === result.id
          && later.role === "recheck"
          && stamp(later) > stamp(result)
          && stamp(later) <= stamp(result) + RECHECK_MS
        ));
        const recheckFailed = followUps.some((later) => isSellerBand(toCall(later, origins), "S2"));
        confirmed = previousFailed || recheckFailed;
        const due = stamp(result) + RECHECK_MS;
        if (!confirmed && followUps.length === 0 && !seenRecheck.has(result.id) && due >= now.getTime()) {
          seenRecheck.add(result.id);
          rechecks.push({
            id: result.id,
            dueBefore: new Date(due).toISOString(),
          });
        }
      }
    }

    return {
      kind: "call",
      rubricVersion: RUBRIC_VERSION,
      id: result.id,
      seller: sellerHost(result.url),
      url: result.url,
      timestamp: result.timestamp,
      role: result.role,
      runId: result.runId,
      level: result.level,
      checkLevel: result.checkLevel ?? null,
      checkName: result.checkName ?? null,
      outcome: facts.outcome,
      fault: facts.fault,
      severity: facts.severity,
      confirmed,
      reasons: facts.reasons,
      finding: facts.finding,
      sampleFrame: facts.sampleFrame,
      testInduced: facts.testInduced,
      onchainPaid: facts.onchainPaid,
      onchainAmount: facts.onchainAmount,
      lossUsd: facts.lossUsd,
      netLossUsd: facts.netLossUsd,
      recoveredUsd: facts.recoveredUsd,
      refundTx: facts.refundTx,
      contractBreachUsd: facts.contractBreachUsd,
      paid: facts.paid,
      tested: facts.tested,
    };
  });

  const bySeller = new Map<string, GradedCall[]>();
  for (const call of calls) {
    if (call.role === "canary") continue;
    const group = bySeller.get(call.seller) ?? [];
    group.push(call);
    bySeller.set(call.seller, group);
  }

  const sellers: SellerGradeLine[] = [...bySeller.entries()].map(([seller, group]) => {
    const executed = group.filter((call) => (call.role === "probe" || call.role === "recheck") && call.tested);
    const level = executed.reduce((deepest, call) => Math.max(deepest, call.level ?? 0), 0);
    const confirmedHigh = group.some((call) => call.confirmed === true && (call.severity === "S1" || call.severity === "S2"));
    const warn = group.some((call) => call.fault === "seller" && (call.severity === "S3" || call.severity === "S4"));
    const pendingRecheck = rechecks.some((job) => group.some((call) => call.id === job.id));
    const mark: SellerMark = confirmedHigh ? "Fail" : warn ? "Warn" : "Pass";
    return {
      kind: "seller" as const,
      rubricVersion: RUBRIC_VERSION,
      seller,
      grade: mark,
      label: `${mark} (L${level})`,
      level,
      pendingRecheck,
    };
  }).sort((left, right) => left.seller.localeCompare(right.seller));

  const l1 = sellers.filter((seller) => seller.level >= 1);
  const confirmedSellers = l1.filter((seller) => seller.grade === "Fail").length;
  const paidCalls = calls.filter((call) => (call.role === "probe" || call.role === "recheck") && call.tested);
  const sellerFaultCalls = paidCalls.filter((call) => call.fault === "seller").length;
  const canaryCall = [...calls].reverse().find((call) => call.role === "canary") ?? null;
  const runInvalid = calls.some((call) => call.role === "canary" && call.outcome === "pass");

  const summary: PilotSummary = {
    kind: "summary",
    rubricVersion: RUBRIC_VERSION,
    windowRunId: window.runId,
    sellersConfirmedS1S2: confirmedSellers,
    sellersTestedL1: l1.length,
    wilson: wilsonInterval(confirmedSellers, l1.length),
    secondary: {
      label: "secondary",
      calls: paidCalls.length,
      sellerFaultCalls,
      rate: paidCalls.length === 0 ? null : sellerFaultCalls / paidCalls.length,
    },
    runInvalid,
    canary: canaryCall
      ? { id: canaryCall.id, outcome: canaryCall.outcome, ok: canaryCall.outcome === "assertion_failed" }
      : null,
    rechecks,
  };

  return {
    lines: [...calls, ...sellers, summary],
    calls,
    sellers,
    summary,
    rechecks,
  };
}

function toCall(result: GradeSource, origins: ReadonlyMap<string, SellerOrigin>): GradedCall {
  const facts = interpretCall(result, origins);
  return {
    kind: "call",
    rubricVersion: RUBRIC_VERSION,
    id: result.id,
    seller: facts.seller,
    url: result.url,
    timestamp: result.timestamp,
    role: result.role,
    runId: result.runId,
    level: result.level,
    checkLevel: result.checkLevel ?? null,
    checkName: result.checkName ?? null,
    outcome: facts.outcome,
    fault: facts.fault,
    severity: facts.severity,
    confirmed: null,
    reasons: facts.reasons,
    finding: facts.finding,
    sampleFrame: facts.sampleFrame,
    testInduced: facts.testInduced,
    onchainPaid: facts.onchainPaid,
    onchainAmount: facts.onchainAmount,
    lossUsd: facts.lossUsd,
    netLossUsd: facts.netLossUsd,
    recoveredUsd: facts.recoveredUsd,
    refundTx: facts.refundTx,
    contractBreachUsd: facts.contractBreachUsd,
    paid: facts.paid,
    tested: facts.tested,
  };
}

/** The latest run's canary did not fail its planted assertion. */
export function currentRunCanaryFailed(report: GradeReport): boolean {
  return report.summary.canary !== null && report.summary.canary.ok === false;
}
