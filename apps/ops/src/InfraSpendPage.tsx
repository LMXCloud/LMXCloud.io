import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "./components/Button";
import { PageHeader } from "./components/PageHeader";
import { SpendServiceStrip } from "./DashboardWidgets";
import { fetchInfraSpend, logInfraSpend } from "./api";
import { formatSpendUsd, formatTime } from "./format";
import type {
  InfraObservability,
  InfraServiceSnapshot,
  InfraSpendKind,
  InfraSpendMonth,
  InfraSpendSnapshot,
} from "./types";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function SourceBadge({ observability }: { observability: InfraObservability }) {
  if (observability.mode === "api") {
    return (
      <span className="rounded bg-[var(--color-accent-dim)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-accent)]">
        Live
      </span>
    );
  }
  if (observability.mode === "error") {
    return (
      <span className="rounded bg-[rgba(232,93,108,0.12)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-danger)]">
        Error
      </span>
    );
  }
  return (
    <span className="rounded bg-[rgba(230,184,77,0.12)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warn)]">
      Manual
    </span>
  );
}

function currentFigure(service: InfraServiceSnapshot): string {
  const obs = service.observability;
  if (obs.mode === "api") {
    const label = obs.metric === "balance" ? "bal" : "spend";
    return `${formatSpendUsd(obs.amountUsd)} ${label}`;
  }
  if (service.latestManual) {
    const label =
      service.latestManual.kind === "balance"
        ? "bal"
        : service.latestManual.kind === "spend"
          ? "logged"
          : "note";
    return `${formatSpendUsd(service.latestManual.amount)} ${label}`;
  }
  if (obs.mode === "error") return "poll error";
  return "dashboard only";
}

