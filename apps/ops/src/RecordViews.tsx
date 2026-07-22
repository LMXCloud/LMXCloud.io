import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  displayValue,
  formatLatency,
  formatTime,
  formatTokens,
  formatUsd,
} from "./format";
import { recordPath, type RecordKind } from "./routes";
import type {
  OpsPayment,
  OpsIrregularityHealthRecord,
  OpsMcpEvent,
  OpsPaymentRecord,
  OpsUsageDetail,
} from "./types";

export function Field({ label, children }: { label: string; children: ReactNode }) {
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

export function RelatedLink({
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

export function PaymentFields({
  data,
  ageMinutes,
}: {
  data: OpsPaymentRecord | OpsPayment;
  ageMinutes?: number;
}) {
  return (
    <>
      {ageMinutes != null ? (
        <Field label="Age stuck">{`${ageMinutes}m`}</Field>
      ) : null}
      <Field label="Id">{data.id}</Field>
      <Field label="Status">{data.status}</Field>
      <Field label="Model">{data.model}</Field>
      <Field label="Route">{data.route}</Field>
      <Field label="Payer wallet">{data.payerWallet}</Field>
      <Field label="Quoted">{formatUsd(data.quotedAmount)}</Field>
      <Field label="Settled">
        {data.settledAmount == null ? "—" : formatUsd(data.settledAmount)}
      </Field>
      <Field label="Refunded">
        {formatUsd("refundedAmount" in data ? (data.refundedAmount ?? 0) : 0)}
      </Field>
      <Field label="Chain id">{data.chainId}</Field>
      <Field label="Tx hash">{displayValue(data.txHash)}</Field>
      <Field label="Facilitator ref">
        {displayValue("facilitatorRef" in data ? data.facilitatorRef : null)}
      </Field>
      <Field label="Payload hash">
        {"paymentPayloadHash" in data ? data.paymentPayloadHash : "—"}
      </Field>
      <Field label="Estimated tokens">
        {"estimatedTokens" in data && data.estimatedTokens != null
          ? formatTokens(data.estimatedTokens)
          : "—"}
      </Field>
      <Field label="Failure reason">
        {displayValue("failureReason" in data ? data.failureReason : null)}
      </Field>
      <Field label="API key id">
        {displayValue("apiKeyId" in data ? data.apiKeyId : null)}
      </Field>
      <Field label="Usage event">
        <RelatedLink
          kind="usage"
          id={"usageEventId" in data ? data.usageEventId : null}
        />
      </Field>
      <Field label="Created">{formatTime(data.createdAt)}</Field>
      <Field label="Verified">
        {"verifiedAt" in data && data.verifiedAt
          ? formatTime(data.verifiedAt)
          : "—"}
      </Field>
      <Field label="Settled at">
        {"settledAt" in data && data.settledAt ? formatTime(data.settledAt) : "—"}
      </Field>
      <Field label="Completed">
        {"completedAt" in data && data.completedAt
          ? formatTime(data.completedAt)
          : "—"}
      </Field>
    </>
  );
}

export function UsageFields({ data }: { data: OpsUsageDetail }) {
  return (
    <>
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
    </>
  );
}

export function HealthFields({ data }: { data: OpsIrregularityHealthRecord }) {
  return (
    <>
      <Field label="Provider">{data.name}</Field>
      <Field label="Healthy">{displayValue(data.healthy)}</Field>
      {data.checkUrl ? <Field label="Gateway probe">{`GET ${data.checkUrl}`}</Field> : null}
      {data.statusCode != null ? (
        <Field label="HTTP status">{String(data.statusCode)}</Field>
      ) : null}
      {data.errorDetail ? (
        <Field label="Upstream response">{data.errorDetail}</Field>
      ) : null}
      {data.latencyMs != null ? (
        <Field label="Probe latency">{formatLatency(data.latencyMs)}</Field>
      ) : null}
      {data.lastCheck ? (
        <Field label="Last checked">{formatTime(new Date(data.lastCheck).toISOString())}</Field>
      ) : null}
      {data.lastHealthyAt ? (
        <Field label="Last healthy">{formatTime(data.lastHealthyAt)}</Field>
      ) : null}
      {data.likelyCause ? <Field label="Likely cause">{data.likelyCause}</Field> : null}
    </>
  );
}

export function McpFields({ data }: { data: OpsMcpEvent }) {
  return (
    <>
      <Field label="Id">{data.id}</Field>
      <Field label="Tool">{data.tool}</Field>
      <Field label="Level">{data.level}</Field>
      <Field label="OK">{displayValue(data.ok)}</Field>
      <Field label="Caller id">{data.callerId}</Field>
      <Field label="Auth source">{data.authSource}</Field>
      <Field label="Latency">{formatLatency(data.latencyMs)}</Field>
      <Field label="Detail">{displayValue(data.detail)}</Field>
      <Field label="Timestamp">{formatTime(data.ts)}</Field>
    </>
  );
}
