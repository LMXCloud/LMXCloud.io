import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import {
  executeOpsReconciliation,
  fetchOpsOverview,
  getApiBase,
  getEnvOpsKey,
  resolveOpsKey,
  setStoredOpsKey,
} from "./api";
import {
  McpDetailPage,
  PaymentDetailPage,
  UsageDetailPage,
} from "./DetailPages";
import {
  formatLatency,
  formatEth,
  formatNum,
  formatTime,
  formatTokens,
  formatUsd,
  shortWallet,
} from "./format";
import { activityPath, relatedIdPath, recordPath } from "./routes";
import type {
  OpsActivityItem,
  OpsIrregularity,
  OpsIrregularityDiagnostic,
  OpsIrregularityRecord,
  OpsOverview,
  OpsPendingReconciliation,
  OpsTreasury,
} from "./types";
import {
  HealthFields,
  McpFields,
  PaymentFields,
  UsageFields,
} from "./RecordViews";
import {
  ExploreButton,
  ExploreModal,
  isExploreView,
  type ExploreView,
} from "./ExploreModal";

const POLL_MS = 15_000;

function severityClass(severity: string): string {
  if (severity === "critical") return "border-[var(--color-danger)]/50 bg-[rgba(232,93,108,0.1)]";
  if (severity === "warn") return "border-[var(--color-warn)]/40 bg-[rgba(230,184,77,0.08)]";
  return "border-[var(--color-info)]/40 bg-[rgba(91,159,212,0.08)]";
}

function severityLabelClass(severity: string): string {
  if (severity === "critical") return "text-[var(--color-danger)]";
  if (severity === "warn") return "text-[var(--color-warn)]";
  return "text-[var(--color-info)]";
}

