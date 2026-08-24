import { Activity, ArrowRight, FileJson, Link2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  API_BASE,
  fetchStatus,
  fetchStatusHistory,
  type StatusHistoryResponse,
  type StatusHistorySignalStats,
  type StatusResponse,
} from "../api";
import { PublicLayout } from "../components/PublicLayout";
import { SeoHead } from "../components/SeoHead";
import { PageHeader } from "../components/console/PageHeader";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "../components/console/DataTable";
import { AlertBanner } from "../components/console/AlertBanner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { formatDateTime, formatLatency, contractExplorerUrl } from "../lib/format";

const POLL_MS = 30_000;
const HISTORY_DAYS = 7;

function formatLastCheck(timestamp: number | null): string {
  if (timestamp === null) return "—";
  return formatDateTime(new Date(timestamp).toISOString());
}

function chainLabel(chainId: number): string {
  return chainId === 84532 ? "Base Sepolia" : "Base";
}

function txUrl(chainId: number, txHash: string): string {
  const base =
    chainId === 84532
      ? "https://sepolia.basescan.org/tx/"
      : "https://basescan.org/tx/";
  return `${base}${txHash}`;
}

function summarizeSignal(
  rows: Array<{ provider: string; signal: StatusHistorySignalStats }>,
) {
  const checks = rows.reduce((sum, row) => sum + row.signal.checks, 0);
  const healthy = rows.reduce((sum, row) => sum + row.signal.healthy_checks, 0);
  const latencyRows = rows.filter((row) => row.signal.avg_latency_ms != null);
  const avgLatency =
    latencyRows.length === 0
      ? null
      : Math.round(
          latencyRows.reduce(
            (sum, row) => sum + (row.signal.avg_latency_ms ?? 0),
            0,
          ) / latencyRows.length,
        );
  return {
    checks,
    healthy,
    uptime: checks === 0 ? 0 : Math.round((healthy / checks) * 10_000) / 10_000,
    avgLatency,
  };
}

