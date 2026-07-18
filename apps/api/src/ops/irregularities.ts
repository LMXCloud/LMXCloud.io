import type { McpToolEvent } from "./mcp-events.js";
import type {
  OpsPaymentRow,
  OpsUsageDayBucket,
  OpsUsageSummary,
  StuckPaymentSummary,
} from "./queries.js";

export type IrregularitySeverity = "info" | "warn" | "critical";

export type OpsIrregularity = {
  id: string;
  severity: IrregularitySeverity;
  category: "health" | "payments" | "usage" | "mcp" | "config";
  title: string;
  detail: string;
  action: string;
  metric?: string;
  relatedIds?: string[];
};

export type DetectIrregularitiesInput = {
  windowDays: number;
  storage: "postgres" | "file";
  x402Enabled: boolean;
  paymentStoreReady: boolean;
  healthyCount: number;
  providerCount: number;
  unhealthyProviders: string[];
  paymentStatusCounts: Record<string, number>;
  stuckPayments: StuckPaymentSummary[];
  usageSummary: OpsUsageSummary;
  usageHistory: OpsUsageDayBucket[];
  mcpEvents: McpToolEvent[];
  recentPayments: OpsPaymentRow[];
};

const SEVERITY_RANK: Record<IrregularitySeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return (part / whole) * 100;
}

