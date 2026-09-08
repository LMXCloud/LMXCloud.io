import { BarChart3, Bot, Boxes, Coins, FlaskConical, FolderKanban, KeyRound, Plus, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchKeys, fetchStatus, fetchUsageHistory } from "../api";
import { BarChart } from "../components/BarChart";
import { AlertBanner } from "../components/console/AlertBanner";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "../components/console/DataTable";
import { EnvironmentChip } from "../components/console/EnvironmentChip";
import { NewAgentQuickstart } from "../components/console/NewAgentQuickstart";
import { PageHeader } from "../components/console/PageHeader";
import { QuickLink } from "../components/console/QuickLink";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { useAuth } from "../context/AuthContext";
import { formatApiKeyLabel, formatNumber, formatUsd, formatWallet } from "../lib/format";
import type { ApiKeyInfo } from "../types";

export function OverviewPage() {
  const { apiKey, email, wallet, authMode } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [chartRequests, setChartRequests] = useState<number[]>([]);
  const [providerHealth, setProviderHealth] = useState<string | null>(null);
  const [pinOnboarding, setPinOnboarding] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!apiKey) return;
    if (!opts?.silent) setLoading(true);
    try {
      const [keysRes, historyRes, statusRes] = await Promise.all([
        fetchKeys(apiKey),
        fetchUsageHistory(apiKey, 7),
        fetchStatus().catch(() => null),
      ]);
      setKeys(keysRes.data);
      setChartLabels(historyRes.data.map((bucket) => bucket.date));
      setChartRequests(historyRes.data.map((bucket) => bucket.requests));
      if (statusRes) {
        const healthy = Object.entries(statusRes.providers).filter(([, p]) => p.healthy);
        setProviderHealth(
          healthy.length > 0
            ? `${healthy.length}/${Object.keys(statusRes.providers).length} providers healthy`
            : "Providers degraded",
        );
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalBalance = keys.reduce((sum, key) => sum + key.balance, 0);
  const totalRequests = keys.reduce((sum, key) => sum + key.usage.requests, 0);
  const totalTokens = keys.reduce((sum, key) => sum + key.usage.total_tokens, 0);
  const hasActivity = totalRequests > 0;
  const showOnboarding = pinOnboarding || (!loading && !hasActivity);
  const lowBalance = !loading && totalBalance < 0.01;
  const providersDegraded = Boolean(providerHealth?.includes("degraded"));
  const greetingName =
    email?.split("@")[0] ||
    (authMode === "wallet" && wallet ? formatWallet(wallet) : null) ||
    "there";

  return (
    <div className="space-y-6">
      {showOnboarding && (
        <NewAgentQuickstart variant="embedded" onStarted={() => setPinOnboarding(true)} />
      )}

      <PageHeader
        title={`Hello, ${greetingName}`}
        actions={
          <>
            {!showOnboarding && (
              <Button to="/console/agents/new" variant="secondary" size="sm" pill>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                New agent
              </Button>
            )}
            <Button to="/console/credits" size="sm" pill>
              <Coins className="h-3.5 w-3.5" strokeWidth={1.75} />
              Add credits
            </Button>
          </>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          label="Total balance"
          value={loading ? "…" : formatUsd(totalBalance, 2)}
          tone={lowBalance ? "warning" : "default"}
        />
        <StatCard
          label="API keys"
          value={loading ? "…" : String(keys.length)}
        />
        <StatCard
          label="Total requests"
          value={loading ? "…" : formatNumber(totalRequests)}
        />
        <StatCard
          label="Total tokens"
          value={loading ? "…" : formatNumber(totalTokens)}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <BarChart
          className="lg:col-span-2"
          title="Requests (last 7 days)"
          labels={chartLabels}
          values={chartRequests}
          spanDays={7}
          valueLabel={(value) => String(value)}
        />
        <Card className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-body-sm font-semibold text-on-surface">Providers</h3>
            {providersDegraded && <Chip tone="warning">Degraded</Chip>}
          </div>
          <p className="mt-2 text-body-sm text-on-surface-muted">
            {providerHealth ?? (loading ? "Checking provider health…" : "Status unavailable")}
          </p>
          <p className="mt-2 text-body-sm text-on-surface-faint">
            OpenAI-compatible routing across DePIN providers.
          </p>
          <div className="mt-auto pt-4">
            <Button to="/status" variant="tertiary" size="sm">
              View status
            </Button>
          </div>
        </Card>
      </div>

      <DataTable
        title="Agents"
        description="Named API keys appear here. A vault will attach after the agent registers — no vault column yet."
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Agent</DataTableTh>
            <DataTableTh>Balance</DataTableTh>
            <DataTableTh>Requests</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={3}>Loading agents…</DataTableEmpty>
          ) : keys.length === 0 ? (
            <DataTableEmpty colSpan={3}>
              No agents yet. Use New agent above to create a named key.
            </DataTableEmpty>
          ) : (
            keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={key.name?.trim() ? "text-on-surface" : "font-mono text-on-surface"}>
                      {formatApiKeyLabel(key)}
                    </span>
                    {key.project_name && <Chip tone="default">{key.project_name}</Chip>}
                    <EnvironmentChip environment={key.environment} />
                    {key.is_current && <Chip tone="default">current session</Chip>}
                  </div>
                </DataTableCell>
                <DataTableCell tabular>{formatUsd(key.balance)}</DataTableCell>
                <DataTableCell tabular>{formatNumber(key.usage.requests)}</DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink
          to="/console/agents"
          icon={Bot}
          title="Agents"
          description="Directory of named keys, status, and vault placeholders."
        />
        <QuickLink
          to="/console/playground"
          icon={FlaskConical}
          title="Playground"
          description="Live chat, streaming, and copy-paste snippets."
        />
        <QuickLink
          to="/console/models"
          icon={Boxes}
          title="Models & pricing"
          description="Catalog, per-1k rates, and x402 network info."
        />
        <QuickLink
          to="/console/projects"
          icon={FolderKanban}
          title="Projects"
          description="Group keys by product or integration."
        />
        <QuickLink
          to="/console/keys"
          icon={KeyRound}
          title="API Keys"
          description="Create keys, MCP config, and revoke access."
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <QuickLink
          to="/console/usage"
          icon={BarChart3}
          title="Usage"
          description="Daily aggregates, tokens, and spend."
        />
        <QuickLink
          to="/console/logs"
          icon={ScrollText}
          title="Request logs"
          description="Per-call metadata with on-chain proof verification."
        />
      </div>
    </div>
  );
}
