import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  formatEth,
  formatLatency,
  formatNum,
  formatTime,
  formatTokens,
  formatUsd,
  shortWallet,
} from "./format";
import { recordPath } from "./routes";
import type {
  OpsOverview,
  OpsProviderStatus,
  OpsTreasury,
} from "./types";

export type ExploreView =
  | "treasury"
  | "providers"
  | "usage"
  | "activity"
  | "stuck-payments"
  | "payments"
  | "signups"
  | "deposits";

const VIEW_LABELS: Record<ExploreView, string> = {
  treasury: "Treasury wallet",
  providers: "Provider health",
  usage: "Usage history",
  activity: "Activity feed",
  "stuck-payments": "Stuck payments",
  payments: "x402 payments",
  signups: "Signups",
  deposits: "USDC deposits",
};

export function isExploreView(value: string | null): value is ExploreView {
  return value !== null && value in VIEW_LABELS;
}

function ModalTable({
  columns,
  rows,
  empty,
}: {
  columns: ReactNode;
  rows: ReactNode;
  empty?: string;
}) {
  if (!rows) {
    return <p className="text-sm text-[var(--color-muted)]">{empty ?? "No data."}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-[var(--color-panel)] text-[var(--color-faint)]">
          {columns}
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function ProviderRow({ name, status }: { name: string; status: OpsProviderStatus }) {
  return (
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-panel-raised)]/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${status.healthy ? "bg-[var(--color-accent)]" : "bg-[var(--color-danger)]"}`}
          />
          <span className="font-medium">{name}</span>
          {status.isDepin ? (
            <span className="font-mono text-[10px] text-[var(--color-faint)]">DePIN</span>
          ) : null}
        </div>
        <span className="font-mono text-sm tabular-nums text-[var(--color-muted)]">
          {formatLatency(status.latencyMs)}
        </span>
      </div>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <div className="font-mono text-[11px]">
          <dt className="text-[var(--color-faint)]">Tier</dt>
          <dd>{status.tier}</dd>
        </div>
        <div className="font-mono text-[11px]">
          <dt className="text-[var(--color-faint)]">Last check</dt>
          <dd>
            {status.lastCheck
              ? formatTime(new Date(status.lastCheck).toISOString())
              : "—"}
          </dd>
        </div>
        {status.statusCode != null ? (
          <div className="font-mono text-[11px]">
            <dt className="text-[var(--color-faint)]">HTTP</dt>
            <dd>{status.statusCode}</dd>
          </div>
        ) : null}
        {status.checkUrl ? (
          <div className="font-mono text-[11px] sm:col-span-2">
            <dt className="text-[var(--color-faint)]">Check URL</dt>
            <dd className="break-all text-[var(--color-muted)]">{status.checkUrl}</dd>
          </div>
        ) : null}
        {status.errorDetail ? (
          <div className="font-mono text-[11px] sm:col-span-2">
            <dt className="text-[var(--color-faint)]">Gateway error</dt>
            <dd className="text-[var(--color-danger)]">{status.errorDetail}</dd>
          </div>
        ) : null}
        {status.syntheticErrorDetail ? (
          <div className="font-mono text-[11px] sm:col-span-2">
            <dt className="text-[var(--color-faint)]">Synthetic probe error</dt>
            <dd className="text-[var(--color-danger)]">
              {status.syntheticErrorDetail}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function TreasuryDetail({ treasury }: { treasury: OpsTreasury }) {
  if (treasury.status === "unconfigured") {
    return <p className="text-sm text-[var(--color-muted)]">{treasury.reason}</p>;
  }
  if (treasury.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--color-danger)]">{treasury.reason}</p>
        <p className="break-all font-mono text-xs text-[var(--color-muted)]">
          {treasury.address}
        </p>
      </div>
    );
  }
  return (
    <dl className="space-y-4">
      <div>
        <dt className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          USDC balance
        </dt>
        <dd className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[var(--color-accent)]">
          {formatUsd(treasury.usdcBalance)}
        </dd>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            ETH (gas)
          </dt>
          <dd className="mt-1 font-mono text-sm">{formatEth(treasury.ethBalance)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            Chain
          </dt>
          <dd className="mt-1 font-mono text-sm">
            {treasury.chainLabel} ({treasury.chainId})
          </dd>
        </div>
      </div>
      <div>
        <dt className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Address
        </dt>
        <dd className="mt-1 break-all font-mono text-xs text-[var(--color-muted)]">
          {treasury.address}
        </dd>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] text-[var(--color-faint)]">
          Fetched {formatTime(treasury.fetchedAt)}
        </span>
        <a
          href={treasury.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          View on explorer →
        </a>
      </div>
    </dl>
  );
}

function ExploreBody({
  view,
  data,
  days,
}: {
  view: ExploreView;
  data: OpsOverview;
  days: number;
}) {
  switch (view) {
    case "treasury":
      return data.treasury ? <TreasuryDetail treasury={data.treasury} /> : null;

    case "providers": {
      const providers = Object.entries(data.health.providers).sort(
        ([, a], [, b]) => a.tier - b.tier,
      );
      return (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            Fallback: {data.server.fallbackChain.join(" → ") || "—"} ·{" "}
            {data.health.healthyCount}/{data.health.providerCount} healthy
          </p>
          {providers.map(([name, status]) => (
            <ProviderRow key={name} name={name} status={status} />
          ))}
          <p className="font-mono text-[10px] text-[var(--color-faint)]">
            storage={data.storage} · payments={data.server.paymentStore} · mcp
            buffer={data.mcp.buffered}
          </p>
        </div>
      );
    }

    case "usage":
      return (
        <div className="space-y-4">
          <p className="text-xs text-[var(--color-muted)]">
            {days}d window · {formatNum(data.usage.summary.requests)} requests ·{" "}
            {formatTokens(data.usage.summary.totalTokens)} tokens ·{" "}
            {formatUsd(data.usage.summary.cost)} cost
          </p>
          <ModalTable
            empty="No usage in this window."
            columns={
              <tr>
                <th className="pb-2 pr-3 font-medium">Date</th>
                <th className="pb-2 pr-3 font-medium">Reqs</th>
                <th className="pb-2 pr-3 font-medium">Tokens</th>
                <th className="pb-2 pr-3 font-medium">Cost</th>
                <th className="pb-2 pr-3 font-medium">Fallbacks</th>
                <th className="pb-2 font-medium">Latency</th>
              </tr>
            }
            rows={
              data.usage.history.length > 0
                ? [...data.usage.history].reverse().map((day) => (
                    <tr key={day.date} className="border-t border-[var(--color-line)]/70">
                      <td className="py-2 pr-3 font-mono text-[var(--color-muted)]">
                        {day.date}
                      </td>
                      <td className="py-2 pr-3 font-mono">{formatNum(day.requests)}</td>
                      <td className="py-2 pr-3 font-mono">
                        {formatTokens(day.totalTokens)}
                      </td>
                      <td className="py-2 pr-3 font-mono">{formatUsd(day.cost)}</td>
                      <td className="py-2 pr-3 font-mono">{day.fallbackCount}</td>
                      <td className="py-2 font-mono">{formatLatency(day.avgLatencyMs)}</td>
                    </tr>
                  ))
                : null
            }
          />
        </div>
      );

    case "activity":
      return (
        <ModalTable
          empty="No recent activity."
          columns={
            <tr>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 pr-3 font-medium">Channel</th>
              <th className="pb-2 pr-3 font-medium">Event</th>
              <th className="pb-2 font-medium">Detail</th>
            </tr>
          }
          rows={
            data.activity.length > 0
              ? data.activity.map((item) => {
                  const href = activityExploreLink(item);
                  const label = (
                    <span className="font-medium">
                      {item.label}
                      {item.kind === "payment" ? ` · ${item.status}` : ""}
                      {item.kind === "mcp" ? ` · ${item.ok ? "ok" : "error"}` : ""}
                    </span>
                  );
                  return (
                    <tr key={`${item.kind}-${item.id}`} className="border-t border-[var(--color-line)]/70">
                      <td className="whitespace-nowrap py-2 pr-3 font-mono text-[var(--color-muted)]">
                        {formatTime(item.at)}
                      </td>
                      <td className="py-2 pr-3 font-mono uppercase text-[10px]">
                        {item.channel}
                      </td>
                      <td className="py-2 pr-3">
                        {href ? (
                          <Link
                            to={href}
                            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                          >
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </td>
                      <td className="max-w-[14rem] truncate py-2 font-mono text-[11px] text-[var(--color-muted)]">
                        {activityExploreDetail(item)}
                      </td>
                    </tr>
                  );
                })
              : null
          }
        />
      );

    case "stuck-payments":
      return (
        <ModalTable
          empty="No stuck payments."
          columns={
            <tr>
              <th className="pb-2 pr-3 font-medium">Age</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Wallet</th>
              <th className="pb-2 pr-3 font-medium">Model</th>
              <th className="pb-2 pr-3 font-medium">Amount</th>
              <th className="pb-2 font-medium">Id</th>
            </tr>
          }
          rows={
            (data.paymentsStuck ?? []).length > 0
              ? (data.paymentsStuck ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-[var(--color-line)]/70">
                    <td className="py-2 pr-3 font-mono">{p.ageMinutes}m</td>
                    <td className="py-2 pr-3 font-mono">{p.status}</td>
                    <td className="py-2 pr-3 font-mono">{shortWallet(p.payerWallet)}</td>
                    <td className="py-2 pr-3 font-mono">{p.model}</td>
                    <td className="py-2 pr-3 font-mono">
                      {formatUsd(p.settledAmount ?? p.quotedAmount)}
                    </td>
                    <td className="py-2 font-mono">
                      <Link
                        to={recordPath("payment", p.id)}
                        className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                      >
                        {p.id}
                      </Link>
                    </td>
                  </tr>
                ))
              : null
          }
        />
      );

    case "payments":
      return (
        <ModalTable
          empty="No payment events."
          columns={
            <tr>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Wallet</th>
              <th className="pb-2 pr-3 font-medium">Amount</th>
              <th className="pb-2 pr-3 font-medium">Model</th>
              <th className="pb-2 font-medium">Id</th>
            </tr>
          }
          rows={
            data.payments.recent.length > 0
              ? data.payments.recent.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--color-line)]/70">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[var(--color-muted)]">
                      {formatTime(p.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-mono">{p.status}</td>
                    <td className="py-2 pr-3 font-mono">{shortWallet(p.payerWallet)}</td>
                    <td className="py-2 pr-3 font-mono">
                      {formatUsd(p.settledAmount ?? p.quotedAmount)}
                    </td>
                    <td className="py-2 pr-3 font-mono">{p.model}</td>
                    <td className="py-2 font-mono">
                      <Link
                        to={recordPath("payment", p.id)}
                        className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                      >
                        {p.id}
                      </Link>
                    </td>
                  </tr>
                ))
              : null
          }
        />
      );

    case "signups":
      return (
        <ModalTable
          empty="No signups yet."
          columns={
            <tr>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 pr-3 font-medium">Email</th>
              <th className="pb-2 pr-3 font-medium">Wallet</th>
              <th className="pb-2 pr-3 font-medium">Balance</th>
              <th className="pb-2 font-medium">Key id</th>
            </tr>
          }
          rows={
            (data.signups?.recent ?? []).length > 0
              ? (data.signups?.recent ?? []).map((s) => (
                  <tr key={s.id} className="border-t border-[var(--color-line)]/70">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[var(--color-muted)]">
                      {formatTime(s.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-mono">{s.email ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono">
                      {s.wallet ? shortWallet(s.wallet) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatUsd(s.creditBalance)}</td>
                    <td className="py-2 font-mono">{s.id}</td>
                  </tr>
                ))
              : null
          }
        />
      );

    case "deposits":
      return (
        <ModalTable
          empty="No credited deposits."
          columns={
            <tr>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 pr-3 font-medium">Amount</th>
              <th className="pb-2 pr-3 font-medium">Wallet</th>
              <th className="pb-2 pr-3 font-medium">Key</th>
              <th className="pb-2 font-medium">Tx</th>
            </tr>
          }
          rows={
            (data.credits?.recent ?? []).length > 0
              ? (data.credits?.recent ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-[var(--color-line)]/70">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[var(--color-muted)]">
                      {formatTime(c.creditedAt)}
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatUsd(c.amount)}</td>
                    <td className="py-2 pr-3 font-mono">
                      {c.wallet ? shortWallet(c.wallet) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono">{c.apiKeyId}</td>
                    <td className="max-w-[10rem] truncate py-2 font-mono">
                      {c.txHash ?? "—"}
                    </td>
                  </tr>
                ))
              : null
          }
        />
      );
  }
}

function activityExploreLink(
  item: OpsOverview["activity"][number],
): string | null {
  if (item.kind === "payment") return recordPath("payment", item.id);
  if (item.kind === "usage") return recordPath("usage", item.id);
  if (item.kind === "mcp") return recordPath("mcp", item.id);
  return null;
}

function activityExploreDetail(item: OpsOverview["activity"][number]): string {
  if (item.kind === "payment") {
    return `${shortWallet(item.wallet)} · ${item.model} · ${formatUsd(item.amount)}`;
  }
  if (item.kind === "usage") {
    return `${formatTokens(item.tokens)} tok · ${formatUsd(item.cost)} · ${formatLatency(item.latencyMs)}`;
  }
  if (item.kind === "signup") {
    return item.email ?? (item.wallet ? shortWallet(item.wallet) : item.id);
  }
  if (item.kind === "credit") {
    return `+${formatUsd(item.amount)} · ${item.source}`;
  }
  return `${item.callerId} · ${item.authSource}`;
}

export function ExploreModal({
  view,
  data,
  days,
  onClose,
}: {
  view: ExploreView;
  data: OpsOverview;
  days: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const count = exploreCount(view, data);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explore-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-[var(--color-line)] bg-[var(--color-panel)] shadow-2xl sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <div>
            <h2 id="explore-title" className="text-sm font-semibold text-[var(--color-ink)]">
              {VIEW_LABELS[view]}
            </h2>
            {count != null ? (
              <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                {count} record{count === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ExploreBody view={view} data={data} days={days} />
        </div>
      </div>
    </div>
  );
}

function exploreCount(view: ExploreView, data: OpsOverview): number | null {
  switch (view) {
    case "treasury":
      return null;
    case "providers":
      return Object.keys(data.health.providers).length;
    case "usage":
      return data.usage.history.length;
    case "activity":
      return data.activity.length;
    case "stuck-payments":
      return (data.paymentsStuck ?? []).length;
    case "payments":
      return data.payments.recent.length;
    case "signups":
      return (data.signups?.recent ?? []).length;
    case "deposits":
      return (data.credits?.recent ?? []).length;
  }
}

export function ExploreButton({
  onClick,
  label = "Open",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="shrink-0 rounded border border-[var(--color-line)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent-dim)]"
    >
      {label}
    </button>
  );
}
