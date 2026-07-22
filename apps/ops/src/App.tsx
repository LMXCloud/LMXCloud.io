import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import {
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
  formatNum,
  formatTime,
  formatTokens,
  formatUsd,
  shortWallet,
} from "./format";
import { activityPath, relatedIdPath, recordPath } from "./routes";
import type { OpsActivityItem, OpsIrregularity, OpsOverview } from "./types";

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

function AttentionPanel({ items }: { items: OpsIrregularity[] }) {
  if (items.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)] px-4 py-3">
        <div className="text-sm font-medium text-[var(--color-accent)]">All clear</div>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          No irregularities matched current thresholds for this window.
        </p>
      </div>
    );
  }

  return (
    <section className="mb-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Needs attention</h2>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          Threshold-based irregularity detection across health, payments, usage, MCP, and config.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-line)]/80">
        {items.map((item) => (
          <li key={item.id} className={`px-4 py-3 ${severityClass(item.severity)}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`font-mono text-[10px] uppercase tracking-wider ${severityLabelClass(item.severity)}`}>
                {item.severity}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
                {item.category}
              </span>
              {item.metric ? (
                <span className="font-mono text-[11px] text-[var(--color-muted)]">{item.metric}</span>
              ) : null}
            </div>
            <div className="mt-1 text-sm font-medium">{item.title}</div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{item.detail}</p>
            <p className="mt-1.5 text-xs text-[var(--color-ink)]">
              <span className="text-[var(--color-faint)]">Do: </span>
              {item.action}
            </p>
            <RelatedIds item={item} />
          </li>
        ))}
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
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-b border-[var(--color-line)] pb-3 last:border-b-0 last:pb-0 sm:border-b-0 sm:pb-0 sm:border-r sm:pr-5 sm:last:border-r-0 sm:last:pr-0">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-medium tabular-nums tracking-tight text-[var(--color-ink)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-[var(--color-muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
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
    <div className="space-y-2">
      <div className="flex h-28 items-end gap-1.5">
        {history.map((day) => {
          const h = Math.max(4, Math.round((day.requests / max) * 100));
          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${day.date}: ${day.requests} req`}
            >
              <div
                className="w-full rounded-sm bg-[var(--color-accent)]/80 transition-opacity group-hover:opacity-100 opacity-80"
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-[var(--color-faint)]">
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-faint)]">
            <tr>
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Reqs</th>
              <th className="pb-2 font-medium">Tokens</th>
              <th className="pb-2 font-medium">Cost</th>
              <th className="pb-2 font-medium">Latency</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((day) => (
              <tr key={day.date} className="border-t border-[var(--color-line)]/70">
                <td className="py-1.5 font-mono text-[var(--color-muted)]">{day.date}</td>
                <td className="py-1.5 font-mono">{formatNum(day.requests)}</td>
                <td className="py-1.5 font-mono">{formatTokens(day.totalTokens)}</td>
                <td className="py-1.5 font-mono">{formatUsd(day.cost)}</td>
                <td className="py-1.5 font-mono">{formatLatency(day.avgLatencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <div className="mt-0.5 w-14 shrink-0">
        <ChannelChip channel={item.channel} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{item.label}</span>
          {item.kind === "payment" ? (
            <span className="font-mono text-[11px] text-[var(--color-muted)]">
              {item.status}
            </span>
          ) : null}
          {item.kind === "mcp" ? (
            <span
              className={`font-mono text-[11px] ${item.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}
            >
              {item.ok ? "ok" : "error"}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-muted)]">
          {activityDetail(item)}
        </div>
      </div>
      <div className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
        {formatTime(item.at)}
      </div>
    </>
  );

  if (!href) {
    return (
      <div className="flex gap-3 py-2.5">
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={href}
      className="flex gap-3 py-2.5 transition hover:bg-[var(--color-panel-raised)]/60"
    >
      {inner}
    </Link>
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
  const providers = data
    ? Object.entries(data.health.providers).sort(([, a], [, b]) => a.tier - b.tier)
    : [];

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 border-b border-[var(--color-line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            LMX Cloud
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Operations
          </h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-muted)]">
            Aggregated visibility across x402, MCP, and balance-funded traffic.
            Not the customer console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <span className="font-mono">{apiBase || "VITE_API_URL unset"}</span>
          {lastUpdated ? (
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || !opsKey}
            className="rounded border border-[var(--color-line)] bg-[var(--color-panel-raised)] px-3 py-1.5 font-medium text-[var(--color-ink)] transition hover:border-[var(--color-accent)] disabled:opacity-40"
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
          <AttentionPanel items={data.irregularities ?? []} />

          <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4 sm:grid-cols-4 lg:grid-cols-8">
            <Stat
              label="Attention"
              value={String(
                (data.attention?.critical ?? 0) + (data.attention?.warn ?? 0),
              )}
              hint={`crit ${data.attention?.critical ?? 0} · warn ${data.attention?.warn ?? 0}`}
            />
            <Stat
              label="Providers up"
              value={`${data.health.healthyCount}/${data.health.providerCount}`}
              hint={data.server.x402Enabled ? "x402 on" : "x402 off"}
            />
            <Stat
              label="Requests"
              value={formatNum(data.usage.summary.requests)}
              hint={`${days}d window`}
            />
            <Stat
              label="Tokens"
              value={formatTokens(data.usage.summary.totalTokens)}
            />
            <Stat label="Cost" value={formatUsd(data.usage.summary.cost)} />
            <Stat
              label="Avg latency"
              value={formatLatency(data.usage.summary.avgLatencyMs)}
            />
            <Stat
              label="Signups"
              value={formatNum(data.signups?.recent.length ?? 0)}
              hint="recent keys"
            />
            <Stat
              label="Payments"
              value={formatNum(
                Object.values(data.payments.statusCounts).reduce((a, b) => a + b, 0),
              )}
              hint={Object.entries(data.payments.statusCounts)
                .map(([k, v]) => `${k}:${v}`)
                .join(" ") || "none"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Provider health"
              subtitle={`Fallback: ${data.server.fallbackChain.join(" → ") || "—"}`}
            >
              {providers.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No providers configured.</p>
              ) : (
                <ul className="space-y-2">
                  {providers.map(([name, status]) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] bg-[var(--color-panel-raised)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${status.healthy ? "bg-[var(--color-accent)]" : "bg-[var(--color-danger)]"}`}
                          />
                          <span className="truncate font-medium">{name}</span>
                          {status.isDepin ? (
                            <span className="font-mono text-[10px] text-[var(--color-faint)]">
                              DePIN
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">
                          tier {status.tier}
                          {status.lastCheck
                            ? ` · checked ${formatTime(new Date(status.lastCheck).toISOString())}`
                            : ""}
                        </div>
                      </div>
                      <div className="shrink-0 font-mono text-sm tabular-nums text-[var(--color-muted)]">
                        {formatLatency(status.latencyMs)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 font-mono text-[11px] text-[var(--color-faint)]">
                storage={data.storage} · payments={data.server.paymentStore} · mcp
                buffer={data.mcp.buffered}
              </p>
            </Panel>

            <Panel
              title="Usage trend"
              subtitle={`Daily request volume (${days}d)`}
            >
              <UsageSparkline history={data.usage.history} />
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel
              title="Recent activity"
              subtitle="Signups, credits, payments, usage, and MCP — click rows with detail pages"
            >
              {data.activity.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No recent activity.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]/80">
                  {data.activity.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="first:pt-0 last:pb-0">
                      <ActivityRow item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Stuck payments"
              subtitle="quoted/verified older than 15 minutes"
            >
              {(data.paymentsStuck ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">None stuck.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-faint)]">
                      <tr>
                        <th className="pb-2 font-medium">Age</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Wallet</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.paymentsStuck ?? []).map((p) => (
                        <tr key={p.id} className="border-t border-[var(--color-line)]/70">
                          <td className="py-1.5 font-mono">{p.ageMinutes}m</td>
                          <td className="py-1.5 font-mono">{p.status}</td>
                          <td className="py-1.5 font-mono">{shortWallet(p.payerWallet)}</td>
                          <td className="py-1.5 font-mono truncate max-w-[7rem]">{p.model}</td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">
                            <Link
                              to={recordPath("payment", p.id)}
                              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                            >
                              {p.id}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Recent signups" subtitle="New API keys (all channels)">
              {(data.signups?.recent ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No signups yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-faint)]">
                      <tr>
                        <th className="pb-2 font-medium">When</th>
                        <th className="pb-2 font-medium">Email</th>
                        <th className="pb-2 font-medium">Wallet</th>
                        <th className="pb-2 font-medium">Balance</th>
                        <th className="pb-2 font-medium">Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.signups?.recent ?? []).map((s) => (
                        <tr key={s.id} className="border-t border-[var(--color-line)]/70">
                          <td className="py-1.5 font-mono text-[var(--color-muted)] whitespace-nowrap">
                            {formatTime(s.createdAt)}
                          </td>
                          <td className="py-1.5 font-mono truncate max-w-[10rem]">
                            {s.email ?? "—"}
                          </td>
                          <td className="py-1.5 font-mono">
                            {s.wallet ? shortWallet(s.wallet) : "—"}
                          </td>
                          <td className="py-1.5 font-mono">{formatUsd(s.creditBalance)}</td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">
                            {s.id.slice(0, 8)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Credit events" subtitle="USDC deposits credited on-chain">
              {(data.credits?.recent ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No credited deposits.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-faint)]">
                      <tr>
                        <th className="pb-2 font-medium">When</th>
                        <th className="pb-2 font-medium">Amount</th>
                        <th className="pb-2 font-medium">Wallet</th>
                        <th className="pb-2 font-medium">Key</th>
                        <th className="pb-2 font-medium">Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.credits?.recent ?? []).map((c) => (
                        <tr key={c.id} className="border-t border-[var(--color-line)]/70">
                          <td className="py-1.5 font-mono text-[var(--color-muted)] whitespace-nowrap">
                            {formatTime(c.creditedAt)}
                          </td>
                          <td className="py-1.5 font-mono">{formatUsd(c.amount)}</td>
                          <td className="py-1.5 font-mono">
                            {c.wallet ? shortWallet(c.wallet) : "—"}
                          </td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">
                            {c.apiKeyId.slice(0, 8)}…
                          </td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">
                            {c.txHash ? `${c.txHash.slice(0, 10)}…` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Recent x402 payments" subtitle="From payment_events">
              {data.payments.recent.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No payment events.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-faint)]">
                      <tr>
                        <th className="pb-2 font-medium">When</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Wallet</th>
                        <th className="pb-2 font-medium">Amount</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.recent.map((p) => (
                        <tr key={p.id} className="border-t border-[var(--color-line)]/70">
                          <td className="py-1.5 font-mono text-[var(--color-muted)] whitespace-nowrap">
                            {formatTime(p.createdAt)}
                          </td>
                          <td className="py-1.5 font-mono">{p.status}</td>
                          <td className="py-1.5 font-mono">{shortWallet(p.payerWallet)}</td>
                          <td className="py-1.5 font-mono">
                            {formatUsd(p.settledAmount ?? p.quotedAmount)}
                          </td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">{p.model}</td>
                          <td className="py-1.5 font-mono truncate max-w-[8rem]">
                            <Link
                              to={recordPath("payment", p.id)}
                              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                            >
                              {p.id.slice(0, 8)}…
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
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
