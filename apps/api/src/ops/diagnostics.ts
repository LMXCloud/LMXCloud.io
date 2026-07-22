import { getPool } from "../db/pool.js";
import type { ProviderStatus } from "../health/store.js";
import type { OpsIrregularity, OpsIrregularityRecord } from "./irregularities.js";
import type { McpToolEvent } from "./mcp-events.js";
import type {
  OpsPaymentRow,
  StuckPaymentSummary,
} from "./queries.js";

export type OpsIrregularityDiagnostic = {
  label: string;
  value: string;
  tone?: "info" | "warn" | "error";
};

export type OpsIrregularityWithDiagnostics = OpsIrregularity;

function healthRecord(ctx: ProviderHealthContext): OpsIrregularityRecord {
  return {
    kind: "health",
    data: {
      name: ctx.name,
      healthy: ctx.healthy,
      latencyMs: ctx.latencyMs,
      lastCheck: ctx.lastCheck ?? null,
      statusCode: ctx.statusCode,
      errorDetail: ctx.errorDetail,
      checkUrl: ctx.checkUrl,
      lastHealthyAt: ctx.lastHealthyAt ?? null,
      likelyCause: inferHealthCause(ctx.statusCode, ctx.errorDetail),
    },
  };
}

export type ProviderHealthContext = ProviderStatus & {
  name: string;
  lastHealthyAt?: string | null;
};

export type EnrichIrregularitiesInput = {
  irregularities: OpsIrregularity[];
  providers: Record<string, ProviderStatus>;
  unhealthyProviders: string[];
  stuckPayments: StuckPaymentSummary[];
  recentPayments: OpsPaymentRow[];
  mcpEvents: McpToolEvent[];
};

function inferHealthCause(
  statusCode?: number,
  errorDetail?: string,
): string | null {
  const detail = errorDetail?.toLowerCase() ?? "";
  if (statusCode === 401 || detail.includes("invalid api key")) {
    return "API key expired or revoked — generate a new key in the provider dashboard and update the env var on Railway.";
  }
  if (statusCode === 403) {
    return "API key rejected (forbidden) — check key permissions and billing on the provider side.";
  }
  if (statusCode === 404) {
    return "Gateway endpoint not found — verify the provider base URL env var.";
  }
  if (statusCode === 429) {
    return "Rate limited by the provider — backoff or rotate keys.";
  }
  if (statusCode != null && statusCode >= 500) {
    return "Provider gateway error — likely an upstream outage; monitor provider status.";
  }
  if (detail.includes("timeout") || detail.includes("aborted")) {
    return "Probe timed out — network issue or slow provider response.";
  }
  if (detail.includes("fetch failed") || detail.includes("econnrefused")) {
    return "Connection failed — provider may be unreachable from the API host.";
  }
  return null;
}

function providerDiagnostics(
  ctx: ProviderHealthContext,
): OpsIrregularityDiagnostic[] {
  const out: OpsIrregularityDiagnostic[] = [
    { label: "Provider", value: ctx.name },
  ];

  if (ctx.checkUrl) {
    out.push({ label: "Gateway probe", value: `GET ${ctx.checkUrl}` });
  }
  if (ctx.statusCode != null) {
    out.push({
      label: "HTTP status",
      value: String(ctx.statusCode),
      tone: ctx.statusCode >= 500 ? "error" : ctx.statusCode >= 400 ? "warn" : "info",
    });
  }
  if (ctx.errorDetail) {
    out.push({
      label: "Upstream response",
      value: ctx.errorDetail,
      tone: "error",
    });
  }
  if (ctx.latencyMs != null) {
    out.push({ label: "Probe latency", value: `${ctx.latencyMs}ms` });
  }
  if (ctx.lastCheck) {
    out.push({
      label: "Last checked",
      value: new Date(ctx.lastCheck).toISOString(),
    });
  }
  if (ctx.lastHealthyAt) {
    out.push({
      label: "Last healthy",
      value: ctx.lastHealthyAt,
      tone: "warn",
    });
  }

  const cause = inferHealthCause(ctx.statusCode, ctx.errorDetail);
  if (cause) {
    out.push({ label: "Likely cause", value: cause, tone: "warn" });
  }

  return out;
}

