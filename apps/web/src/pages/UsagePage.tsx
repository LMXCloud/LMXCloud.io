import { useCallback, useEffect, useState } from "react";
import { fetchUsageHistory } from "../api";
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
import { PageHeader } from "../components/console/PageHeader";
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
      <PageHeader
        title="Usage"
        description="Account-wide inference activity across all linked keys."
        actions={
          <Tabs
            items={RANGE_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 30)}
          />
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <div className="grid gap-2 sm:grid-cols-3">
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
          value={loading ? "…" : formatUsd(totalCost, 2)}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <BarChart
          title="Daily requests"
          labels={buckets.map((bucket) => bucket.date)}
          values={buckets.map((bucket) => bucket.requests)}
          spanDays={days}
        />
        <BarChart
          title="Daily tokens"
          labels={buckets.map((bucket) => bucket.date)}
          values={buckets.map((bucket) => bucket.total_tokens)}
          spanDays={days}
          valueLabel={(value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value))}
        />
      </div>

      <DataTable
        title="Daily breakdown"
        description={`Aggregated usage per UTC day for the last ${days} days.`}
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Date</DataTableTh>
            <DataTableTh>Requests</DataTableTh>
            <DataTableTh>Prompt tokens</DataTableTh>
            <DataTableTh>Completion tokens</DataTableTh>
            <DataTableTh>Cost</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={5}>Loading usage…</DataTableEmpty>
          ) : buckets.length === 0 ? (
            <DataTableEmpty colSpan={5}>
              No usage in this period. Send inference requests to populate charts.
            </DataTableEmpty>
          ) : (
            [...buckets].reverse().map((bucket) => (
              <DataTableRow key={bucket.date}>
                <DataTableCell mono>{bucket.date}</DataTableCell>
                <DataTableCell tabular>{bucket.requests}</DataTableCell>
                <DataTableCell tabular>{formatNumber(bucket.prompt_tokens)}</DataTableCell>
                <DataTableCell tabular>{formatNumber(bucket.completion_tokens)}</DataTableCell>
                <DataTableCell tabular className="text-info">
                  {formatUsd(bucket.cost)}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>
    </div>
  );
}