export function detectIrregularities(
  input: DetectIrregularitiesInput,
): OpsIrregularity[] {
  const out: OpsIrregularity[] = [];

  if (input.providerCount === 0) {
    out.push({
      id: "health.no_providers",
      severity: "critical",
      category: "health",
      title: "No providers configured",
      detail: "The API has an empty provider registry — inference cannot succeed.",
      action: "Check IONET_API_KEY / AKASHML_API_KEY (and Together if used) on the API service.",
    });
  } else if (input.healthyCount === 0) {
    out.push({
      id: "health.all_down",
      severity: "critical",
      category: "health",
      title: "All providers unhealthy",
      detail: `0/${input.providerCount} providers passed the latest health check.`,
      action: "Inspect provider dashboards/API keys; traffic will 5xx until at least one recovers.",
      relatedIds: input.unhealthyProviders,
    });
  } else if (input.unhealthyProviders.length > 0) {
    out.push({
      id: "health.partial",
      severity: "warn",
      category: "health",
      title: "Provider(s) unhealthy",
      detail: `Down: ${input.unhealthyProviders.join(", ")}. Fallback chain still has ${input.healthyCount} healthy.`,
      action: "Confirm the unhealthy provider will recover or keep fallback capacity warm.",
      relatedIds: input.unhealthyProviders,
      metric: `${input.healthyCount}/${input.providerCount} up`,
    });
  }

  if (input.x402Enabled && !input.paymentStoreReady) {
    out.push({
      id: "config.x402_without_store",
      severity: "critical",
      category: "config",
      title: "x402 enabled but payment store disabled",
      detail: "X402_ENABLED is true without a Postgres payment store — paid calls cannot persist.",
      action: "Set DATABASE_URL (and TREASURY_ADDRESS) so payment_events is available.",
    });
  }

  if (input.storage === "file") {
    out.push({
      id: "config.file_storage",
      severity: "warn",
      category: "config",
      title: "Running on file storage",
      detail: "Usage/keys are not using Neon Postgres — data resets with the container and ops metrics are incomplete.",
      action: "Point DATABASE_URL at Neon for durable ops visibility.",
    });
  }

  const statuses = input.paymentStatusCounts;
  const paymentTotal = Object.values(statuses).reduce((a, b) => a + b, 0);
  const failed = (statuses.failed ?? 0) + (statuses.refunded ?? 0);
  const failRate = pct(failed, paymentTotal);
  if (paymentTotal >= 5 && failRate >= 20) {
    out.push({
      id: "payments.high_failure_rate",
      severity: failRate >= 40 ? "critical" : "warn",
      category: "payments",
      title: "Elevated x402 failure rate",
      detail: `${failed}/${paymentTotal} payments failed or refunded (${failRate.toFixed(0)}%) in the last ${input.windowDays}d.`,
      action: "Check CDP facilitator logs, treasury USDC, and recent failure_reason rows in payment_events.",
      metric: `${failRate.toFixed(0)}% fail`,
      relatedIds: input.recentPayments
        .filter((p) => p.status === "failed" || p.status === "refunded")
        .slice(0, 8)
        .map((p) => p.id),
    });
  }

  if (input.stuckPayments.length > 0) {
    const oldest = input.stuckPayments[0]!;
    out.push({
      id: "payments.stuck",
      severity: input.stuckPayments.length >= 5 ? "critical" : "warn",
      category: "payments",
      title: "Payments stuck before settlement",
      detail: `${input.stuckPayments.length} payment(s) still quoted/verified/fulfilling for ≥15m (oldest ${oldest.ageMinutes}m, ${oldest.status}).`,
      action: "Inspect CDP verify/settle latency and whether the agent abandoned after 402.",
      metric: `${input.stuckPayments.length} stuck`,
      relatedIds: input.stuckPayments.slice(0, 8).map((p) => p.id),
    });
  }

  const requests = input.usageSummary.requests;
  if (requests >= 10 && input.usageSummary.fallbackCount > 0) {
    const fallbackRate = pct(input.usageSummary.fallbackCount, requests);
    if (fallbackRate >= 30) {
      out.push({
        id: "usage.high_fallback",
        severity: fallbackRate >= 50 ? "critical" : "warn",
        category: "usage",
        title: "High provider fallback rate",
        detail: `${input.usageSummary.fallbackCount}/${requests} requests (${fallbackRate.toFixed(0)}%) used fallback in the window.`,
        action: "Primary DePIN route may be degraded — check provider health latency and error rates.",
        metric: `${fallbackRate.toFixed(0)}% fallback`,
      });
    }
  }

  const avgLatency = input.usageSummary.avgLatencyMs;
  if (requests >= 5 && avgLatency != null) {
    if (avgLatency >= 60_000) {
      out.push({
        id: "usage.latency_critical",
        severity: "critical",
        category: "usage",
        title: "Extreme average latency",
        detail: `Mean latency is ${(avgLatency / 1000).toFixed(1)}s over ${requests} requests.`,
        action: "Likely CDP verify delay or slow upstream — confirm with recent usage rows and facilitator status.",
        metric: `${(avgLatency / 1000).toFixed(1)}s avg`,
      });
    } else if (avgLatency >= 30_000) {
      out.push({
        id: "usage.latency_high",
        severity: "warn",
        category: "usage",
        title: "High average latency",
        detail: `Mean latency is ${(avgLatency / 1000).toFixed(1)}s over ${requests} requests.`,
        action: "Expected under heavy CDP verify load; watch for agent timeouts and stuck payments.",
        metric: `${(avgLatency / 1000).toFixed(1)}s avg`,
      });
    }
  }

  // Volume cliff: last complete day vs median of prior days in window
  if (input.usageHistory.length >= 4) {
    const sorted = [...input.usageHistory].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const prior = sorted.slice(0, -1).map((d) => d.requests);
    const latest = sorted[sorted.length - 1]!;
    const median = [...prior].sort((a, b) => a - b)[Math.floor(prior.length / 2)] ?? 0;
    if (median >= 20 && latest.requests <= median * 0.25) {
      out.push({
        id: "usage.volume_drop",
        severity: "warn",
        category: "usage",
        title: "Sharp traffic drop",
        detail: `${latest.date} had ${latest.requests} requests vs prior median ${median}.`,
        action: "Confirm channels (Bazaar/MCP/Eliza) are still reachable and origin lock/DNS are healthy.",
        metric: `${latest.requests} vs ~${median}`,
      });
    }
  }

  const mcpSample = input.mcpEvents.slice(0, 40);
  if (mcpSample.length >= 5) {
    const mcpFails = mcpSample.filter((e) => !e.ok).length;
    const mcpFailRate = pct(mcpFails, mcpSample.length);
    if (mcpFailRate >= 25) {
      out.push({
        id: "mcp.high_error_rate",
        severity: mcpFailRate >= 50 ? "critical" : "warn",
        category: "mcp",
        title: "MCP tool errors elevated",
        detail: `${mcpFails}/${mcpSample.length} recent MCP events failed (${mcpFailRate.toFixed(0)}%).`,
        action: "Check MCP auth, fulfillment key balance, and API reachability from the MCP service.",
        metric: `${mcpFailRate.toFixed(0)}% MCP err`,
        relatedIds: mcpSample.filter((e) => !e.ok).slice(0, 8).map((e) => e.id),
      });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.title.localeCompare(b.title),
  );
}
