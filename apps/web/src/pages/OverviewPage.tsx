import { useCallback, useEffect, useState } from "react";
import { fetchKeys, fetchUsageHistory } from "../api";
import { BarChart } from "../components/BarChart";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { formatNumber, formatUsd } from "../lib/format";
import type { ApiKeyInfo } from "../types";

export function OverviewPage() {
  const { apiKey } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [chartRequests, setChartRequests] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const [keysRes, historyRes] = await Promise.all([
        fetchKeys(apiKey),
        fetchUsageHistory(apiKey, 7),
      ]);
      setKeys(keysRes.data);
      setChartLabels(historyRes.data.map((bucket) => bucket.date));
      setChartRequests(historyRes.data.map((bucket) => bucket.requests));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalBalance = keys.reduce((sum, key) => sum + key.balance, 0);
  const totalRequests = keys.reduce((sum, key) => sum + key.usage.requests, 0);
  const totalTokens = keys.reduce((sum, key) => sum + key.usage.total_tokens, 0);
  const accountEmail = keys.find((key) => key.email)?.email;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-headline-md text-on-surface">Overview</h2>
        <p className="mt-1 text-body-sm text-on-surface-muted">
          {accountEmail ? `Account: ${accountEmail}` : "Your LMX Cloud account at a glance."}
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total balance"
          value={loading ? "…" : formatUsd(totalBalance)}
          tone="accent"
        />
        <StatCard
          label="API keys"
          value={loading ? "…" : String(keys.length)}
          hint="Active keys on this account"
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

      <BarChart
        title="Requests (last 7 days)"
        labels={chartLabels}
        values={chartRequests}
        valueLabel={(value) => String(value)}
      />
    </div>
  );
}