export function SpendSparkline({ series }: { series: InfraSpendMonth[] }) {
  const max = Math.max(1, ...series.map((d) => d.amount));
  if (series.length === 0 || series.every((d) => d.amount === 0)) {
    return (
      <p className="text-sm text-[var(--color-muted)]">No vendor spend in this window.</p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-1">
        {series.map((month) => {
          const h = Math.max(month.amount > 0 ? 3 : 0, Math.round((month.amount / max) * 100));
          const liveShare = month.amount > 0 ? month.liveUsd / month.amount : 0;
          const manualShare = month.amount > 0 ? month.manualUsd / month.amount : 0;
          return (
            <div
              key={month.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${month.date}: ${formatSpendUsd(month.amount)} · live ${formatSpendUsd(month.liveUsd)} · manual ${formatSpendUsd(month.manualUsd)}`}
            >
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                style={{ height: `${h}%` }}
              >
                {liveShare > 0 ? (
                  <div
                    className="w-full bg-[var(--color-accent)]/80"
                    style={{ height: `${Math.round(liveShare * 100)}%` }}
                  />
                ) : null}
                {manualShare > 0 ? (
                  <div
                    className="w-full bg-[var(--color-warn)]/75"
                    style={{ height: `${Math.round(manualShare * 100)}%` }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-[var(--color-faint)]">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
      <div className="flex gap-3 font-mono text-[9px] text-[var(--color-faint)]">
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-[var(--color-accent)]/80" />
          live API
        </span>
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-[var(--color-warn)]/75" />
          manual log
        </span>
      </div>
    </div>
  );
}

export function useInfraSpend(opsKey: string, months: number) {
  const [data, setData] = useState<InfraSpendSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!opsKey) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchInfraSpend(opsKey, { months });
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vendor spend");
    } finally {
      setLoading(false);
    }
  }, [opsKey, months]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, load };
}

export function InfraSpendOverviewPanel({
  snapshot,
  error,
}: {
  snapshot: InfraSpendSnapshot | null;
  error?: string | null;
}) {
  const data = snapshot;
  const dry = data?.services.filter((s) => s.needsFunding) ?? [];

  return (
    <section className="glow-hover mt-2 rounded-md border border-border bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <Link to="/infra" className="min-w-0 flex-1 text-left transition hover:text-[var(--color-accent)]">
          <h2 className="text-xs font-semibold tracking-tight">Vendor spend</h2>
          <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
            What LMX pays vendors — not customer usage
          </p>
        </Link>
        <Link
          to="/infra"
          className="shrink-0 font-mono text-[10px] text-[var(--color-accent)]"
        >
          Open →
        </Link>
      </div>
      <div className="p-3">
        {error ? (
          <p className="text-[11px] text-[var(--color-danger)]">{error}</p>
        ) : !data ? (
          <p className="text-[11px] text-[var(--color-muted)]">Loading…</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-xl font-semibold tabular-nums text-[var(--color-accent)]">
                {formatSpendUsd(data.monthToDateUsd)}
              </span>
              <span className="text-[10px] text-[var(--color-muted)]">this month</span>
              <span className="font-mono text-[9px] text-[var(--color-faint)]">
                live {formatSpendUsd(data.monthToDate.liveUsd)} · manual{" "}
                {formatSpendUsd(data.monthToDate.manualUsd)}
              </span>
            </div>
            <SpendSparkline series={data.series} />
            <SpendServiceStrip spend={data} />
            {dry.length > 0 ? (
              <p className="mt-2 font-mono text-[10px] text-[var(--color-danger)]">
                Needs funding: {dry.map((s) => s.name).join(", ")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function ServiceCard({ service }: { service: InfraServiceSnapshot }) {
  const obs = service.observability;
  return (
    <li
      className={`rounded border px-3 py-2.5 ${
        service.needsFunding
          ? "border-[var(--color-danger)]/40 bg-[rgba(232,93,108,0.06)]"
          : "border-[var(--color-line)]/80 bg-[var(--color-panel-raised)]/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium">{service.name}</span>
            <SourceBadge observability={obs} />
            {!service.configured && !service.inDocumentedStack ? (
              <span className="font-mono text-[9px] text-[var(--color-faint)]">unconfigured</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{service.purpose}</p>
        </div>
        <span
          className={`shrink-0 font-mono text-[11px] tabular-nums ${
            service.needsFunding ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"
          }`}
        >
          {currentFigure(service)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-[var(--color-faint)]">
        <span className="uppercase tracking-wider">{service.category}</span>
        <a
          href={service.consoleUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          Console
        </a>
        {obs.mode === "api" ? <span title={obs.amountKind}>{obs.amountKind}</span> : null}
        {obs.mode === "not_api_observable" ? <span>{obs.reason}</span> : null}
        {obs.mode === "error" ? <span className="text-[var(--color-danger)]">{obs.error}</span> : null}
      </div>
      {service.latestManual && obs.mode === "api" ? (
        <p className="mt-1 font-mono text-[9px] text-[var(--color-warn)]">
          Last manual log {formatSpendUsd(service.latestManual.amount)} on {service.latestManual.date}
          {service.latestManual.note ? ` — ${service.latestManual.note}` : ""}
        </p>
      ) : null}
      {service.latestManual && obs.mode !== "api" && service.latestManual.note ? (
        <p className="mt-1 font-mono text-[9px] text-[var(--color-muted)]">
          {service.latestManual.date}: {service.latestManual.note}
        </p>
      ) : null}
    </li>
  );
}

function LogForm({
  services,
  opsKey,
  disabled,
  onLogged,
}: {
  services: InfraServiceSnapshot[];
  opsKey: string;
  disabled: boolean;
  onLogged: () => void;
}) {
  const [service, setService] = useState(services[0]?.id ?? "railway");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIsoDate);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<InfraSpendKind>("spend");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await logInfraSpend(opsKey, {
        service,
        amount: Number(amount),
        date,
        note: note.trim() || undefined,
        kind,
      });
      setAmount("");
      setNote("");
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Service
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Amount USD
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
          />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
          />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as InfraSpendKind)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
          >
            <option value="spend">spend (invoice / credit used)</option>
            <option value="balance">balance snapshot</option>
            <option value="note">note (plan / rate)</option>
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-faint)] sm:col-span-2 lg:col-span-1">
          Note
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
          />
        </label>
      </div>
      {error ? <p className="text-[11px] text-[var(--color-danger)]">{error}</p> : null}
      <button
        type="submit"
        disabled={disabled || saving}
        className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[#06110c] disabled:opacity-40"
      >
        {saving ? "Saving…" : "Log entry"}
      </button>
    </form>
  );
}

export function InfraSpendPage({ opsKey }: { opsKey: string }) {
  const [months, setMonths] = useState(12);
  const { data, error, loading, load } = useInfraSpend(opsKey, months);

  const grouped = useMemo(() => {
    if (!data) return [];
    const order = [
      "inference",
      "hosting",
      "database",
      "observability",
      "auth",
      "edge",
      "search",
    ];
    return order
      .map((category) => ({
        category,
        services: data.services.filter((s) => s.category === category),
      }))
      .filter((g) => g.services.length > 0);
  }, [data]);

  return (
    <>
      <PageHeader
        eyebrow="Ops"
        title="Vendor spend"
        description="Hosting, database, observability, and inference vendors LMX pays — separate from customer-usage cost on Overview. Green bars are live API figures; amber bars are invoices or balances logged by hand."
        className="mb-4"
        actions={
          <>
            <label className="flex items-center gap-2 text-body-sm text-on-surface-muted">
              Window
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-2 py-1 font-mono text-body-sm text-on-surface outline-none focus-visible:shadow-focus"
              >
                <option value={6}>6m</option>
                <option value={12}>12m</option>
                <option value={24}>24m</option>
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              disabled={loading || !opsKey}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </>
        }
      />

      {!opsKey ? (
        <p className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-muted)]">
          Connect an ops API key on the{" "}
          <Link to="/" className="text-[var(--color-accent)] underline-offset-2 hover:underline">
            overview
          </Link>{" "}
          first.
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded border border-[var(--color-danger)]/40 bg-[rgba(232,93,108,0.1)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-3">
          <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                  This month
                </div>
                <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-accent)]">
                  {formatSpendUsd(data.monthToDateUsd)}
                </div>
              </div>
              <div className="font-mono text-[10px] text-[var(--color-faint)]">
                live {formatSpendUsd(data.monthToDate.liveUsd)} · manual{" "}
                {formatSpendUsd(data.monthToDate.manualUsd)} · storage {data.storage}
              </div>
            </div>
            <SpendSparkline series={data.series} />
          </section>

          {grouped.map((group) => (
            <section
              key={group.category}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]"
            >
              <div className="border-b border-[var(--color-line)] px-3 py-2">
                <h2 className="text-xs font-semibold capitalize tracking-tight">{group.category}</h2>
              </div>
              <ul className="space-y-1.5 p-2">
                {group.services.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
            <h2 className="text-xs font-semibold tracking-tight">Log an entry</h2>
            <p className="mt-1 mb-3 text-[11px] text-[var(--color-muted)]">
              Use <span className="font-mono">spend</span> for invoices or credit consumed,{" "}
              <span className="font-mono">balance</span> for remaining vendor credits,{" "}
              <span className="font-mono">note</span> for plan changes with no dollar amount.
              {data.storage === "unavailable"
                ? " Requires DATABASE_URL on the API."
                : null}
            </p>
            <LogForm
              services={data.services}
              opsKey={opsKey}
              disabled={data.storage === "unavailable"}
              onLogged={() => void load()}
            />
          </section>

          <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
            <h2 className="text-xs font-semibold tracking-tight">Log</h2>
            {data.entries.length === 0 ? (
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">No rows yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[var(--color-faint)]">
                    <tr>
                      <th className="pb-1 font-medium">Date</th>
                      <th className="pb-1 font-medium">Service</th>
                      <th className="pb-1 font-medium">Kind</th>
                      <th className="pb-1 font-medium">Amount</th>
                      <th className="pb-1 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((row) => (
                      <tr key={row.id} className="border-t border-[var(--color-line)]/60">
                        <td className="whitespace-nowrap py-1 font-mono text-[var(--color-muted)]">
                          {row.date}
                        </td>
                        <td className="py-1 font-mono">{row.service}</td>
                        <td className="py-1 font-mono">{row.kind}</td>
                        <td className="py-1 font-mono">{formatSpendUsd(row.amount)}</td>
                        <td className="max-w-[20rem] truncate py-1 text-[var(--color-muted)]" title={row.note ?? ""}>
                          {row.note ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.entries[0] ? (
              <p className="mt-2 font-mono text-[9px] text-[var(--color-faint)]">
                Newest logged {formatTime(data.entries[0].createdAt)}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
