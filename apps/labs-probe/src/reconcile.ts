import { createPublicClient, getAddress, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";

import { normalizeNonce, type PaymentAuth } from "./auth.js";
import type { ProbeResult } from "./probe.js";
import { BASE_USDC, formatUsdc, parseQuotedAtomic } from "./price.js";
import { baseRpcUrls, retryRead } from "./rpc.js";
import { countsAgainstSeller, type ProbeOutcome } from "./verdict.js";

const USDC_ABI = [
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
  parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"),
] as const;

const LOG_CHUNK = 1_000n;

export interface OutgoingTransfer {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
}

/** USDC sent to the Labs wallet. blockTimestamp is unix seconds. */
export interface IncomingTransfer extends OutgoingTransfer {
  blockTimestamp: number;
}

/** A payTo refund counts only inside this window after the call. */
export const REFUND_WINDOW_MS = 30 * 60 * 1000;

export interface AuthorizationUsedLog {
  txHash: string;
  logIndex: number;
  authorizer: string;
  nonce: string;
}

export interface ReconciledResult extends ProbeResult {
  /** Final paid verdict. True only when a chain movement matched this result. */
  paid: boolean;
  onchainPaid: boolean;
  onchainAmountUsdc: string | null;
  onchainTx: string | null;
  /** USDC received back from this call's payTo within 30 minutes. */
  recoveredUsd: string;
  refundTx: string | null;
  reconciledAt: string;
  /** Settled amount broke the quote, or one call moved USDC more than once. */
  overcharged: boolean;
  overchargeReason: string | null;
  /** Signed payment not found in this pass. A later reconcile finalizes it. */
  settlementPending?: boolean;
}

/**
 * exact must settle equal to the quote. upto must settle at or under the quote.
 * More than one transfer for one call is a double charge.
 */
export function overchargeOf(args: {
  scheme: string | null;
  quotedPriceUsdc: string | null;
  settledAtomic: bigint | null;
  transferCount: number;
  authCount: number;
}): { overcharged: boolean; overchargeReason: string | null } {
  const reasons: string[] = [];
  if (args.settledAtomic !== null && args.quotedPriceUsdc) {
    try {
      const quoted = parseQuotedAtomic(args.quotedPriceUsdc);
      if (args.scheme === "upto") {
        if (args.settledAtomic > quoted) {
          reasons.push(`upto settled ${formatUsdc(args.settledAtomic)} above quoted ${args.quotedPriceUsdc}`);
        }
      } else if (args.settledAtomic !== quoted) {
        reasons.push(`exact settled ${formatUsdc(args.settledAtomic)} != quoted ${args.quotedPriceUsdc}`);
      }
    } catch {
      // An unreadable quote is not an overcharge.
    }
  }
  const calls = Math.max(args.authCount, 1);
  if (args.transferCount > 1 && args.transferCount > calls) {
    reasons.push(`double charge: ${args.transferCount} transfers for ${calls} call(s)`);
  }
  return {
    overcharged: reasons.length > 0,
    overchargeReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

function applyOvercharge(
  result: ProbeResult,
  charge: { overcharged: boolean; overchargeReason: string | null },
): { outcome: ProbeOutcome | null; sellerFault: boolean } {
  if (!charge.overcharged) return { outcome: result.outcome ?? null, sellerFault: result.sellerFault ?? false };
  if (result.outcome == null || result.outcome === "pass") {
    return { outcome: "overcharged", sellerFault: true };
  }
  return {
    outcome: result.outcome,
    sellerFault: result.sellerFault || countsAgainstSeller("overcharged"),
  };
}

/** A USDC transfer out of the Labs wallet that matched no probe result. */
export interface UnattributedTransfer {
  kind: "unattributed";
  from: string;
  to: string;
  onchainAmountUsdc: string;
  onchainTx: string;
  logIndex: number;
  reconciledAt: string;
}

export type ReconcileLine = ReconciledResult | UnattributedTransfer;

export function resultKey(result: { runId?: string | null; role?: string; id: string; timestamp: string }): string {
  return `${result.runId ?? ""}|${result.role ?? ""}|${result.id}|${result.timestamp}`;
}

/** Minutes from the oldest stored result to now, plus a buffer so that result's transfer is inside the log scan. */
export function minutesCovering(results: readonly { timestamp: string }[], now: Date, bufferMinutes = 10): number {
  let oldest = now.getTime();
  for (const result of results) {
    const stamped = Date.parse(result.timestamp);
    if (Number.isFinite(stamped)) oldest = Math.min(oldest, stamped);
  }
  return Math.max(1, Math.ceil((now.getTime() - oldest) / 60_000) + bufferMinutes);
}

/**
 * Incoming lines replace the same call. Result lines from earlier runs stay.
 * A full scan replaces unattributed transfers. A short scan keeps ones it did not see.
 */
export function mergeReconciled(
  previous: readonly unknown[],
  incoming: readonly ReconcileLine[],
  replaceUnattributed: boolean,
): ReconcileLine[] {
  const incomingByKey = new Map<string, ReconciledResult>();
  const unattributed: UnattributedTransfer[] = [];
  const matchedTx = new Set<string>();
  for (const line of incoming) {
    if ("kind" in line && line.kind === "unattributed") {
      unattributed.push(line);
      continue;
    }
    if ("kind" in line) continue;
    incomingByKey.set(resultKey(line), line);
    if (line.onchainTx) matchedTx.add(line.onchainTx.toLowerCase());
  }

  const kept: ReconciledResult[] = [];
  const oldUnattributed: UnattributedTransfer[] = [];
  for (const line of previous) {
    if (!line || typeof line !== "object") continue;
    const record = line as ReconcileLine;
    if ("kind" in record && record.kind === "unattributed") {
      if (replaceUnattributed) continue;
      const id = `${record.onchainTx.toLowerCase()}:${record.logIndex}`;
      const seen = unattributed.some((item) => `${item.onchainTx.toLowerCase()}:${item.logIndex}` === id)
        || matchedTx.has(record.onchainTx.toLowerCase());
      if (!seen) oldUnattributed.push(record);
      continue;
    }
    if ("kind" in record) continue;
    if (typeof record.id !== "string" || typeof record.timestamp !== "string") continue;
    if (incomingByKey.has(resultKey(record))) continue;
    kept.push(record);
  }
  return [...kept, ...incomingByKey.values(), ...oldUnattributed, ...unattributed];
}

/** Keys left pending by the previous reconcile pass. A later pass finalizes them. */
export function pendingKeys(lines: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const record = line as {
      kind?: string;
      settlementPending?: boolean;
      id?: string;
      timestamp?: string;
      runId?: string | null;
      role?: string;
    };
    if (record.kind === "unattributed" || record.settlementPending !== true) continue;
    if (typeof record.id !== "string" || typeof record.timestamp !== "string") continue;
    keys.add(resultKey({
      runId: record.runId,
      role: record.role,
      id: record.id,
      timestamp: record.timestamp,
    }));
  }
  return keys;
}

export function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function transferKey(transfer: OutgoingTransfer): string {
  return `${transfer.txHash.toLowerCase()}:${transfer.logIndex}`;
}

function isDelivery(result: ProbeResult): boolean {
  const status = result.httpStatus;
  if (status === null || status < 200 || status >= 300) return false;
  if (result.errorLikeBody) return false;
  return (result.bodyBytes ?? 0) > 0;
}

function withChain(
  result: ProbeResult,
  match: OutgoingTransfer | null,
  reconciledAt: string,
  activity: { transferCount: number; authCount: number },
  pending: boolean,
): ReconciledResult {
  const onchainPaid = match !== null && match.value > 0n;
  const settlementPending = pending && !onchainPaid && result.paymentAuth !== null;
  const delivered = onchainPaid && isDelivery(result);
  const formatFail = onchainPaid && result.formatMatched === false;
  const noDelivery = onchainPaid && !delivered;
  const charge = overchargeOf({
    scheme: result.scheme,
    quotedPriceUsdc: result.quotedPriceUsdc,
    settledAtomic: match ? match.value : null,
    transferCount: match ? activity.transferCount : 0,
    authCount: match ? activity.authCount : 0,
  });
  const verdict = applyOvercharge(result, charge);
  return {
    ...result,
    paid: onchainPaid,
    onchainPaid,
    onchainAmountUsdc: match ? formatUsdc(match.value) : null,
    onchainTx: match ? match.txHash : null,
    reconciledAt,
    delivered,
    noDelivery,
    formatFail,
    paidButNoDelivery: result.outcome === "input_fault" ? false : noDelivery || formatFail,
    outcome: verdict.outcome,
    sellerFault: result.outcome === "input_fault" ? false : verdict.sellerFault,
    overcharged: charge.overcharged,
    overchargeReason: charge.overchargeReason,
    recoveredUsd: "0.000000",
    refundTx: null,
    ...(settlementPending ? { settlementPending: true } : {}),
  };
}

function sellerPayTo(result: ProbeResult, match: OutgoingTransfer | null): string | null {
  if (match?.to) return match.to;
  if (result.paymentAuth?.scheme === "upto") return result.paymentAuth.payTo;
  const requirements = result.paymentRequirements;
  if (!requirements || typeof requirements !== "object") return null;
  const accepts = (requirements as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) return null;
  for (const accept of accepts) {
    if (!accept || typeof accept !== "object") continue;
    const payTo = (accept as { payTo?: unknown }).payTo;
    if (typeof payTo === "string" && payTo.startsWith("0x")) return payTo;
  }
  return null;
}

/**
 * Incoming USDC from a call's payTo, at or after the call and within 30 minutes.
 * One transfer is used once, on the latest matching call.
 */
export function matchRefunds(
  calls: readonly { payTo: string | null; timestamp: string }[],
  incoming: readonly IncomingTransfer[],
  labsAddress: string,
): { recoveredAtomic: bigint; refundTx: string | null }[] {
  const totals = calls.map(() => ({ recoveredAtomic: 0n, refundTx: null as string | null }));
  const ordered = [...incoming].sort((left, right) => left.blockTimestamp - right.blockTimestamp || left.logIndex - right.logIndex);
  for (const transfer of ordered) {
    if (transfer.value <= 0n || !sameAddress(transfer.to, labsAddress)) continue;
    const at = transfer.blockTimestamp * 1000;
    let best = -1;
    let bestStart = -1;
    calls.forEach((call, index) => {
      if (!call.payTo || !sameAddress(transfer.from, call.payTo)) return;
      const start = Date.parse(call.timestamp);
      if (!Number.isFinite(start)) return;
      if (at < start - 120_000 || at > start + REFUND_WINDOW_MS) return;
      if (start >= bestStart) {
        best = index;
        bestStart = start;
      }
    });
    if (best < 0) continue;
    const slot = totals[best];
    if (!slot) continue;
    slot.recoveredAtomic += transfer.value;
    if (!slot.refundTx) slot.refundTx = transfer.txHash;
  }
  return totals;
}

/**
 * Pair each AuthorizationUsed with the next USDC Transfer from that authorizer
 * in the same transaction. That is the EIP-3009 transferWithAuthorization order.
 * Every transfer used in a pair is consumed, including a nonce that showed up twice.
 */
export function pairAuthorizations(
  authorizations: AuthorizationUsedLog[],
  transfers: OutgoingTransfer[],
): { pairs: Map<string, OutgoingTransfer>; consumed: Set<string> } {
  const byTx = new Map<string, { auths: AuthorizationUsedLog[]; transfers: OutgoingTransfer[] }>();
  for (const auth of authorizations) {
    const tx = auth.txHash.toLowerCase();
    const group = byTx.get(tx) ?? { auths: [], transfers: [] };
    group.auths.push(auth);
    byTx.set(tx, group);
  }
  for (const transfer of transfers) {
    const tx = transfer.txHash.toLowerCase();
    const group = byTx.get(tx);
    if (group) group.transfers.push(transfer);
  }

  const pairs = new Map<string, OutgoingTransfer>();
  const consumed = new Set<string>();
  const ambiguous = new Set<string>();
  for (const group of byTx.values()) {
    const auths = [...group.auths].sort((a, b) => a.logIndex - b.logIndex);
    const available = [...group.transfers].sort((a, b) => a.logIndex - b.logIndex);
    for (const auth of auths) {
      const nonce = normalizeNonce(auth.nonce);
      const match = available.find(
        (transfer) => transfer.logIndex > auth.logIndex && sameAddress(transfer.from, auth.authorizer),
      );
      if (!match) continue;
      available.splice(available.indexOf(match), 1);
      consumed.add(transferKey(match));
      if (pairs.has(nonce) || ambiguous.has(nonce)) {
        pairs.delete(nonce);
        ambiguous.add(nonce);
        continue;
      }
      pairs.set(nonce, match);
    }
  }
  return { pairs, consumed };
}

function uptoFits(auth: Extract<PaymentAuth, { scheme: "upto" }>, transfer: OutgoingTransfer): boolean {
  let max: bigint;
  try {
    max = BigInt(auth.maxAmountAtomic);
  } catch {
    return false;
  }
  return transfer.value > 0n && transfer.value <= max && sameAddress(transfer.to, auth.payTo);
}

/**
 * Assign upto results only when one result and one transfer are each other's only candidate.
 * Repeat so a resolved pair can unblock the next. Anything still shared stays unmatched.
 */
function matchUpto(
  results: ProbeResult[],
  transfers: OutgoingTransfer[],
  taken: Set<string>,
): Map<number, OutgoingTransfer> {
  const waiting = results.flatMap((result, index) => {
    const auth = result.paymentAuth;
    if (auth?.scheme !== "upto") return [];
    return [{ auth, index }];
  });
  const assigned = new Map<number, OutgoingTransfer>();
  const used = new Set(taken);
  let progressed = true;
  while (progressed) {
    progressed = false;
    const free = transfers.filter((transfer) => transfer.value > 0n && !used.has(transferKey(transfer)));
    const open = waiting.filter((item) => !assigned.has(item.index));
    for (const item of open) {
      const options = free.filter((transfer) => uptoFits(item.auth, transfer));
      if (options.length !== 1) continue;
      const transfer = options[0];
      if (!transfer) continue;
      const claimants = open.filter((other) => uptoFits(other.auth, transfer));
      if (claimants.length !== 1) continue;
      assigned.set(item.index, transfer);
      used.add(transferKey(transfer));
      progressed = true;
    }
  }
  return assigned;
}

export function reconcile(args: {
  results: ProbeResult[];
  transfers: OutgoingTransfer[];
  incoming?: IncomingTransfer[];
  authorizations: AuthorizationUsedLog[];
  labsAddress: string;
  sinceMinutes: number;
  now?: Date;
  /** Signed payments from this run that are missing on chain stay pending instead of unpaid. */
  pendingRunId?: string;
  /** Results outside the time window that a previous pass left pending. */
  alsoInclude?: (result: ProbeResult) => boolean;
}): { lines: ReconcileLine[]; onchainPaid: number; unattributed: number; pending: number } {
  const now = args.now ?? new Date();
  const reconciledAt = now.toISOString();
  const cutoff = now.getTime() - args.sinceMinutes * 60_000;
  const inWindow = args.results.filter((result) => {
    if (args.alsoInclude?.(result)) return true;
    const stamped = Date.parse(result.timestamp);
    return Number.isFinite(stamped) && stamped >= cutoff;
  });

  const outgoing = args.transfers.filter(
    (transfer) => transfer.value > 0n && sameAddress(transfer.from, args.labsAddress),
  );
  const auths = args.authorizations.filter((auth) => sameAddress(auth.authorizer, args.labsAddress));
  const { pairs: paired, consumed } = pairAuthorizations(auths, outgoing);

  const exactClaims = new Map<string, number>();
  inWindow.forEach((result, index) => {
    const auth = result.paymentAuth;
    if (auth?.scheme !== "exact") return;
    if (!sameAddress(auth.authorizer, args.labsAddress)) return;
    let nonce: string;
    try {
      nonce = normalizeNonce(auth.nonce);
    } catch {
      return;
    }
    const prior = exactClaims.get(nonce);
    exactClaims.set(nonce, prior === undefined ? index : -1);
  });

  const taken = new Set(consumed);
  const exactMatch = new Map<number, OutgoingTransfer>();
  for (const [nonce, index] of exactClaims) {
    if (index < 0) continue;
    const transfer = paired.get(nonce);
    if (!transfer) continue;
    exactMatch.set(index, transfer);
  }

  const uptoMatch = matchUpto(inWindow, outgoing, taken);
  for (const transfer of uptoMatch.values()) taken.add(transferKey(transfer));

  const txActivity = (tx: string) => {
    const key = tx.toLowerCase();
    return {
      transferCount: outgoing.filter((transfer) => transfer.txHash.toLowerCase() === key).length,
      authCount: auths.filter((auth) => auth.txHash.toLowerCase() === key).length,
    };
  };
  const matched = inWindow.map((result, index) => ({
    result,
    match: exactMatch.get(index) ?? uptoMatch.get(index) ?? null,
  }));
  const doubleTxs = new Set<string>();
  for (const item of matched) {
    if (!item.match) continue;
    const activity = txActivity(item.match.txHash);
    const charge = overchargeOf({
      scheme: item.result.scheme,
      quotedPriceUsdc: item.result.quotedPriceUsdc,
      settledAtomic: item.match.value,
      transferCount: activity.transferCount,
      authCount: activity.authCount,
    });
    if (charge.overchargeReason?.includes("double charge")) doubleTxs.add(item.match.txHash.toLowerCase());
  }

  const refunds = matchRefunds(
    matched.map((item) => ({ payTo: sellerPayTo(item.result, item.match), timestamp: item.result.timestamp })),
    args.incoming ?? [],
    args.labsAddress,
  );
  const lines: ReconcileLine[] = matched.map((item, index) => {
    const refund = refunds[index] ?? { recoveredAtomic: 0n, refundTx: null };
    return {
      ...withChain(
        item.result,
        item.match,
        reconciledAt,
        item.match ? txActivity(item.match.txHash) : { transferCount: 0, authCount: 0 },
        args.pendingRunId !== undefined && item.result.runId === args.pendingRunId,
      ),
      recoveredUsd: formatUsdc(refund.recoveredAtomic),
      refundTx: refund.refundTx,
    };
  });

  const unattributed = outgoing
    .filter((transfer) => (
      !exactMatchHas(transfer, exactMatch)
      && !uptoMatchHas(transfer, uptoMatch)
      && !doubleTxs.has(transfer.txHash.toLowerCase())
    ))
    .sort((a, b) => a.txHash.localeCompare(b.txHash) || a.logIndex - b.logIndex);

  for (const transfer of unattributed) {
    lines.push({
      kind: "unattributed",
      from: transfer.from,
      to: transfer.to,
      onchainAmountUsdc: formatUsdc(transfer.value),
      onchainTx: transfer.txHash,
      logIndex: transfer.logIndex,
      reconciledAt,
    });
  }

  const paid = lines.filter((line) => !("kind" in line) && line.onchainPaid).length;
  const pending = lines.filter((line) => !("kind" in line) && line.settlementPending === true).length;
  return { lines, onchainPaid: paid, unattributed: unattributed.length, pending };
}

function exactMatchHas(transfer: OutgoingTransfer, matches: Map<number, OutgoingTransfer>): boolean {
  for (const match of matches.values()) {
    if (transferKey(match) === transferKey(transfer)) return true;
  }
  return false;
}

function uptoMatchHas(transfer: OutgoingTransfer, matches: Map<number, OutgoingTransfer>): boolean {
  return exactMatchHas(transfer, matches);
}

async function blockNear(
  client: { getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }> },
  latest: bigint,
  targetTimestamp: bigint,
): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp < targetTimestamp) lo = mid + 1n;
    else hi = mid;
  }
  return lo > 5n ? lo - 5n : 0n;
}

