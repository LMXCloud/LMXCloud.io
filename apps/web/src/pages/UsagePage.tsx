import { useCallback, useEffect, useState } from "react";
import { fetchUsageHistory } from "../api";
import { BarChart } from "../components/BarChart";
import { StatCard } from "../components/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import { formatNumber, formatUsd } from "../lib/format";
import type { UsageHistoryBucket } from "../types";

const RANGE_OPTIONS = [
  { days: 7 as const, label: "7 days" },
  { days: 30 as const, label: "30 days" },
];

export function UsagePage() {
  const { apiKey } = useAuth();
  const [days, setDays] = useState<7 | 30>(7);
  const [buckets, setBuckets] = useState<UsageHistoryBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await fetchUsageHistory(apiKey, days);
      setBuckets(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, [apiKey, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalRequests = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  const totalTokens = buckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0);
  const totalCost = buckets.reduce((sum, bucket) => sum + bucket.cost, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-headline-md text-on-surface">Usage</h2>
          <p className="mt-1 text-body-sm text-on-surface-muted">
            Account-wide inference activity across all linked keys.
          </p>
        </div>
        <Tabs
          items={RANGE_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
          value={String(days)}
          onChange={(value) => setDays(Number(value) as 7 | 30)}
        />
      </div>

      {error && (
        <p className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={`Requests (${days}d)`}
          value={loading ? "…" : formatNumber(totalRequests)}
        />
        <StatCard
          label={`Tokens (${days}d)`}
          value={loading ? "…" : formatNumber(totalTokens)}
        />
        <StatCard
          label={`Spend (${days}d)`}
          value={loading ? "…" : formatUsd(totalCost)}
          tone="warn"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BarChart
          title="Daily requests"
          labels={buckets.map((bucket) => bucket.date)}
          values={buckets.map((bucket) => bucket.requests)}
        />
        <BarChart
          title="Daily tokens"
          labels={buckets.map((bucket) => bucket.date)}
          values={buckets.map((bucket) => bucket.total_tokens)}
          color="var(--color-warning)"
          valueLabel={(value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value))}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-border text-label-sm text-on-surface-muted">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Prompt tokens</th>
              <th className="px-4 py-3">Completion tokens</th>
              <th className="px-4 py-3">Cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-on-surface-muted">
                  Loading usage…
                </td>
              </tr>
            ) : buckets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-on-surface-muted">
                  No usage in this period. Send inference requests to populate charts.
                </td>
              </tr>
            ) : (
              [...buckets].reverse().map((bucket) => (
                <tr key={bucket.date} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-mono-sm">{bucket.date}</td>
                  <td className="px-4 py-3 text-mono-sm">{bucket.requests}</td>
                  <td className="px-4 py-3 text-mono-sm">{formatNumber(bucket.prompt_tokens)}</td>
                  <td className="px-4 py-3 text-mono-sm">{formatNumber(bucket.completion_tokens)}</td>
                  <td className="px-4 py-3 text-mono-sm text-warning">
                    {formatUsd(bucket.cost)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
