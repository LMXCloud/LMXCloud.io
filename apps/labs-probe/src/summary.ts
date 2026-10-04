import type { CallFacts, GradeSource, SampleFrame } from "./grade.js";
import { interpretCall, netLossOf, sellerOrigins, wilsonInterval } from "./grade.js";
import { formatUsdc, parseQuotedAtomic } from "./price.js";
import { SAMPLE_CATEGORIES } from "./sample.js";

const NOT_DELIVERED = new Set([
  "no_delivery",
  "error_body",
  "empty_result",
  "timeout_after_payment",
  "server_error_after_payment",
  "charged_for_client_error",
  "overcharged",
]);

export type SummaryFrame = SampleFrame | "combined";

export interface FrameSummary {
  sampleFrame: SummaryFrame;
  sellers: number;
  sellersPaid: number;
  paidNotDelivered: number;
  /** Net loss on calls whose input was a real request. */
  moneyLostUsdc: string;
  /** On-chain charge, net of refund, for deliberately invalid input. */
  testInducedUsd: string;
  contractBreachUsd: string;
  wrongAnswers: number;
  formatMismatches: number;
  paymentRejections: number;
  priceDrift: number;
  wilson: {
    paidNotDelivered: { low: number; high: number; z: number } | null;
    wrongAnswers: { low: number; high: number; z: number } | null;
    formatMismatches: { low: number; high: number; z: number } | null;
    paymentRejections: { low: number; high: number; z: number } | null;
    priceDrift: { low: number; high: number; z: number } | null;
  };
}

function counted(call: CallFacts): boolean {
  return !call.dryRun && call.tested && call.role !== "prepay" && call.role !== "canary";
}

function frameOf(calls: readonly CallFacts[], sampleFrame: SummaryFrame): FrameSummary {
  const rows = sampleFrame === "combined" ? calls : calls.filter((call) => call.sampleFrame === sampleFrame);
  const sellers = new Set(rows.map((call) => call.seller));
  const paidSellers = new Set(rows.filter((call) => call.onchainPaid === true).map((call) => call.seller));
  const paidNotDelivered = new Set(
    rows.filter((call) => call.onchainPaid === true && call.outcome !== null && NOT_DELIVERED.has(call.outcome)).map((call) => call.seller),
  );
  const wrongAnswers = new Set(
    rows.filter((call) => call.onchainPaid === true && call.outcome === "assertion_failed").map((call) => call.seller),
  );
  const formatMismatches = new Set(
    rows.filter((call) => call.onchainPaid === true && call.outcome === "shape_mismatch").map((call) => call.seller),
  );
  const paymentRejections = new Set(rows.filter((call) => call.paymentRejected).map((call) => call.seller));
  const priceDrift = new Set(rows.filter((call) => call.priceDrift).map((call) => call.seller));

  let lost = 0n;
  let induced = 0n;
  let breach = 0n;
  for (const call of rows) {
    if (call.testInduced) induced += inducedCharge(call);
    else lost += parseQuotedAtomic(call.netLossUsd);
    breach += parseQuotedAtomic(call.contractBreachUsd);
  }

  const paid = paidSellers.size;
  const attempted = sellers.size;
  return {
    sampleFrame,
    sellers: attempted,
    sellersPaid: paid,
    paidNotDelivered: paidNotDelivered.size,
    moneyLostUsdc: formatUsdc(lost),
    testInducedUsd: formatUsdc(induced),
    contractBreachUsd: formatUsdc(breach),
    wrongAnswers: wrongAnswers.size,
    formatMismatches: formatMismatches.size,
    paymentRejections: paymentRejections.size,
    priceDrift: priceDrift.size,
    wilson: {
      paidNotDelivered: wilsonInterval(paidNotDelivered.size, paid),
      wrongAnswers: wilsonInterval(wrongAnswers.size, paid),
      formatMismatches: wilsonInterval(formatMismatches.size, paid),
      paymentRejections: wilsonInterval(paymentRejections.size, attempted),
      priceDrift: wilsonInterval(priceDrift.size, attempted),
    },
  };
}

/** On-chain amount still gone after a refund. Zero when the call was not charged. */
function inducedCharge(call: CallFacts): bigint {
  if (call.onchainPaid !== true || !call.onchainAmount) return 0n;
  return parseQuotedAtomic(netLossOf(call.onchainAmount, call.recoveredUsd));
}

/** Seller counts across every stored run, split by sample frame, plus the combined row. */
export function summarize(results: readonly GradeSource[]): FrameSummary[] {
  const origins = sellerOrigins(results);
  const calls = results.map((result) => interpretCall(result, origins)).filter(counted);
  return [frameOf(calls, "pilot"), frameOf(calls, "random"), frameOf(calls, "random-r3"), frameOf(calls, "combined")];
}