function stuckPaymentDiagnostics(
  stuck: StuckPaymentSummary[],
): OpsIrregularityDiagnostic[] {
  const byStatus = new Map<string, number>();
  for (const p of stuck) {
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  }

  const out: OpsIrregularityDiagnostic[] = [
    {
      label: "Stuck count",
      value: String(stuck.length),
      tone: stuck.length >= 5 ? "error" : "warn",
    },
    {
      label: "By status",
      value: [...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(", "),
    },
  ];

  const oldest = stuck[0];
  if (oldest) {
    out.push(
      { label: "Oldest age", value: `${oldest.ageMinutes}m`, tone: "warn" },
      { label: "Oldest status", value: oldest.status },
      { label: "Oldest model", value: oldest.model },
      {
        label: "Oldest wallet",
        value: `${oldest.payerWallet.slice(0, 6)}…${oldest.payerWallet.slice(-4)}`,
      },
      { label: "Oldest payment id", value: oldest.id },
      {
        label: "Created",
        value: oldest.createdAt,
      },
    );
  }

  out.push({
    label: "Note",
    value:
      "Stuck quoted/verified rows are usually agents that received 402 but never completed payment, or CDP verify/settle is slow. Very old rows may be stale test data — inspect payment detail pages.",
    tone: "info",
  });

  return out;
}

function paymentFailureDiagnostics(
  recent: OpsPaymentRow[],
): OpsIrregularityDiagnostic[] {
  const failed = recent.filter(
    (p) => p.status === "failed" || p.status === "refunded",
  );
  const out: OpsIrregularityDiagnostic[] = [
    {
      label: "Recent failures",
      value: String(failed.length),
      tone: "warn",
    },
  ];

  for (const p of failed.slice(0, 3)) {
    out.push({
      label: `${p.status} · ${p.id.slice(0, 8)}…`,
      value: `${p.model} · ${p.payerWallet.slice(0, 6)}…${p.payerWallet.slice(-4)}`,
    });
  }

  return out;
}

function mcpErrorDiagnostics(events: McpToolEvent[]): OpsIrregularityDiagnostic[] {
  const failed = events.filter((e) => !e.ok);
  const byTool = new Map<string, number>();
  for (const e of failed) {
    byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
  }

  const out: OpsIrregularityDiagnostic[] = [
    {
      label: "Failed MCP events (sample)",
      value: String(failed.length),
      tone: "warn",
    },
  ];

  for (const [tool, count] of [...byTool.entries()].slice(0, 5)) {
    out.push({ label: tool, value: `${count} error(s)` });
  }

  const latest = failed[0];
  if (latest?.detail) {
    out.push({
      label: "Latest error detail",
      value: latest.detail,
      tone: "error",
    });
  }

  return out;
}

async function loadLastHealthyAt(
  providers: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (providers.length === 0 || !process.env.DATABASE_URL) return out;

  const result = await getPool().query<{
    provider: string;
    last_healthy_at: Date;
  }>(
    `SELECT provider, MAX(checked_at) AS last_healthy_at
     FROM provider_health_checks
     WHERE provider = ANY($1::text[])
       AND check_type = 'gateway'
       AND healthy = true
     GROUP BY provider`,
    [providers],
  );

  for (const row of result.rows) {
    out.set(row.provider, row.last_healthy_at.toISOString());
  }
  return out;
}

export async function enrichIrregularities(
  input: EnrichIrregularitiesInput,
): Promise<OpsIrregularityWithDiagnostics[]> {
  const lastHealthy = await loadLastHealthyAt(input.unhealthyProviders);

  return input.irregularities.map((item) => {
    if (
      item.id === "health.partial" ||
      item.id === "health.all_down" ||
      item.id === "health.no_providers"
    ) {
      const providerNames =
        item.relatedIds && item.relatedIds.length > 0
          ? item.relatedIds
          : input.unhealthyProviders;

      const diagnostics: OpsIrregularityDiagnostic[] = [];
      const records: OpsIrregularityRecord[] = [];
      for (const name of providerNames) {
        const status = input.providers[name];
        if (!status) continue;
        const ctx: ProviderHealthContext = {
          name,
          ...status,
          lastHealthyAt: lastHealthy.get(name) ?? null,
        };
        if (diagnostics.length > 0) {
          diagnostics.push({ label: "—", value: "—" });
        }
        diagnostics.push(...providerDiagnostics(ctx));
        records.push(healthRecord(ctx));
      }

      return diagnostics.length > 0 ? { ...item, diagnostics, records } : item;
    }

    if (item.id === "payments.stuck") {
      return {
        ...item,
        diagnostics: stuckPaymentDiagnostics(input.stuckPayments),
        records: input.stuckPayments.map((payment) => ({
          kind: "payment" as const,
          data: payment,
        })),
      };
    }

    if (item.id === "payments.high_failure_rate") {
      const failed = input.recentPayments.filter(
        (p) => p.status === "failed" || p.status === "refunded",
      );
      return {
        ...item,
        diagnostics: paymentFailureDiagnostics(input.recentPayments),
        records: failed.slice(0, 10).map((payment) => ({
          kind: "payment" as const,
          data: payment,
        })),
      };
    }

    if (item.id === "mcp.high_error_rate") {
      const failed = input.mcpEvents.filter((e) => !e.ok);
      return {
        ...item,
        diagnostics: mcpErrorDiagnostics(input.mcpEvents),
        records: failed.slice(0, 10).map((event) => ({
          kind: "mcp" as const,
          data: event,
        })),
      };
    }

    if (item.id === "config.db_unreachable") {
      return {
        ...item,
        diagnostics: [
          { label: "Database error", value: item.detail, tone: "error" },
        ],
      };
    }

    return item;
  });
}