function RelatedIds({ item }: { item: OpsIrregularity }) {
  if (!item.relatedIds || item.relatedIds.length === 0) return null;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[10px] text-[var(--color-faint)]">
      <span>ids:</span>
      {item.relatedIds.map((id, index) => {
        const href = relatedIdPath(item, id);
        return (
          <span key={id} className="inline-flex items-center">
            {index > 0 ? <span className="mr-1">,</span> : null}
            {href ? (
              <Link
                to={href}
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                {id}
              </Link>
            ) : (
              <span>{id}</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

function diagnosticToneClass(tone?: OpsIrregularityDiagnostic["tone"]): string {
  if (tone === "error") return "text-[var(--color-danger)]";
  if (tone === "warn") return "text-[var(--color-warn)]";
  return "text-[var(--color-ink)]";
}

function IrregularityDiagnostics({
  diagnostics,
}: {
  diagnostics: OpsIrregularityDiagnostic[];
}) {
  return (
    <div className="mt-3 rounded border border-[var(--color-line)]/80 bg-[var(--color-bg)]/60 px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
        Diagnostics
      </p>
      <dl className="mt-2 space-y-2">
        {diagnostics.map((row, index) => (
          <div key={`${row.label}-${index}`} className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
            <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              {row.label}
            </dt>
            <dd
              className={`font-mono text-xs break-words ${diagnosticToneClass(row.tone)}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function IrregularityRecords({ records }: { records: OpsIrregularityRecord[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(
    records.length === 1 ? 0 : null,
  );

  return (
    <div className="mt-3 space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
        Full records ({records.length})
      </p>
      {records.map((record, index) => {
        const open = openIndex === index;
        const title =
          record.kind === "payment"
            ? `${record.data.status} · ${record.data.model} · ${record.data.id.slice(0, 8)}…`
            : record.kind === "health"
              ? `Provider ${record.data.name}`
              : record.kind === "usage"
                ? `${record.data.provider}/${record.data.model}`
                : `${record.data.tool} · ${record.data.ok ? "ok" : "error"}`;

        return (
          <div
            key={`${record.kind}-${index}-${record.kind === "payment" ? record.data.id : record.kind === "usage" ? record.data.id : record.kind === "mcp" ? record.data.id : record.data.name}`}
            className="overflow-hidden rounded border border-[var(--color-line)]/80 bg-[var(--color-bg)]/60"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : index)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
                {record.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                {open ? "Hide" : "Show"}
              </span>
            </button>
            {open ? (
              <div className="border-t border-[var(--color-line)]/80 px-3 py-1">
                <dl>
                  {record.kind === "payment" ? (
                    <PaymentFields
                      data={record.data}
                      ageMinutes={record.data.ageMinutes}
                    />
                  ) : null}
                  {record.kind === "health" ? (
                    <HealthFields data={record.data} />
                  ) : null}
                  {record.kind === "usage" ? (
                    <UsageFields data={record.data} />
                  ) : null}
                  {record.kind === "mcp" ? <McpFields data={record.data} /> : null}
                </dl>
                {record.kind === "payment" || record.kind === "usage" || record.kind === "mcp" ? (
                  <div className="border-t border-[var(--color-line)]/70 py-2">
                    <Link
                      to={recordPath(
                        record.kind,
                        record.kind === "payment" || record.kind === "usage" || record.kind === "mcp"
                          ? record.data.id
                          : "",
                      )}
                      className="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline"
                    >
                      Open full detail page →
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AttentionPanel({
  items,
  pendingReconciliations = [],
  opsKey,
  onRefresh,
}: {
  items: OpsIrregularity[];
  pendingReconciliations?: OpsPendingReconciliation[];
  opsKey?: string;
  onRefresh?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const manualRefunds = pendingReconciliations.filter(
    (r) => r.status === "manual_required" && r.kind === "x402_refund",
  );

  async function approveRefund(id: string) {
    if (!opsKey) return;
    setApprovingId(id);
    setApproveError(null);
    try {
      await executeOpsReconciliation(opsKey, id);
      onRefresh?.();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/25 bg-[var(--color-accent-dim)] px-3 py-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
        <span className="text-xs font-medium text-[var(--color-accent)]">All clear</span>
        <span className="text-xs text-[var(--color-muted)]">— no irregularities in this window</span>
      </div>
    );
  }

  const critical = items.filter((i) => i.severity === "critical").length;
  const warn = items.filter((i) => i.severity === "warn").length;
  const visible = showAll ? items : items.slice(0, 3);

  return (
    <section className="mb-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] px-3 py-2">
        <span className="text-xs font-semibold text-[var(--color-ink)]">Alerts</span>
        {critical > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-danger)]">
            {critical} critical
          </span>
        ) : null}
        {warn > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-warn)]">
            {warn} warn
          </span>
        ) : null}
        <span className="text-[10px] text-[var(--color-faint)]">{items.length} total</span>
        {items.length > 3 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto text-[10px] text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            {showAll ? "Show less" : `Show all (${items.length})`}
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-[var(--color-line)]/70">
        {visible.map((item) => {
          const expandable = Boolean(
            (item.diagnostics && item.diagnostics.length > 0) ||
              (item.records && item.records.length > 0) ||
              item.detail ||
              item.action,
          );
          const expanded = expandedId === item.id;

          return (
            <li key={item.id} className={`px-3 py-2 ${severityClass(item.severity)}`}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() => {
                  if (!expandable) return;
                  setExpandedId(expanded ? null : item.id);
                }}
                className={`w-full text-left ${expandable ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${severityLabelClass(item.severity)}`}>
                    {item.severity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
                  {item.metric ? (
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">
                      {item.metric}
                    </span>
                  ) : null}
                  {expandable ? (
                    <span className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">
                      {expanded ? "▲" : "▼"}
                    </span>
                  ) : null}
                </div>
                {expanded ? (
                  <>
                    <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
                      {item.detail}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--color-ink)]">
                      <span className="text-[var(--color-faint)]">Do: </span>
                      {item.action}
                    </p>
                  </>
                ) : null}
              </button>
              {expanded && item.id === "payments.needs_refund" && manualRefunds.length > 0 ? (
                <ul className="mt-2 space-y-1.5 border-t border-[var(--color-line)]/60 pt-2">
                  {manualRefunds.slice(0, 5).map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-line)]/80 bg-[var(--color-panel-raised)]/50 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-[var(--color-ink)]">
                          {formatUsd(row.amount)} · {row.reason}
                        </div>
                        <div className="truncate font-mono text-[9px] text-[var(--color-faint)]">
                          {row.id}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!opsKey || approvingId === row.id}
                        onClick={() => void approveRefund(row.id)}
                        className="shrink-0 rounded border border-[var(--color-accent)]/40 px-2 py-0.5 text-[10px] text-[var(--color-accent)] disabled:opacity-50"
                      >
                        {approvingId === row.id ? "Sending…" : "Approve refund"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {approveError && expandedId === "payments.needs_refund" ? (
                <p className="mt-1 text-[10px] text-[var(--color-danger)]">{approveError}</p>
              ) : null}
              {expanded && item.diagnostics ? (
                <IrregularityDiagnostics diagnostics={item.diagnostics} />
              ) : null}
              {expanded && item.records && item.records.length > 0 ? (
                <IrregularityRecords records={item.records} />
              ) : null}
              {expanded && (!item.records || item.records.length === 0) ? (
                <RelatedIds item={item} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function channelClass(channel: string): string {
  if (channel === "x402") return "text-[#5b9fd4] bg-[rgba(91,159,212,0.12)]";
  if (channel === "mcp") return "text-[#3ecf8e] bg-[rgba(62,207,142,0.12)]";
  if (channel === "signup") return "text-[#f0b35a] bg-[rgba(240,179,90,0.12)]";
  return "text-[#9b8cff] bg-[rgba(155,140,255,0.12)]";
}

function ChannelChip({ channel }: { channel: string }) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${channelClass(channel)}`}
    >
      {channel}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "warn" | "danger";
}) {
  const valueTone =
    tone === "accent"
      ? "text-[var(--color-accent)]"
      : tone === "warn"
        ? "text-[var(--color-warn)]"
        : tone === "danger"
          ? "text-[var(--color-danger)]"
          : "text-[var(--color-ink)]";

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg font-medium tabular-nums tracking-tight ${valueTone}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

function KpiStrip({ data, days }: { data: OpsOverview; days: number }) {
  const paymentTotal = Object.values(data.payments.statusCounts).reduce((a, b) => a + b, 0);
  const paymentHint =
    Object.entries(data.payments.statusCounts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "none";

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        label="Requests"
        value={formatNum(data.usage.summary.requests)}
        hint={`${days}d`}
      />
      <Stat label="Tokens" value={formatTokens(data.usage.summary.totalTokens)} />
      <Stat label="Cost" value={formatUsd(data.usage.summary.cost)} tone="accent" />
      <Stat
        label="Latency"
        value={formatLatency(data.usage.summary.avgLatencyMs)}
      />
      <Stat
        label="Providers"
        value={`${data.health.healthyCount}/${data.health.providerCount}`}
        hint={data.server.x402Enabled ? "x402 on" : "x402 off"}
        tone={data.health.healthyCount === data.health.providerCount ? "accent" : "warn"}
      />
      <Stat label="Payments" value={formatNum(paymentTotal)} hint={paymentHint} />
    </div>
  );
}

function TreasuryStrip({
  treasury,
  onExplore,
}: {
  treasury: OpsTreasury;
  onExplore?: () => void;
}) {
  if (treasury.status === "unconfigured") {
    return (
      <div className="mb-3 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-xs text-[var(--color-muted)]">
        Treasury not configured — {treasury.reason}
      </div>
    );
  }

  if (treasury.status === "error") {
    return (
      <button
        type="button"
        onClick={onExplore}
        className="mb-3 w-full rounded-md border border-[var(--color-danger)]/30 bg-[rgba(232,93,108,0.08)] px-3 py-2.5 text-left transition hover:border-[var(--color-danger)]/50"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
              Treasury
            </span>
            <span className="text-xs text-[var(--color-danger)]">{treasury.reason}</span>
          </div>
          {onExplore ? (
            <span className="font-mono text-[10px] text-[var(--color-accent)]">Open →</span>
          ) : null}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onExplore}
      className="mb-3 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-left transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-panel-raised)]/40"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
            Treasury
          </span>
          <span className="font-mono text-xl font-semibold tabular-nums text-[var(--color-accent)]">
            {formatUsd(treasury.usdcBalance)}
          </span>
          <span className="text-[10px] text-[var(--color-muted)]">USDC</span>
          <span className="hidden h-3 w-px bg-[var(--color-line)] sm:inline" aria-hidden />
          <span className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
            {formatEth(treasury.ethBalance)}
          </span>
          <span className="hidden h-3 w-px bg-[var(--color-line)] sm:inline" aria-hidden />
          <span className="font-mono text-[10px] text-[var(--color-faint)]">
            {treasury.chainLabel}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-muted)]">
            {shortWallet(treasury.address)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[9px] text-[var(--color-faint)]">
            {formatTime(treasury.fetchedAt)}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-accent)]">Open →</span>
        </div>
      </div>
    </button>
  );
}

function Panel({
  title,
  subtitle,
  children,
  action,
  compact,
  onExplore,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  onExplore?: () => void;
}) {
  return (
    <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <button
          type="button"
          onClick={onExplore}
          disabled={!onExplore}
          className={`min-w-0 flex-1 text-left ${onExplore ? "cursor-pointer rounded transition hover:text-[var(--color-accent)]" : "cursor-default"}`}
        >
          <h2 className="text-xs font-semibold tracking-tight text-[var(--color-ink)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">{subtitle}</p>
          ) : null}
        </button>
        {onExplore ? <ExploreButton onClick={onExplore} /> : action}
      </div>
      <div className={compact ? "p-2" : "p-3"}>{children}</div>
    </section>
  );
}

function UsageSparkline({
  history,
}: {
  history: OpsOverview["usage"]["history"];
}) {
  const max = Math.max(1, ...history.map((d) => d.requests));
  if (history.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">No usage in this window.</p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-1">
        {history.map((day) => {
          const h = Math.max(3, Math.round((day.requests / max) * 100));
          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${day.date}: ${day.requests} req · ${formatTokens(day.totalTokens)} tok`}
            >
              <div
                className="w-full rounded-sm bg-[var(--color-accent)]/70 transition-opacity group-hover:opacity-100 opacity-80"
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-[var(--color-faint)]">
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function activityDetail(item: OpsActivityItem): string {
  if (item.kind === "payment") {
    return `${shortWallet(item.wallet)} · ${item.model} · ${formatUsd(item.amount)}${item.txHash ? ` · ${item.txHash.slice(0, 10)}…` : ""}`;
  }
  if (item.kind === "usage") {
    return `${formatTokens(item.tokens)} tok · ${formatUsd(item.cost)} · ${formatLatency(item.latencyMs)}${item.fallbackUsed ? " · fallback" : ""}`;
  }
  if (item.kind === "signup") {
    const identity = item.email ?? (item.wallet ? shortWallet(item.wallet) : item.id.slice(0, 8));
    return `${identity} · balance ${formatUsd(item.creditBalance)}`;
  }
  if (item.kind === "credit") {
    return `${item.source}${item.wallet ? ` · ${shortWallet(item.wallet)}` : ""} · key ${item.apiKeyId.slice(0, 8)}…${item.txHash ? ` · ${item.txHash.slice(0, 10)}…` : ""}`;
  }
  return `${item.callerId.slice(0, 12)}${item.callerId.length > 12 ? "…" : ""} · ${item.authSource}${item.latencyMs != null ? ` · ${formatLatency(item.latencyMs)}` : ""}${item.detail ? ` · ${item.detail}` : ""}`;
}

function ActivityRow({ item }: { item: OpsActivityItem }) {
  const href = activityPath(item);
  const inner = (
    <>
      <div className="mt-0.5 w-12 shrink-0">
        <ChannelChip channel={item.channel} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.label}</div>
        <div className="truncate font-mono text-[10px] text-[var(--color-muted)]">
          {activityDetail(item)}
        </div>
      </div>
      <div className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">
        {formatTime(item.at)}
      </div>
    </>
  );

  if (!href) {
    return <div className="flex gap-2 py-1.5">{inner}</div>;
  }

  return (
    <Link
      to={href}
      className="flex gap-2 py-1.5 transition hover:bg-[var(--color-panel-raised)]/60"
    >
      {inner}
    </Link>
  );
}

const ROW_LIMIT = 6;

function CompactTable({
  rows,
  total,
  columns,
  onViewAll,
}: {
  rows: ReactNode[];
  total: number;
  columns: ReactNode;
  onViewAll?: () => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="text-[var(--color-faint)]">{columns}</thead>
        <tbody>{rows}</tbody>
      </table>
      {total > ROW_LIMIT && onViewAll ? (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-1.5 text-[10px] text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          View all {total} →
        </button>
      ) : null}
    </div>
  );
}

function OverviewPage({
  opsKey,
  keyDraft,
  setKeyDraft,
  days,
  setDays,
  data,
  error,
  loading,
  lastUpdated,
  apiBase,
  load,
  saveKey,
  clearKey,
  hasEnvKey,
}: {
  opsKey: string;
  keyDraft: string;
  setKeyDraft: (key: string) => void;
  days: number;
  setDays: (days: number) => void;
  data: OpsOverview | null;
  error: string | null;
  loading: boolean;
  lastUpdated: Date | null;
  apiBase: string;
  load: (manual?: boolean) => Promise<void>;
  saveKey: (e: FormEvent) => void;
  clearKey: () => void;
  hasEnvKey: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const exploreParam = searchParams.get("view");
  const exploreView = isExploreView(exploreParam) ? exploreParam : null;

  const openExplore = (view: ExploreView) => setSearchParams({ view });
  const closeExplore = () => setSearchParams({});

  const providers = data
    ? Object.entries(data.health.providers).sort(([, a], [, b]) => a.tier - b.tier)
    : [];

  return (
    <>
      <header className="mb-4 flex flex-col gap-3 border-b border-[var(--color-line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            LMX Cloud
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
            Operations
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
          <span className="font-mono">{apiBase || "VITE_API_URL unset"}</span>
          {lastUpdated ? (
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || !opsKey}
            className="rounded border border-[var(--color-line)] bg-[var(--color-panel-raised)] px-2.5 py-1 font-medium text-[var(--color-ink)] transition hover:border-[var(--color-accent)] disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {!opsKey ? (
        <form
          onSubmit={saveKey}
          className="mb-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
        >
          <label className="block text-sm font-medium">Ops API key</label>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Uses{" "}
            <code className="font-mono text-[var(--color-ink)]">LMX_OPS_API_KEY</code>{" "}
            from the API. For local, set{" "}
            <code className="font-mono text-[var(--color-ink)]">VITE_OPS_API_KEY</code>{" "}
            in <code className="font-mono text-[var(--color-ink)]">apps/ops/.env</code>{" "}
            to auto-connect.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="ops key"
              className="min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#06110c]"
            >
              Connect
            </button>
          </div>
        </form>
      ) : null}

      {opsKey ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-xs text-[var(--color-muted)]">
            Window
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="ml-2 rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1 font-mono text-xs text-[var(--color-ink)]"
            >
              <option value={1}>1d</option>
              <option value={7}>7d</option>
              <option value={14}>14d</option>
              <option value={30}>30d</option>
            </select>
          </label>
          {hasEnvKey ? (
            <span className="font-mono text-[10px] text-[var(--color-faint)]">
              auto-connected via VITE_OPS_API_KEY
            </span>
          ) : (
            <button
              type="button"
              onClick={clearKey}
              className="text-xs text-[var(--color-faint)] underline-offset-2 hover:text-[var(--color-muted)] hover:underline"
            >
              Disconnect key
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded border border-[var(--color-danger)]/40 bg-[rgba(232,93,108,0.1)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <KpiStrip data={data} days={days} />
          {data.treasury ? (
            <TreasuryStrip
              treasury={data.treasury}
              onExplore={
                data.treasury.status !== "unconfigured"
                  ? () => openExplore("treasury")
                  : undefined
              }
            />
          ) : null}
          <AttentionPanel
            items={data.irregularities ?? []}
            pendingReconciliations={data.reconciliationsPending ?? []}
            opsKey={opsKey}
            onRefresh={() => void load(true)}
          />

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            <Panel
              compact
              title="Providers"
              subtitle={`${data.health.healthyCount}/${data.health.providerCount} up · ${data.server.fallbackChain.join(" → ") || "—"}`}
              onExplore={() => openExplore("providers")}
            >
              {providers.length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">None configured.</p>
              ) : (
                <ul className="space-y-1">
                  {providers.map(([name, status]) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 rounded border border-[var(--color-line)]/80 bg-[var(--color-panel-raised)]/50 px-2 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.healthy ? "bg-[var(--color-accent)]" : "bg-[var(--color-danger)]"}`}
                        />
                        <span className="truncate text-xs font-medium">{name}</span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-muted)]">
                        {formatLatency(status.latencyMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 font-mono text-[9px] text-[var(--color-faint)]">
                {data.storage} · {data.server.paymentStore} · mcp {data.mcp.buffered}
              </p>
            </Panel>

            <Panel
              compact
              title="Usage"
              subtitle={`${days}d volume`}
              onExplore={() => openExplore("usage")}
            >
              <UsageSparkline history={data.usage.history} />
            </Panel>

            <Panel
              compact
              title="Activity"
              subtitle="Latest events"
              onExplore={() => openExplore("activity")}
            >
              {data.activity.length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">No recent activity.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]/60">
                  {data.activity.slice(0, ROW_LIMIT).map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <ActivityRow item={item} />
                    </li>
                  ))}
                </ul>
              )}
              {data.activity.length > ROW_LIMIT ? (
                <button
                  type="button"
                  onClick={() => openExplore("activity")}
                  className="mt-1 text-[10px] text-[var(--color-accent)] underline-offset-2 hover:underline"
                >
                  View all {data.activity.length} →
                </button>
              ) : null}
            </Panel>
          </div>

          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <Panel
              compact
              title="Stuck payments"
              subtitle={
                (data.paymentsStuck ?? []).length > 0
                  ? `${(data.paymentsStuck ?? []).length} older than 15m`
                  : "None"
              }
              onExplore={
                (data.paymentsStuck ?? []).length > 0
                  ? () => openExplore("stuck-payments")
                  : undefined
              }
            >
              {(data.paymentsStuck ?? []).length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">None stuck.</p>
              ) : (
                <CompactTable
                  total={(data.paymentsStuck ?? []).length}
                  onViewAll={() => openExplore("stuck-payments")}
                  columns={
                    <tr>
                      <th className="pb-1 font-medium">Age</th>
                      <th className="pb-1 font-medium">Status</th>
                      <th className="pb-1 font-medium">Wallet</th>
                      <th className="pb-1 font-medium">Model</th>
                    </tr>
                  }
                  rows={(data.paymentsStuck ?? []).slice(0, ROW_LIMIT).map((p) => (
                    <tr key={p.id} className="border-t border-[var(--color-line)]/60">
                      <td className="py-1 font-mono">{p.ageMinutes}m</td>
                      <td className="py-1 font-mono">{p.status}</td>
                      <td className="py-1 font-mono">{shortWallet(p.payerWallet)}</td>
                      <td className="max-w-[6rem] truncate py-1 font-mono">{p.model}</td>
                    </tr>
                  ))}
                />
              )}
            </Panel>

            <Panel
              compact
              title="x402 payments"
              subtitle="Recent"
              onExplore={
                data.payments.recent.length > 0
                  ? () => openExplore("payments")
                  : undefined
              }
            >
              {data.payments.recent.length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">No payments.</p>
              ) : (
                <CompactTable
                  total={data.payments.recent.length}
                  onViewAll={() => openExplore("payments")}
                  columns={
                    <tr>
                      <th className="pb-1 font-medium">When</th>
                      <th className="pb-1 font-medium">Status</th>
                      <th className="pb-1 font-medium">Amt</th>
                      <th className="pb-1 font-medium">Model</th>
                    </tr>
                  }
                  rows={data.payments.recent.slice(0, ROW_LIMIT).map((p) => (
                    <tr key={p.id} className="border-t border-[var(--color-line)]/60">
                      <td className="whitespace-nowrap py-1 font-mono text-[var(--color-muted)]">
                        {formatTime(p.createdAt)}
                      </td>
                      <td className="py-1 font-mono">{p.status}</td>
                      <td className="py-1 font-mono">
                        {formatUsd(p.settledAmount ?? p.quotedAmount)}
                      </td>
                      <td className="max-w-[6rem] truncate py-1 font-mono">{p.model}</td>
                    </tr>
                  ))}
                />
              )}
            </Panel>

            <Panel
              compact
              title="Signups"
              subtitle="New keys"
              onExplore={
                (data.signups?.recent ?? []).length > 0
                  ? () => openExplore("signups")
                  : undefined
              }
            >
              {(data.signups?.recent ?? []).length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">None yet.</p>
              ) : (
                <CompactTable
                  total={(data.signups?.recent ?? []).length}
                  onViewAll={() => openExplore("signups")}
                  columns={
                    <tr>
                      <th className="pb-1 font-medium">When</th>
                      <th className="pb-1 font-medium">Identity</th>
                      <th className="pb-1 font-medium">Bal</th>
                    </tr>
                  }
                  rows={(data.signups?.recent ?? []).slice(0, ROW_LIMIT).map((s) => (
                    <tr key={s.id} className="border-t border-[var(--color-line)]/60">
                      <td className="whitespace-nowrap py-1 font-mono text-[var(--color-muted)]">
                        {formatTime(s.createdAt)}
                      </td>
                      <td className="max-w-[8rem] truncate py-1 font-mono">
                        {s.email ?? (s.wallet ? shortWallet(s.wallet) : s.id.slice(0, 8))}
                      </td>
                      <td className="py-1 font-mono">{formatUsd(s.creditBalance)}</td>
                    </tr>
                  ))}
                />
              )}
            </Panel>

            <Panel
              compact
              title="Deposits"
              subtitle="USDC credited"
              onExplore={
                (data.credits?.recent ?? []).length > 0
                  ? () => openExplore("deposits")
                  : undefined
              }
            >
              {(data.credits?.recent ?? []).length === 0 ? (
                <p className="text-[11px] text-[var(--color-muted)]">None.</p>
              ) : (
                <CompactTable
                  total={(data.credits?.recent ?? []).length}
                  onViewAll={() => openExplore("deposits")}
                  columns={
                    <tr>
                      <th className="pb-1 font-medium">When</th>
                      <th className="pb-1 font-medium">Amt</th>
                      <th className="pb-1 font-medium">Wallet</th>
                    </tr>
                  }
                  rows={(data.credits?.recent ?? []).slice(0, ROW_LIMIT).map((c) => (
                    <tr key={c.id} className="border-t border-[var(--color-line)]/60">
                      <td className="whitespace-nowrap py-1 font-mono text-[var(--color-muted)]">
                        {formatTime(c.creditedAt)}
                      </td>
                      <td className="py-1 font-mono">{formatUsd(c.amount)}</td>
                      <td className="py-1 font-mono">
                        {c.wallet ? shortWallet(c.wallet) : "—"}
                      </td>
                    </tr>
                  ))}
                />
              )}
            </Panel>
          </div>

          {exploreView ? (
            <ExploreModal
              view={exploreView}
              data={data}
              days={days}
              onClose={closeExplore}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function OpsShell() {
  const hasEnvKey = Boolean(getEnvOpsKey());
  const [opsKey, setOpsKey] = useState(() => resolveOpsKey());
  const [keyDraft, setKeyDraft] = useState(() => resolveOpsKey());
  const [days, setDays] = useState(7);
  const [data, setData] = useState<OpsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const apiBase = useMemo(() => getApiBase(), []);

  const load = useCallback(
    async (manual = false) => {
      if (!opsKey) {
        setError("Enter your LMX_OPS_API_KEY to load the overview.");
        setData(null);
        return;
      }
      if (manual) setLoading(true);
      try {
        const overview = await fetchOpsOverview(opsKey, { days, limit: 50 });
        setData(overview);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load overview");
      } finally {
        setLoading(false);
      }
    },
    [opsKey, days],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  function saveKey(e: FormEvent) {
    e.preventDefault();
    const next = keyDraft.trim();
    setStoredOpsKey(next);
    setOpsKey(next);
  }

  function clearKey() {
    setStoredOpsKey("");
    setOpsKey(resolveOpsKey());
    setKeyDraft(resolveOpsKey());
    if (!resolveOpsKey()) setData(null);
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Routes>
        <Route
          path="/"
          element={
            <OverviewPage
              opsKey={opsKey}
              keyDraft={keyDraft}
              setKeyDraft={setKeyDraft}
              days={days}
              setDays={setDays}
              data={data}
              error={error}
              loading={loading}
              lastUpdated={lastUpdated}
              apiBase={apiBase}
              load={load}
              saveKey={saveKey}
              clearKey={clearKey}
              hasEnvKey={hasEnvKey}
            />
          }
        />
        <Route
          path="/payments/:id"
          element={
            <DetailLayout>
              <PaymentDetailPage />
            </DetailLayout>
          }
        />
        <Route
          path="/usage/:id"
          element={
            <DetailLayout>
              <UsageDetailPage />
            </DetailLayout>
          }
        />
        <Route
          path="/mcp/:id"
          element={
            <DetailLayout>
              <McpDetailPage />
            </DetailLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function DetailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="mb-6 border-b border-[var(--color-line)] pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          LMX Cloud
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Operations</h1>
      </header>
      {children}
    </>
  );
}

export function App() {
  return <OpsShell />;
}
