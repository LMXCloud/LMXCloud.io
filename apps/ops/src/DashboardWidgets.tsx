import { Link } from "react-router-dom";
import { formatLatency, formatNum, formatPct, formatSpendUsd } from "./format";
import { LINK_GROUP_LABEL, OPS_LINKS, type OpsLinkGroup } from "./links";
import type { InfraSpendSnapshot, OpsOverview } from "./types";

export function StatusPills({ data }: { data: OpsOverview }) {
  const pills: Array<{ label: string; ok: boolean }> = [
    { label: `x402 ${data.server.x402Enabled ? "on" : "off"}`, ok: data.server.x402Enabled },
    { label: data.storage, ok: data.storage === "postgres" },
    { label: `payments ${data.server.paymentStore}`, ok: data.server.paymentStore === "ready" },
    {
      label: `providers ${data.health.healthyCount}/${data.health.providerCount}`,
      ok: data.health.healthyCount === data.health.providerCount,
    },
    {
      label: `${data.attention.critical} crit · ${data.attention.warn} warn`,
      ok: data.attention.critical === 0,
    },
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {pills.map((pill) => (
        <span
          key={pill.label}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            pill.ok
              ? "border-[var(--color-accent)]/25 bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
              : "border-[var(--color-warn)]/30 bg-[rgba(230,184,77,0.1)] text-[var(--color-warn)]"
          }`}
        >
          {pill.label}
        </span>
      ))}
    </div>
  );
}

type DecisionItem = {
  id: string;
  tone: "danger" | "warn" | "info";
  text: string;
  href?: string;
};

function providerDownText(name: string, errorDetail?: string): string {
  const detail = errorDetail?.trim();
  if (!detail) return `${name} down`;
  const short = detail.length > 72 ? `${detail.slice(0, 69)}…` : detail;
  return `${name} down · ${short}`;
}

export function DecisionBar({
  data,
  spend,
}: {
  data: OpsOverview;
  spend: InfraSpendSnapshot | null;
}) {
  const items: DecisionItem[] = [];

  for (const [name, status] of Object.entries(data.health.providers)) {
    if (!status.healthy) {
      items.push({
        id: `down-${name}`,
        tone: "danger",
        text: providerDownText(name, status.errorDetail),
        href: "/?view=providers",
      });
    } else if (status.balance?.belowThreshold) {
      items.push({
        id: `low-${name}`,
        tone: "danger",
        text: `${name} below credit threshold`,
        href: "/?view=providers",
      });
    }
  }

  for (const service of spend?.services ?? []) {
    if (service.needsFunding) {
      items.push({
        id: `fund-${service.id}`,
        tone: "danger",
        text: `${service.name} needs funding`,
        href: "/infra",
      });
    }
  }

  const stuck = data.paymentsStuck?.length ?? 0;
  if (stuck > 0) {
    items.push({
      id: "stuck",
      tone: "warn",
      text: `${stuck} stuck payment${stuck === 1 ? "" : "s"}`,
      href: "/?view=stuck-payments",
    });
  }

  const manualRefunds = (data.reconciliationsPending ?? []).filter(
    (r) => r.status === "manual_required" && r.kind === "x402_refund",
  ).length;
  if (manualRefunds > 0) {
    items.push({
      id: "refunds",
      tone: "warn",
      text: `${manualRefunds} refund${manualRefunds === 1 ? "" : "s"} need approval`,
    });
  }

  if (!data.server.x402Enabled) {
    items.push({ id: "x402", tone: "info", text: "x402 is off" });
  }
  if (data.storage !== "postgres") {
    items.push({ id: "storage", tone: "warn", text: "Not on Postgres — keys/usage will not persist" });
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });

  if (unique.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/25 bg-[var(--color-accent-dim)] px-3 py-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
        <span className="text-xs font-medium text-[var(--color-accent)]">
          Nothing blocking — all housekeeping green
        </span>
      </div>
    );
  }

  const toneClass = (tone: DecisionItem["tone"]) => {
    if (tone === "danger") return "border-[var(--color-danger)]/40 text-[var(--color-danger)]";
    if (tone === "warn") return "border-[var(--color-warn)]/40 text-[var(--color-warn)]";
    return "border-[var(--color-info)]/40 text-[var(--color-info)]";
  };

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {unique.map((item) => {
        const className = `rounded border px-2 py-1 font-mono text-[10px] ${toneClass(item.tone)}`;
        if (item.href?.startsWith("http")) {
          return (
            <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className={className}>
              {item.text}
            </a>
          );
        }
        if (item.href) {
          return (
            <Link key={item.id} to={item.href} className={className}>
              {item.text}
            </Link>
          );
        }
        return (
          <span key={item.id} className={className}>
            {item.text}
          </span>
        );
      })}
    </div>
  );
}

export function QuickLinks({
  spend,
}: {
  spend?: InfraSpendSnapshot | null;
}) {
  const funding = new Set(
    (spend?.services ?? []).filter((s) => s.needsFunding).map((s) => s.id),
  );
  const groups: OpsLinkGroup[] = ["vendors", "stack", "product", "distribution"];

  return (
    <section className="mb-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      <h2 className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
        Quick links
      </h2>
      <div className="mt-2 space-y-2">
        {groups.map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 font-mono text-[9px] uppercase tracking-wider text-[var(--color-faint)]">
              {LINK_GROUP_LABEL[group]}
            </span>
            {OPS_LINKS.filter((l) => l.group === group).map((link) => {
              const dry = funding.has(link.id);
              return (
                <a
                  key={link.id}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded border px-2 py-0.5 text-[11px] transition hover:border-[var(--color-accent)] ${
                    dry
                      ? "border-[var(--color-danger)]/40 text-[var(--color-danger)]"
                      : "border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReliabilityPanel({
  data,
  onExplore,
}: {
  data: OpsOverview;
  onExplore?: () => void;
}) {
  const rel = data.reliability;
  if (!rel) {
    return (
      <p className="text-[11px] text-[var(--color-muted)]">No reliability telemetry yet.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-lg tabular-nums text-[var(--color-accent)]">
          {formatPct(rel.overall.successRate)}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-faint)]">
          {formatNum(rel.overall.successes)}/{formatNum(rel.overall.attempts)} ok ·{" "}
          {formatLatency(rel.overall.avgLatencyMs)}
        </span>
      </div>
      <ul className="space-y-1">
        {rel.byProvider.slice(0, 6).map((row) => (
          <li
            key={`${row.resourceType}-${row.provider}`}
            className="flex items-center justify-between gap-2 font-mono text-[11px]"
          >
            <span className="truncate text-[var(--color-ink)]">{row.provider}</span>
            <span
              className={
                row.successRate < 0.9
                  ? "text-[var(--color-danger)]"
                  : "text-[var(--color-muted)]"
              }
            >
              {formatPct(row.successRate)} · {formatNum(row.attempts)}
            </span>
          </li>
        ))}
      </ul>
      {onExplore && rel.byProvider.length > 6 ? (
        <button
          type="button"
          onClick={onExplore}
          className="text-[10px] text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          All providers →
        </button>
      ) : null}
    </div>
  );
}

export function SpendServiceStrip({ spend }: { spend: InfraSpendSnapshot }) {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {spend.services.map((service) => {
        const obs = service.observability;
        const figure =
          obs.mode === "api"
            ? `${formatSpendUsd(obs.amountUsd)} ${obs.metric === "balance" ? "bal" : ""}`
            : service.latestManual
              ? formatSpendUsd(service.latestManual.amount)
              : "—";
        return (
          <li key={service.id}>
            <a
              href={service.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] transition hover:border-[var(--color-accent)] ${
                service.needsFunding
                  ? "border-[var(--color-danger)]/40 text-[var(--color-danger)]"
                  : "border-[var(--color-line)]/80 text-[var(--color-muted)]"
              }`}
            >
              <span className="truncate font-medium text-[var(--color-ink)]">{service.name}</span>
              <span className="shrink-0 font-mono tabular-nums">{figure}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
