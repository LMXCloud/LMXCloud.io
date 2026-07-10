import { FileJson, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchStatus, fetchUsageLogs } from "../api";
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
import { LogProofPanel } from "../components/console/LogProofPanel";
import { PageHeader } from "../components/console/PageHeader";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatLatency, formatNumber, formatUsd, maskKey } from "../lib/format";
import type { UsageLogEntry } from "../types";

const RANGE_OPTIONS = [
  { days: 7 as const, label: "7 days" },
  { days: 30 as const, label: "30 days" },
];

const PAGE_SIZE = 50;

function statusTone(status: number): "success" | "warning" | "error" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 400 && status < 500) return "warning";
  return "error";
}

export function LogsPage() {
  const { apiKey } = useAuth();
  const [days, setDays] = useState<7 | 30>(7);
  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofLogId, setProofLogId] = useState<string | null>(null);
  const [anchoringEnabled, setAnchoringEnabled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await fetchUsageLogs(apiKey, { limit: PAGE_SIZE, days });
      setLogs(res.data);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [apiKey, days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchStatus()
      .then((status) => setAnchoringEnabled(status.anchoring.enabled))
      .catch(() => setAnchoringEnabled(null));
  }, []);

  async function handleLoadMore() {
    if (!apiKey || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchUsageLogs(apiKey, {
        limit: PAGE_SIZE,
        cursor: nextCursor,
        days,
      });
      setLogs((prev) => [...prev, ...res.data]);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more logs");
    } finally {
      setLoadingMore(false);
    }
  }

  const proofColumnLabel = anchoringEnabled ? "Proof" : "Receipt";
  const proofButtonLabel = anchoringEnabled ? "Verify" : "Receipt";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Monitor"
        title="Request logs"
        description={
          anchoringEnabled
            ? "Individual API calls across all linked keys. Verify on-chain anchored receipts."
            : "Individual API calls across all linked keys. Inspect cryptographic receipts per request."
        }
        actions={
          <Tabs
            items={RANGE_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 30)}
          />
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {anchoringEnabled === false && (
        <AlertBanner tone="info">
          Receipt hashes are recorded for every request. Full on-chain Merkle verification is
          available in local dev (Base Sepolia) — production shows receipt metadata only.
        </AlertBanner>
      )}

      {proofLogId && (
        <LogProofPanel
          logId={proofLogId}
          anchoringEnabled={anchoringEnabled ?? undefined}
          onClose={() => setProofLogId(null)}
        />
      )}

      <DataTable minWidth={1040}>
        <DataTableHead>
          <tr>
            <DataTableTh>Time</DataTableTh>
            <DataTableTh>Route</DataTableTh>
            <DataTableTh>Provider</DataTableTh>
            <DataTableTh>Model</DataTableTh>
            <DataTableTh>Key</DataTableTh>
            <DataTableTh>Tokens</DataTableTh>
            <DataTableTh>Cost</DataTableTh>
            <DataTableTh>Latency</DataTableTh>
            <DataTableTh>Status</DataTableTh>
            <DataTableTh className="text-right">{proofColumnLabel}</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={10}>Loading request logs…</DataTableEmpty>
          ) : logs.length === 0 ? (
            <DataTableEmpty colSpan={10}>
              No requests in this period. Send inference calls to populate logs.
            </DataTableEmpty>
          ) : (
            logs.map((log) => (
              <DataTableRow key={log.id}>
                <DataTableCell mono className="whitespace-nowrap">
                  {formatDateTime(log.created_at)}
                </DataTableCell>
                <DataTableCell mono>{log.route}</DataTableCell>
                <DataTableCell>
                  <Chip tone="info">{log.provider}</Chip>
                </DataTableCell>
                <DataTableCell mono className="max-w-[180px] truncate" title={log.model}>
                  {log.model}
                </DataTableCell>
                <DataTableCell mono title={log.api_key_id}>
                  {maskKey(log.api_key_id)}
                </DataTableCell>
                <DataTableCell mono>
                  {formatNumber(log.total_tokens)}
                  <span className="ml-1 text-on-surface-muted">
                    ({formatNumber(log.prompt_tokens)}+{formatNumber(log.completion_tokens)})
                  </span>
                </DataTableCell>
                <DataTableCell mono className="text-warning">
                  {formatUsd(log.cost)}
                </DataTableCell>
                <DataTableCell mono>{formatLatency(log.latency_ms)}</DataTableCell>
                <DataTableCell>
                  <Chip tone={statusTone(log.status)}>{log.status}</Chip>
                  {log.fallback_used && (
                    <Chip tone="warning" className="ml-1">
                      fallback
                    </Chip>
                  )}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    onClick={() => setProofLogId(log.id)}
                  >
                    {anchoringEnabled ? (
                      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                    ) : (
                      <FileJson className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {proofButtonLabel}
                  </Button>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      {hasMore && !loading && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