function SignalTable({
  title,
  description,
  summary,
  rows,
}: {
  title: string;
  description: string;
  summary: ReturnType<typeof summarizeSignal>;
  rows: Array<{ provider: string; signal: StatusHistorySignalStats }>;
}) {
  return (
    <div className="mt-8 first:mt-4">
      <p className="text-body-sm font-medium text-on-surface">{title}</p>
      <p className="mt-1 text-body-sm text-on-surface-muted">
        {description}{" "}
        {summary.checks > 0 ? (
          <>
            {(summary.uptime * 100).toFixed(1)}% across{" "}
            {summary.checks.toLocaleString()} samples
            {summary.avgLatency != null
              ? ` · ${formatLatency(summary.avgLatency)} avg`
              : ""}
            .
          </>
        ) : (
          <>No samples in this window yet.</>
        )}
      </p>
      <div className="mt-4">
        <DataTable title={title} minWidth={640}>
          <DataTableHead>
            <tr>
              <DataTableTh>Provider</DataTableTh>
              <DataTableTh>Uptime</DataTableTh>
              <DataTableTh>Samples</DataTableTh>
              <DataTableTh>Avg latency</DataTableTh>
              <DataTableTh>p50</DataTableTh>
              <DataTableTh>p95</DataTableTh>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={6}>No providers configured.</DataTableEmpty>
            ) : (
              rows.map(({ provider, signal }) => (
                <DataTableRow key={provider}>
                  <DataTableCell className="font-medium">{provider}</DataTableCell>
                  <DataTableCell>
                    {signal.checks > 0 ? `${(signal.uptime * 100).toFixed(1)}%` : "—"}
                  </DataTableCell>
                  <DataTableCell>
                    {signal.checks > 0
                      ? `${signal.healthy_checks}/${signal.checks}`
                      : "0"}
                  </DataTableCell>
                  <DataTableCell>
                    {signal.avg_latency_ms != null
                      ? formatLatency(signal.avg_latency_ms)
                      : "—"}
                  </DataTableCell>
                  <DataTableCell>
                    {signal.p50_latency_ms != null
                      ? formatLatency(signal.p50_latency_ms)
                      : "—"}
                  </DataTableCell>
                  <DataTableCell>
                    {signal.p95_latency_ms != null
                      ? formatLatency(signal.p95_latency_ms)
                      : "—"}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </DataTable>
      </div>
    </div>
  );
}

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [history, setHistory] = useState<StatusHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [statusResult, historyResult] = await Promise.allSettled([
        fetchStatus(),
        fetchStatusHistory(HISTORY_DAYS),
      ]);

      if (statusResult.status === "rejected") {
        throw statusResult.reason instanceof Error
          ? statusResult.reason
          : new Error("Failed to load status");
      }

      setStatus(statusResult.value);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
      }
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const providers = status
    ? Object.entries(status.providers).sort(([, a], [, b]) => a.tier - b.tier)
    : [];
  const healthyCount = providers.filter(([, p]) => p.healthy).length;
  const allHealthy = providers.length > 0 && healthyCount === providers.length;
  const noneHealthy = providers.length > 0 && healthyCount === 0;
  const overall = status?.reliability?.overall;
  const routingChain =
    status?.effective_routing_chain ?? status?.fallback_chain ?? [];

  const gatewayRows =
    history?.by_provider.map((row) => ({
      provider: row.provider,
      signal: row.gateway,
    })) ?? [];
  const syntheticRows =
    history?.by_provider.map((row) => ({
      provider: row.provider,
      signal: row.synthetic_completion,
    })) ?? [];
  const trafficRows =
    history?.by_provider.map((row) => ({
      provider: row.provider,
      signal: row.real_traffic,
    })) ?? [];

  return (
    <PublicLayout>
      <SeoHead
        title="Provider Status — LMX Cloud DePIN inference"
        description="Live health and real chat success rates for LMX Cloud inference providers on io.net, AkashML, and Aethir Mesh. Router uses gateway, synthetic, and real-traffic signals with circuit breaking."
        path="/status"
      />
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)] py-10 sm:py-14">
        <PageHeader
          eyebrow="Infrastructure"
          title="Provider status"
          description="Live gateway health plus real chat success rates. The router weights gateway, synthetic probes, and real traffic — and circuit-breaks providers that crater."
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        {error && (
          <AlertBanner tone="error" className="mt-6">
            {error}
            <span className="block mt-1 text-body-sm opacity-80">
              API: {API_BASE}/v1/status
            </span>
          </AlertBanner>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Overall"
            value={
              loading
                ? "…"
                : allHealthy
                  ? "Operational"
                  : noneHealthy
                    ? "Degraded"
                    : "Partial"
            }
            tone={allHealthy ? "success" : noneHealthy ? "error" : "warning"}
            hint={
              loading
                ? "Checking providers…"
                : `${healthyCount} of ${providers.length} providers reachable`
            }
          />
          <StatCard
            label="Chat success (7d)"
            value={
              loading || !overall
                ? "—"
                : overall.attempts === 0
                  ? "—"
                  : `${(overall.success_rate * 100).toFixed(1)}%`
            }
            tone={
              !overall || overall.attempts === 0
                ? "info"
                : overall.success_rate >= 0.8
                  ? "success"
                  : overall.success_rate >= 0.4
                    ? "warning"
                    : "error"
            }
            hint={
              overall && overall.attempts > 0
                ? `${overall.successes}/${overall.attempts} real chat attempts`
                : "No chat samples in window"
            }
          />
          <StatCard
            label="Healthy providers"
            value={loading ? "—" : String(healthyCount)}
            tone="primary"
            hint="Gateway reachable (excludes our key/funding faults)"
          />
          <StatCard
            label="Last updated"
            value={lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
            tone="info"
            hint={lastUpdated ? "Auto-refreshes every 30s" : "Waiting for first poll"}
          />
        </div>

        {routingChain.length > 0 && (
          <Card className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-primary" strokeWidth={1.75} />
              <p className="text-body-sm font-medium text-on-surface">Effective routing order</p>
              <span className="text-body-sm text-on-surface-faint">
                · score + circuit (not static tier alone)
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {routingChain.map((name, index) => {
                const provider = status?.providers[name];
                const demoted = provider?.routing?.demoted;
                const circuit = provider?.routing?.circuit;
                const tone =
                  circuit === "open"
                    ? "error"
                    : demoted
                      ? "warning"
                      : provider?.healthy
                        ? "success"
                        : "error";
                return (
                  <div key={name} className="flex items-center gap-2">
                    {index > 0 && (
                      <ArrowRight className="h-3.5 w-3.5 text-on-surface-faint" strokeWidth={1.75} />
                    )}
                    <Chip tone={tone} className="gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          tone === "success"
                            ? "bg-success"
                            : tone === "warning"
                              ? "bg-warning"
                              : "bg-error"
                        }`}
                      />
                      {name}
                      <span className="text-on-surface-faint">T{provider?.tier ?? "?"}</span>
                      {circuit === "open" && (
                        <span className="text-on-surface-faint">circuit open</span>
                      )}
                      {circuit === "half_open" && (
                        <span className="text-on-surface-faint">half-open</span>
                      )}
                      {demoted && circuit !== "open" && (
                        <span className="text-on-surface-faint">demoted</span>
                      )}
                    </Chip>
                  </div>
                );
              })}
            </div>
            {status?.fallback_chain && status.fallback_chain.length > 0 && (
              <p className="mt-3 text-body-sm text-on-surface-faint">
                Static tier chain: {status.fallback_chain.join(" → ")}
              </p>
            )}
          </Card>
        )}

        {history && (
          <Card className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-primary" strokeWidth={1.75} />
              <p className="text-body-sm font-medium text-on-surface">
                Reliability signals
              </p>
              <span className="text-body-sm text-on-surface-faint">
                · last {history.window_days}d
              </span>
            </div>
            <p className="mt-3 text-body-sm text-on-surface-muted">
              Three independent signals — not blended. Gateway is reachability;
              synthetic is a real completion probe; real traffic is customer usage.
              Invalid API keys and insufficient credits are treated as operator
              issues, not provider downtime.
            </p>
            <SignalTable
              title="Gateway ping"
              description="GET /models every ~30s (persisted)."
              summary={summarizeSignal(gatewayRows)}
              rows={gatewayRows}
            />
            <SignalTable
              title="Synthetic completion"
              description="Minimal chatCompletion via the real adapter path (~every 3 min)."
              summary={summarizeSignal(syntheticRows)}
              rows={syntheticRows}
            />
            <SignalTable
              title="Real traffic"
              description="Customer chat usage outcomes (from usage events, not re-polled)."
              summary={summarizeSignal(trafficRows)}
              rows={trafficRows}
            />
          </Card>
        )}

        {status && !status.anchoring.enabled && (
          <Card className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <FileJson className="h-4 w-4 text-primary" strokeWidth={1.75} />
              <p className="text-body-sm font-medium text-on-surface">Request receipts</p>
            </div>
            <p className="mt-3 text-body-sm text-on-surface-muted">
              Each inference call gets a cryptographic receipt hash (provider, model, tokens, cost,
              latency). On-chain Merkle anchoring is enabled in local dev only — production API
              deployments record receipts without posting roots to Base.
            </p>
          </Card>
        )}

        {status?.anchoring?.enabled && (
          <Card className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" strokeWidth={1.75} />
              <p className="text-body-sm font-medium text-on-surface">
                Verifiable log anchoring
              </p>
              <span className="text-body-sm text-on-surface-faint">
                · {chainLabel(status.anchoring.chain_id ?? 8453)}
              </span>
            </div>
            <p className="mt-3 text-body-sm text-on-surface-muted">
              Inference routing metadata is batched into Merkle trees and anchored on-chain.
              Contract:{" "}
              <a
                href={contractExplorerUrl(
                  status.anchoring.chain_id ?? 8453,
                  status.anchoring.contract_address ?? "",
                )}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-primary hover:underline"
              >
                {status.anchoring.contract_address}
              </a>
            </p>
            {status.anchoring.recent_roots && status.anchoring.recent_roots.length > 0 ? (
              <div className="mt-6">
                <DataTable title="Recent anchored roots" minWidth={720}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Merkle root</DataTableTh>
                      <DataTableTh>Receipts</DataTableTh>
                      <DataTableTh>Anchored</DataTableTh>
                      <DataTableTh>Transaction</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {status.anchoring.recent_roots.map((root) => (
                      <DataTableRow key={root.root}>
                        <DataTableCell mono className="max-w-[200px] truncate">
                          {root.root}
                        </DataTableCell>
                        <DataTableCell>{root.event_count}</DataTableCell>
                        <DataTableCell>
                          {formatDateTime(root.anchored_at)}
                        </DataTableCell>
                        <DataTableCell>
                          {root.tx_hash && root.tx_hash !== "0x0" ? (
                            <a
                              href={txUrl(status.anchoring!.chain_id ?? 8453, root.tx_hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-body-sm text-primary hover:underline"
                            >
                              View
                            </a>
                          ) : (
                            "—"
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>
            ) : (
              <p className="mt-4 text-body-sm text-on-surface-muted">
                No roots anchored yet — send inference and wait for the next batch.
              </p>
            )}
          </Card>
        )}

        <div className="mt-8">
          <DataTable title="Providers" minWidth={880}>
            <DataTableHead>
              <tr>
                <DataTableTh>Provider</DataTableTh>
                <DataTableTh>Gateway</DataTableTh>
                <DataTableTh>Real success (7d)</DataTableTh>
                <DataTableTh>Routing</DataTableTh>
                <DataTableTh>Tier</DataTableTh>
                <DataTableTh>Type</DataTableTh>
                <DataTableTh>Latency</DataTableTh>
                <DataTableTh>Last check</DataTableTh>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {loading && providers.length === 0 ? (
                <DataTableEmpty colSpan={8}>Loading provider health…</DataTableEmpty>
              ) : providers.length === 0 ? (
                <DataTableEmpty colSpan={8}>No providers configured.</DataTableEmpty>
              ) : (
                providers.map(([name, provider]) => {
                  const attempts = provider.real_attempts ?? 0;
                  const successes = provider.real_successes ?? 0;
                  const rate = provider.real_success_rate;
                  const circuit = provider.routing?.circuit ?? "closed";
                  const demoted = provider.routing?.demoted ?? false;
                  return (
                    <DataTableRow key={name}>
                      <DataTableCell mono>{name}</DataTableCell>
                      <DataTableCell>
                        <Chip tone={provider.healthy ? "success" : "error"} className="gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${provider.healthy ? "bg-success" : "bg-error"}`}
                          />
                          {provider.healthy ? "Healthy" : "Unhealthy"}
                        </Chip>
                      </DataTableCell>
                      <DataTableCell mono>
                        {attempts > 0 && rate != null
                          ? `${successes}/${attempts} · ${(rate * 100).toFixed(1)}%`
                          : "—"}
                      </DataTableCell>
                      <DataTableCell>
                        <Chip
                          tone={
                            circuit === "open"
                              ? "error"
                              : demoted || circuit === "half_open"
                                ? "warning"
                                : "success"
                          }
                          className="gap-1.5"
                        >
                          {circuit === "open"
                            ? "Circuit open"
                            : circuit === "half_open"
                              ? "Half-open"
                              : demoted
                                ? "Demoted"
                                : "Active"}
                        </Chip>
                      </DataTableCell>
                      <DataTableCell>{provider.tier}</DataTableCell>
                      <DataTableCell>
                        <Chip tone={provider.is_depin ? "info" : "default"}>
                          {provider.is_depin ? "DePIN" : "Centralized"}
                        </Chip>
                      </DataTableCell>
                      <DataTableCell mono>
                        {provider.latency !== null ? formatLatency(provider.latency) : "—"}
                      </DataTableCell>
                      <DataTableCell>{formatLastCheck(provider.last_check)}</DataTableCell>
                    </DataTableRow>
                  );
                })
              )}
            </DataTableBody>
          </DataTable>
        </div>

        <p className="mt-8 text-body-sm text-on-surface-muted">
          Need integration details? See the{" "}
          <Link to="/docs" className="text-primary hover:text-primary-hover">
            API docs
          </Link>{" "}
          for quickstart, models, and routing headers.
        </p>
      </div>
    </PublicLayout>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "success" | "error" | "warning" | "primary" | "info";
  hint: string;
}) {
  const hairline = {
    success: "bg-success",
    error: "bg-error",
    warning: "bg-warning",
    primary: "bg-primary",
    info: "bg-info",
  }[tone];

  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${hairline}`} aria-hidden />
      <p className="text-label-sm text-on-surface-muted">{label}</p>
      <p className="mt-2 text-headline-md text-on-surface">{value}</p>
      <p className="mt-2 text-body-sm text-on-surface-faint">{hint}</p>
    </Card>
  );
}
