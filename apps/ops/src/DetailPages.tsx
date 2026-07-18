import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchOpsMcpEvent,
  fetchOpsPayment,
  fetchOpsUsage,
  resolveOpsKey,
} from "./api";
import {
  displayValue,
  formatLatency,
  formatTime,
  formatTokens,
  formatUsd,
} from "./format";
import { recordPath, type RecordKind } from "./routes";
import type {
  OpsMcpEventDetail,
  OpsPaymentDetail,
  OpsUsageDetail,
} from "./types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-[var(--color-line)]/70 py-2.5 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
        {label}
      </dt>
      <dd className="mt-1 break-all font-mono text-sm text-[var(--color-ink)] sm:mt-0">
        {children}
      </dd>
    </div>
  );
}

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

function RelatedLink({
  kind,
  id,
  label,
}: {
  kind: RecordKind;
  id: string | null | undefined;
  label?: string;
}) {
  if (!id) return <>—</>;
  return (
    <Link
      to={recordPath(kind, id)}
      className="text-[var(--color-accent)] underline-offset-2 hover:underline"
    >
      {label ?? id}
    </Link>
  );
}

function PaymentDetailView({ data }: { data: OpsPaymentDetail }) {
  return (
    <DetailShell
      kind="payment"
      title={data.status}
      subtitle={`${data.model} · ${formatUsd(data.settledAmount ?? data.quotedAmount)}`}
    >
      <Field label="Id">{data.id}</Field>
      <Field label="Status">{data.status}</Field>
      <Field label="Model">{data.model}</Field>
      <Field label="Route">{data.route}</Field>
      <Field label="Payer wallet">{data.payerWallet}</Field>
      <Field label="Quoted">{formatUsd(data.quotedAmount)}</Field>
      <Field label="Settled">
        {data.settledAmount == null ? "—" : formatUsd(data.settledAmount)}
      </Field>
      <Field label="Refunded">{formatUsd(data.refundedAmount)}</Field>
      <Field label="Chain id">{data.chainId}</Field>
      <Field label="Tx hash">{displayValue(data.txHash)}</Field>
      <Field label="Facilitator ref">{displayValue(data.facilitatorRef)}</Field>
      <Field label="Payload hash">{data.paymentPayloadHash}</Field>
      <Field label="Estimated tokens">
        {data.estimatedTokens == null ? "—" : formatTokens(data.estimatedTokens)}
      </Field>
      <Field label="Failure reason">{displayValue(data.failureReason)}</Field>
      <Field label="API key id">{displayValue(data.apiKeyId)}</Field>
      <Field label="Usage event">
        <RelatedLink kind="usage" id={data.usageEventId} />
      </Field>
      <Field label="Created">{formatTime(data.createdAt)}</Field>
      <Field label="Verified">
        {data.verifiedAt ? formatTime(data.verifiedAt) : "—"}
      </Field>
      <Field label="Settled at">
        {data.settledAt ? formatTime(data.settledAt) : "—"}
      </Field>
      <Field label="Completed">
        {data.completedAt ? formatTime(data.completedAt) : "—"}
      </Field>
    </DetailShell>
  );
}

function UsageDetailView({ data }: { data: OpsUsageDetail }) {
  return (
    <DetailShell
      kind="usage"
      title={`${data.provider}/${data.model}`}
      subtitle={`${data.channel} · ${data.success ? "ok" : "failed"} · ${formatTokens(data.totalTokens)} tok · ${formatUsd(data.cost)}`}
    >
      <Field label="Id">{data.id}</Field>
      <Field label="Channel">{data.channel}</Field>
      <Field label="Resource type">{data.resourceType}</Field>
      <Field label="Provider">{data.provider}</Field>
      <Field label="Model">{data.model}</Field>
      <Field label="Success">{displayValue(data.success)}</Field>
      <Field label="Error code">{displayValue(data.errorCode)}</Field>
      <Field label="Unit price">{displayValue(data.unitPrice)}</Field>
      <Field label="Prompt tokens">{formatTokens(data.promptTokens)}</Field>
      <Field label="Completion tokens">
        {formatTokens(data.completionTokens)}
      </Field>
      <Field label="Total tokens">{formatTokens(data.totalTokens)}</Field>
      <Field label="Cost">{formatUsd(data.cost)}</Field>
      <Field label="Latency">{formatLatency(data.latencyMs)}</Field>
      <Field label="Fallback used">{displayValue(data.fallbackUsed)}</Field>
      <Field label="Payer wallet">{displayValue(data.payerWallet)}</Field>
      <Field label="API key id">{displayValue(data.apiKeyId)}</Field>
      <Field label="Payment event">
        <RelatedLink kind="payment" id={data.paymentEventId} />
      </Field>
      <Field label="Created">{formatTime(data.createdAt)}</Field>
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
      <Field label="Id">{data.id}</Field>
      <Field label="Tool">{data.tool}</Field>
      <Field label="Level">{data.level}</Field>
      <Field label="OK">{displayValue(data.ok)}</Field>
      <Field label="Caller id">{data.callerId}</Field>
      <Field label="Auth source">{data.authSource}</Field>
      <Field label="Latency">{formatLatency(data.latencyMs)}</Field>
      <Field label="Detail">{displayValue(data.detail)}</Field>
      <Field label="Timestamp">{formatTime(data.ts)}</Field>
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