export interface CategorySummary {
  category: string;
  sellers: number;
  sellersPaid: number;
  moneyLostUsdc: string;
  testInducedUsd: string;
  contractBreachUsd: string;
  pass: number;
  formatMismatches: number;
  notDelivered: number;
  paymentRejections: number;
}

/** Per-category seller counts for the higher-value sample. Other frames are left out. */
export function summarizeCategories(results: readonly GradeSource[]): CategorySummary[] {
  const origins = sellerOrigins(results);
  const calls = results
    .map((result) => interpretCall(result, origins))
    .filter((call) => counted(call) && call.sampleFrame === "random-r3");
  const present = new Set(calls.map((call) => call.sampleCategory ?? "other"));
  const categories = [
    ...SAMPLE_CATEGORIES.filter((category) => present.has(category)),
    ...[...present].filter((category) => !SAMPLE_CATEGORIES.includes(category as (typeof SAMPLE_CATEGORIES)[number])),
  ];
  return categories.map((category) => {
    const rows = calls.filter((call) => (call.sampleCategory ?? "other") === category);
    const sellers = new Set(rows.map((call) => call.seller));
    const paid = rows.filter((call) => call.onchainPaid === true);
    let lost = 0n;
    let induced = 0n;
    let breach = 0n;
    for (const call of rows) {
      if (call.testInduced) induced += inducedCharge(call);
      else lost += parseQuotedAtomic(call.netLossUsd);
      breach += parseQuotedAtomic(call.contractBreachUsd);
    }
    return {
      category,
      sellers: sellers.size,
      sellersPaid: new Set(paid.map((call) => call.seller)).size,
      moneyLostUsdc: formatUsdc(lost),
      testInducedUsd: formatUsdc(induced),
      contractBreachUsd: formatUsdc(breach),
      pass: rows.filter((call) => call.outcome === "pass").length,
      formatMismatches: paid.filter((call) => call.outcome === "shape_mismatch").length,
      notDelivered: paid.filter((call) => call.outcome !== null && NOT_DELIVERED.has(call.outcome)).length,
      paymentRejections: rows.filter((call) => call.paymentRejected).length,
    };
  });
}

export function formatCategoryTable(rows: readonly CategorySummary[]): string {
  if (rows.length === 0) return "categories  none";
  const header = ["category", "sellers", "sellers paid", "money lost", "test-induced", "contract breach", "pass", "format mismatches", "paid-not-delivered", "payment rejections"];
  const lines = rows.map((row) => [
    row.category,
    String(row.sellers),
    String(row.sellersPaid),
    `$${row.moneyLostUsdc}`,
    `$${row.testInducedUsd}`,
    `$${row.contractBreachUsd}`,
    String(row.pass),
    String(row.formatMismatches),
    String(row.notDelivered),
    String(row.paymentRejections),
  ]);
  const widths = header.map((name, index) => Math.max(name.length, ...lines.map((line) => line[index]?.length ?? 0)));
  const render = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [render(header), ...lines.map(render)].join("\n");
}

function rate(count: number, total: number, interval: { low: number; high: number } | null): string {
  if (total <= 0) return String(count);
  const ratio = `${count}/${total}`;
  if (!interval) return ratio;
  return `${ratio} [${interval.low.toFixed(3)}, ${interval.high.toFixed(3)}]`;
}

/** One text table. Wilson intervals use sellers paid, except rejections and price drift, which use sellers attempted. */
export function formatSummaryTable(frames: readonly FrameSummary[]): string {
  const header = [
    "sampleFrame",
    "sellers",
    "sellers paid",
    "paid-not-delivered",
    "money lost",
    "test-induced",
    "contract breach",
    "wrong answers",
    "format mismatches",
    "payment rejections",
    "price drift",
  ];
  const lines = frames.map((frame) => [
    frame.sampleFrame,
    String(frame.sellers),
    String(frame.sellersPaid),
    rate(frame.paidNotDelivered, frame.sellersPaid, frame.wilson.paidNotDelivered),
    `$${frame.moneyLostUsdc}`,
    `$${frame.testInducedUsd}`,
    `$${frame.contractBreachUsd}`,
    rate(frame.wrongAnswers, frame.sellersPaid, frame.wilson.wrongAnswers),
    rate(frame.formatMismatches, frame.sellersPaid, frame.wilson.formatMismatches),
    rate(frame.paymentRejections, frame.sellers, frame.wilson.paymentRejections),
    rate(frame.priceDrift, frame.sellers, frame.wilson.priceDrift),
  ]);
  const widths = header.map((name, index) => Math.max(name.length, ...lines.map((line) => line[index]?.length ?? 0)));
  const render = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [render(header), ...lines.map(render)].join("\n");
}