/** Block span advertised by an eth_getLogs rejection, or 0 when the span must be halved. */
export function logRangeCap(error: unknown): bigint | null {
  const message = errorText(error);
  if (!/block range|too many blocks|limited to|exceeds max|query returned more than/i.test(message)) return null;
  const caps = [...message.matchAll(/(\d+)\s*blocks/gi)]
    .map((match) => BigInt(match[1] ?? "0"))
    .filter((cap) => cap > 0n);
  return caps.length > 0 ? caps[caps.length - 1]! : 0n;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = "details" in error && typeof error.details === "string" ? error.details : "";
  const cause = error.cause ? errorText(error.cause) : "";
  return `${error.message} ${details} ${cause}`;
}

function isRateLimit(error: unknown): boolean {
  return /rate limit|too many requests|429/i.test(errorText(error));
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A few quick retries, then longer waits when the endpoint is rate limiting. */
async function readLogsOnce<T>(read: () => Promise<readonly T[]>): Promise<readonly T[]> {
  let last: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      if (logRangeCap(error) !== null) throw error;
      const limited = isRateLimit(error);
      if (!limited && attempt >= 3) break;
      if (attempt === 8) break;
      await pause(limited ? 1_000 * 2 ** (attempt - 1) : 500 * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function getLogsRange<T>(
  read: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
  start: bigint,
  end: bigint,
): Promise<T[]> {
  try {
    return [...await readLogsOnce(() => read(start, end))];
  } catch (error) {
    const cap = logRangeCap(error);
    const span = end - start + 1n;
    if (cap === null || span <= 1n) throw error;
    const step = cap > 0n && cap < span ? cap : span / 2n;
    if (step < 1n || step >= span) throw error;
    const logs: T[] = [];
    for (let cursor = start; cursor <= end; cursor += step) {
      const sliceEnd = cursor + step - 1n > end ? end : cursor + step - 1n;
      logs.push(...await getLogsRange(read, cursor, sliceEnd));
    }
    return logs;
  }
}

/**
 * First Base RPC that accepts a filtered getLogs of LOG_CHUNK blocks.
 * A range rejection is remembered so the scan can use that endpoint's cap.
 */
async function openLogClient(
  rpcUrl: string | null | undefined,
  usdc: Address,
  labs: Address,
) {
  let last: unknown;
  let ranged: { url: string; cap: bigint } | null = null;
  for (const url of baseRpcUrls(rpcUrl)) {
    const client = createPublicClient({
      chain: base,
      transport: http(url, { retryCount: 0, timeout: 12_000 }),
    });
    try {
      const latest = await client.getBlockNumber();
      const from = latest + 1n > LOG_CHUNK ? latest + 1n - LOG_CHUNK : 0n;
      await client.getLogs({
        address: usdc,
        event: USDC_ABI[0],
        args: { from: labs },
        fromBlock: from,
        toBlock: latest,
      });
      return { client, latest, chunk: LOG_CHUNK };
    } catch (error) {
      last = error;
      const cap = logRangeCap(error);
      if (cap !== null && cap > 0n) ranged = { url, cap };
    }
  }
  if (ranged) {
    const client = createPublicClient({
      chain: base,
      transport: http(ranged.url, { retryCount: 0, timeout: 12_000 }),
    });
    const latest = await retryRead(() => client.getBlockNumber());
    return { client, latest, chunk: ranged.cap };
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** USDC transfers out of the Labs wallet, and AuthorizationUsed logs for that wallet. */
export async function fetchUsdcActivity(args: {
  rpcUrl?: string | null;
  labsAddress: Address;
  sinceMinutes: number;
  now?: Date;
}): Promise<{ transfers: OutgoingTransfer[]; incoming: IncomingTransfer[]; authorizations: AuthorizationUsedLog[] }> {
  const usdc = getAddress(BASE_USDC);
  const labs = getAddress(args.labsAddress);
  const { client, latest, chunk } = await openLogClient(args.rpcUrl, usdc, labs);
  const now = args.now ?? new Date();
  const target = BigInt(Math.floor((now.getTime() - args.sinceMinutes * 60_000) / 1000));
  const fromBlock = await blockNear({
    getBlock: (blockArgs) => retryRead(() => client.getBlock(blockArgs)),
  }, latest, target);

  const transfers: OutgoingTransfer[] = [];
  const incomingLogs: { txHash: string; logIndex: number; from: string; to: string; value: bigint; blockNumber: bigint }[] = [];
  const authorizations: AuthorizationUsedLog[] = [];
  for (let start = fromBlock; start <= latest; start += chunk) {
    const end = start + chunk - 1n > latest ? latest : start + chunk - 1n;
    const transferLogs = await getLogsRange((fromBlock, toBlock) => client.getLogs({
      address: usdc,
      event: USDC_ABI[0],
      args: { from: labs },
      fromBlock,
      toBlock,
    }), start, end);
    const authLogs = await getLogsRange((fromBlock, toBlock) => client.getLogs({
      address: usdc,
      event: USDC_ABI[1],
      args: { authorizer: labs },
      fromBlock,
      toBlock,
    }), start, end);
    const inboundLogs = await getLogsRange((fromBlock, toBlock) => client.getLogs({
      address: usdc,
      event: USDC_ABI[0],
      args: { to: labs },
      fromBlock,
      toBlock,
    }), start, end);
    await pause(150);
    for (const log of transferLogs) {
      if (log.logIndex === null || log.args.from === undefined || log.args.to === undefined || log.args.value === undefined) {
        continue;
      }
      transfers.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        from: log.args.from,
        to: log.args.to,
        value: log.args.value,
      });
    }
    for (const log of authLogs) {
      if (log.logIndex === null || log.args.authorizer === undefined || log.args.nonce === undefined) continue;
      authorizations.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        authorizer: log.args.authorizer,
        nonce: log.args.nonce,
      });
    }
    for (const log of inboundLogs) {
      if (log.logIndex === null || log.blockNumber === null || log.args.from === undefined || log.args.to === undefined || log.args.value === undefined) {
        continue;
      }
      incomingLogs.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        from: log.args.from,
        to: log.args.to,
        value: log.args.value,
        blockNumber: log.blockNumber,
      });
    }
  }

  const blockTime = new Map<string, number>();
  const incoming: IncomingTransfer[] = [];
  for (const log of incomingLogs) {
    const key = log.blockNumber.toString();
    let stamped = blockTime.get(key);
    if (stamped === undefined) {
      const block = await retryRead(() => client.getBlock({ blockNumber: log.blockNumber }));
      stamped = Number(block.timestamp);
      blockTime.set(key, stamped);
      await pause(40);
    }
    incoming.push({
      txHash: log.txHash,
      logIndex: log.logIndex,
      from: log.from,
      to: log.to,
      value: log.value,
      blockTimestamp: stamped,
    });
  }

  return { transfers, incoming, authorizations };
}
