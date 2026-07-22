import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchOpsMcpEvent,
  fetchOpsPayment,
  fetchOpsUsage,
  resolveOpsKey,
} from "./api";
import { formatUsd } from "./format";
import {
  Field,
  HealthFields,
  McpFields,
  PaymentFields,
  UsageFields,
} from "./RecordViews";
import { recordPath, type RecordKind } from "./routes";
import type {
  OpsMcpEventDetail,
  OpsPaymentDetail,
  OpsUsageDetail,
} from "./types";

function DetailShell({
  kind,
  title,
  subtitle,
  children,
}: {
  kind: RecordKind;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4">
        <Link
          to="/"
          className="text-xs text-[var(--color-faint)] underline-offset-2 hover:text-[var(--color-muted)] hover:underline"
        >
          ← Back to overview
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
            {kind}
          </span>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        </div>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
        <dl>{children}</dl>
      </section>
    </div>
  );
}

function LoadingState() {
  return <p className="text-sm text-[var(--color-muted)]">Loading record…</p>;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded border border-[var(--color-danger)]/40 bg-[rgba(232,93,108,0.1)] px-3 py-2 text-sm text-[var(--color-danger)]">
      {message}
    </div>
  );
}

function PaymentDetailView({ data }: { data: OpsPaymentDetail }) {
  return (
    <DetailShell
      kind="payment"
      title={data.status}
      subtitle={`${data.model} · ${formatUsd(data.settledAmount ?? data.quotedAmount)}`}
    >
      <PaymentFields data={data} />
    </DetailShell>
  );
}

function UsageDetailView({ data }: { data: OpsUsageDetail }) {
  return (
    <DetailShell
      kind="usage"
      title={`${data.provider}/${data.model}`}
      subtitle={`${data.channel} · ${data.success ? "ok" : "failed"}`}
    >
      <UsageFields data={data} />
    </DetailShell>
  );
}

function McpDetailView({ data }: { data: OpsMcpEventDetail }) {
  return (
    <DetailShell
      kind="mcp"
      title={data.tool}
      subtitle={`${data.ok ? "ok" : "error"} · ${data.authSource} · in-memory buffer`}
    >
      <McpFields data={data} />
    </DetailShell>
  );
}

function useOpsKey(): string {
  return resolveOpsKey();
}

export function PaymentDetailPage() {
  const { id = "" } = useParams();
  const opsKey = useOpsKey();
  const [data, setData] = useState<OpsPaymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    if (!opsKey) {
      setError("Enter your ops API key on the overview to load records.");
      setLoading(false);
      return;
    }
    if (!id) {
      setError("Missing payment id.");
      setLoading(false);
      return;
    }

    void fetchOpsPayment(opsKey, id)
      .then((record) => {
        if (!cancelled) setData(record);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load payment");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, opsKey]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Payment not found" />;
  return <PaymentDetailView data={data} />;
}

export function UsageDetailPage() {
  const { id = "" } = useParams();
  const opsKey = useOpsKey();
  const [data, setData] = useState<OpsUsageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    if (!opsKey) {
      setError("Enter your ops API key on the overview to load records.");
      setLoading(false);
      return;
    }
    if (!id) {
      setError("Missing usage id.");
      setLoading(false);
      return;
    }

    void fetchOpsUsage(opsKey, id)
      .then((record) => {
        if (!cancelled) setData(record);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load usage event");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, opsKey]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Usage event not found" />;
  return <UsageDetailView data={data} />;
}

export function McpDetailPage() {
  const { id = "" } = useParams();
  const opsKey = useOpsKey();
  const [data, setData] = useState<OpsMcpEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    if (!opsKey) {
      setError("Enter your ops API key on the overview to load records.");
      setLoading(false);
      return;
    }
    if (!id) {
      setError("Missing MCP event id.");
      setLoading(false);
      return;
    }

    void fetchOpsMcpEvent(opsKey, id)
      .then((record) => {
        if (!cancelled) setData(record);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load MCP event");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, opsKey]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="MCP event not found" />;
  return <McpDetailView data={data} />;
}
