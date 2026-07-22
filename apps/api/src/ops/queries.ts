import { getPool } from "../db/pool.js";
import type { PaymentEvent, PaymentEventStatus } from "../payments/types.js";
import type { ReliabilityTelemetry } from "../telemetry/types.js";

export type OpsChannel = "x402" | "balance" | "mcp";

export type OpsPaymentRow = PaymentEvent & {
  channel: "x402";
};

export type OpsUsageDayBucket = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
};

export type OpsUsageSummary = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
  uniquePayers: number;
  uniqueApiKeys: number;
};

export type OpsRecentUsage = {
  id: string;
  channel: OpsChannel;
  provider: string;
  model: string;
  resourceType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  success: boolean;
  errorCode: string | null;
  unitPrice: number | null;
  payerWallet: string | null;
  apiKeyId: string | null;
  paymentEventId: string | null;
  createdAt: string;
};

export type OpsRecentSignup = {
  id: string;
  email: string | null;
  wallet: string | null;
  createdAt: string;
  creditBalance: number;
};

export type OpsCreditEvent = {
  id: string;
  apiKeyId: string;
  amount: number;
  balanceAfter: number | null;
  source: "usdc_deposit" | "unknown";
  txHash: string | null;
  wallet: string | null;
  creditedAt: string;
};

interface PaymentEventRow {
  id: string;
  usage_event_id: string | null;
  api_key_id: string | null;
  payer_wallet: string;
  quoted_amount: string;
  settled_amount: string | null;
  refunded_amount: string;
  chain_id: number;
  tx_hash: string | null;
  payment_payload_hash: string;
  facilitator_ref: string | null;
  model: string;
  route: string;
  estimated_tokens: number | null;
  status: PaymentEventStatus;
  failure_reason: string | null;
  created_at: Date;
  verified_at: Date | null;
  settled_at: Date | null;
  completed_at: Date | null;
}

function mapPayment(row: PaymentEventRow): OpsPaymentRow {
  return {
    id: row.id,
    usageEventId: row.usage_event_id,
    apiKeyId: row.api_key_id,
    payerWallet: row.payer_wallet,
    quotedAmount: Number(row.quoted_amount),
    settledAmount: row.settled_amount === null ? null : Number(row.settled_amount),
    refundedAmount: Number(row.refunded_amount),
    chainId: row.chain_id,
    txHash: row.tx_hash,
    paymentPayloadHash: row.payment_payload_hash,
    facilitatorRef: row.facilitator_ref,
    model: row.model,
    route: row.route,
    estimatedTokens: row.estimated_tokens,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    verifiedAt: row.verified_at?.toISOString() ?? null,
    settledAt: row.settled_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    channel: "x402",
  };
}

export function hasPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function listRecentPayments(limit = 40): Promise<OpsPaymentRow[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<PaymentEventRow>(
    `SELECT *
     FROM payment_events
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows.map(mapPayment);
}

export async function getPaymentById(id: string): Promise<OpsPaymentRow | null> {
  if (!hasPostgres()) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  const result = await getPool().query<PaymentEventRow>(
    `SELECT * FROM payment_events WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapPayment(row) : null;
}

export async function listUsageHistory(days = 7): Promise<OpsUsageDayBucket[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<{
    date: string;
    requests: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    cost: string;
    fallback_count: string;
    avg_latency_ms: string | null;
  }>(
    `SELECT
       TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
       COUNT(*)::text AS requests,
       COALESCE(SUM(prompt_tokens), 0)::text AS prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::text AS completion_tokens,
       COALESCE(SUM(total_tokens), 0)::text AS total_tokens,
       COALESCE(SUM(cost), 0)::text AS cost,
       COUNT(*) FILTER (WHERE fallback_used)::text AS fallback_count,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       AND success = true
     GROUP BY DATE(created_at AT TIME ZONE 'UTC')
     ORDER BY date`,
    [Math.max(1, Math.min(days, 90))],
  );

  return result.rows.map((row) => ({
    date: row.date,
    requests: Number(row.requests),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    totalTokens: Number(row.total_tokens),
    cost: Number(row.cost),
    fallbackCount: Number(row.fallback_count),
    avgLatencyMs: row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
  }));
}

export async function getUsageSummary(days = 7): Promise<OpsUsageSummary> {
  if (!hasPostgres()) {
    return {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      fallbackCount: 0,
      avgLatencyMs: null,
      uniquePayers: 0,
      uniqueApiKeys: 0,
    };
  }

  const result = await getPool().query<{
    requests: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    cost: string;
    fallback_count: string;
    avg_latency_ms: string | null;
    unique_payers: string;
    unique_api_keys: string;
  }>(
    `SELECT
       COUNT(*)::text AS requests,
       COALESCE(SUM(prompt_tokens), 0)::text AS prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::text AS completion_tokens,
       COALESCE(SUM(total_tokens), 0)::text AS total_tokens,
       COALESCE(SUM(cost), 0)::text AS cost,
       COUNT(*) FILTER (WHERE fallback_used)::text AS fallback_count,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       COUNT(DISTINCT payer_wallet)::text AS unique_payers,
       COUNT(DISTINCT api_key_id)::text AS unique_api_keys
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       AND success = true`,
    [Math.max(1, Math.min(days, 90))],
  );

  const row = result.rows[0]!;
  return {
    requests: Number(row.requests),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    totalTokens: Number(row.total_tokens),
    cost: Number(row.cost),
    fallbackCount: Number(row.fallback_count),
    avgLatencyMs: row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
    uniquePayers: Number(row.unique_payers),
    uniqueApiKeys: Number(row.unique_api_keys),
  };
}

export async function listRecentSignups(limit = 40): Promise<OpsRecentSignup[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<{
    id: string;
    email: string | null;
    wallet: string | null;
    created_at: Date;
    credit_balance: string;
  }>(
    `SELECT id, email, wallet, created_at, credit_balance
     FROM api_keys
     WHERE revoked_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    wallet: row.wallet,
    createdAt: row.created_at.toISOString(),
    creditBalance: Number(row.credit_balance),
  }));
}

export async function listRecentCreditEvents(limit = 40): Promise<OpsCreditEvent[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<{
    tx_hash: string;
    api_key_id: string;
    from_address: string;
    amount_usdc: string;
    credited_at: Date;
    credit_balance: string | null;
  }>(
    `SELECT
       d.tx_hash,
       d.api_key_id,
       d.from_address,
       d.amount_usdc,
       d.credited_at,
       k.credit_balance
     FROM usdc_deposits d
     LEFT JOIN api_keys k ON k.id = d.api_key_id
     WHERE d.status = 'credited' AND d.credited_at IS NOT NULL
     ORDER BY d.credited_at DESC, d.tx_hash DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );

  return result.rows.map((row) => ({
    id: `${row.tx_hash}:${row.api_key_id}`,
    apiKeyId: row.api_key_id,
    amount: Number(row.amount_usdc),
    balanceAfter: row.credit_balance === null ? null : Number(row.credit_balance),
    source: "usdc_deposit" as const,
    txHash: row.tx_hash,
    wallet: row.from_address,
    creditedAt: row.credited_at.toISOString(),
  }));
}

export async function listRecentUsage(limit = 40): Promise<OpsRecentUsage[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<{
    id: string;
    provider: string;
    model: string;
    resource_type: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: string;
    latency_ms: number | null;
    fallback_used: boolean;
    success: boolean;
    error_code: string | null;
    unit_price: string | null;
    payer_wallet: string | null;
    api_key_id: string | null;
    payment_event_id: string | null;
    created_at: Date;
  }>(
    `SELECT
       id, provider, model, resource_type, prompt_tokens, completion_tokens, total_tokens,
       cost, latency_ms, fallback_used, success, error_code, unit_price,
       payer_wallet, api_key_id, payment_event_id, created_at
     FROM usage_events
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );

  return result.rows.map((row) => ({
    id: row.id,
    channel: row.payment_event_id ? "x402" : "balance",
    provider: row.provider,
    model: row.model,
    resourceType: row.resource_type,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cost: Number(row.cost),
    latencyMs: row.latency_ms ?? 0,
    fallbackUsed: row.fallback_used,
    success: row.success,
    errorCode: row.error_code,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    payerWallet: row.payer_wallet,
    apiKeyId: row.api_key_id,
    paymentEventId: row.payment_event_id,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getUsageById(id: string): Promise<OpsRecentUsage | null> {
  if (!hasPostgres()) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  const result = await getPool().query<{
    id: string;
    provider: string;
    model: string;
    resource_type: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: string;
    latency_ms: number | null;
    fallback_used: boolean;
    success: boolean;
    error_code: string | null;
    unit_price: string | null;
    payer_wallet: string | null;
    api_key_id: string | null;
    payment_event_id: string | null;
    created_at: Date;
  }>(
    `SELECT
       id, provider, model, resource_type, prompt_tokens, completion_tokens, total_tokens,
       cost, latency_ms, fallback_used, success, error_code, unit_price,
       payer_wallet, api_key_id, payment_event_id, created_at
     FROM usage_events
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    channel: row.payment_event_id ? "x402" : "balance",
    provider: row.provider,
    model: row.model,
    resourceType: row.resource_type,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cost: Number(row.cost),
    latencyMs: row.latency_ms ?? 0,
    fallbackUsed: row.fallback_used,
    success: row.success,
    errorCode: row.error_code,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    payerWallet: row.payer_wallet,
    apiKeyId: row.api_key_id,
    paymentEventId: row.payment_event_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function paymentStatusCounts(days = 7): Promise<Record<string, number>> {
  if (!hasPostgres()) return {};

  const result = await getPool().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM payment_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
     GROUP BY status`,
    [Math.max(1, Math.min(days, 90))],
  );

  return Object.fromEntries(
    result.rows.map((row) => [row.status, Number(row.count)]),
  );
}

export type StuckPaymentDetail = OpsPaymentRow & {
  ageMinutes: number;
};

/** @deprecated alias — stuck rows now include full payment fields */
export type StuckPaymentSummary = StuckPaymentDetail;

export async function listStuckPayments(
  olderThanMinutes = 15,
  limit = 20,
): Promise<StuckPaymentDetail[]> {
  if (!hasPostgres()) return [];

  const result = await getPool().query<
    PaymentEventRow & { age_minutes: string }
  >(
    `SELECT
       payment_events.*,
       ROUND(EXTRACT(EPOCH FROM (NOW() - payment_events.created_at)) / 60)::text AS age_minutes
     FROM payment_events
     WHERE status IN ('quoted', 'verified', 'fulfilling')
       AND created_at < NOW() - ($1::int || ' minutes')::interval
     ORDER BY created_at ASC
     LIMIT $2`,
    [Math.max(1, olderThanMinutes), Math.max(1, Math.min(limit, 100))],
  );

  return result.rows.map((row) => ({
    ...mapPayment(row),
    ageMinutes: Number(row.age_minutes),
  }));
}

function rate(successes: number, attempts: number): number {
  if (attempts === 0) return 0;
  return Math.round((successes / attempts) * 10_000) / 10_000;
}

/**
 * Time-series reliability telemetry from usage_events (success + failure attempts).
 * Resource-type agnostic — filter with resourceType or leave null for all types.
 */
export async function getReliabilityTelemetry(
  days = 7,
  resourceType?: string | null,
): Promise<ReliabilityTelemetry> {
  const windowDays = Math.max(1, Math.min(days, 90));
  const empty: ReliabilityTelemetry = {
    object: "reliability_telemetry",
    windowDays,
    resourceType: resourceType ?? null,
    overall: {
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      avgLatencyMs: null,
      avgUnitPrice: null,
    },
    byProvider: [],
    series: [],
  };

  if (!hasPostgres()) return empty;

  const params: unknown[] = [windowDays];
  const typeFilter =
    resourceType && resourceType.trim()
      ? (() => {
          params.push(resourceType.trim());
          return `AND resource_type = $${params.length}`;
        })()
      : "";

  const overallResult = await getPool().query<{
    attempts: string;
    successes: string;
    failures: string;
    avg_latency_ms: string | null;
    avg_unit_price: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS attempts,
       COUNT(*) FILTER (WHERE success)::text AS successes,
       COUNT(*) FILTER (WHERE NOT success)::text AS failures,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       AVG(unit_price)::text AS avg_unit_price
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       ${typeFilter}`,
    params,
  );

  const overallRow = overallResult.rows[0]!;
  const attempts = Number(overallRow.attempts);
  const successes = Number(overallRow.successes);
  const failures = Number(overallRow.failures);

  const byProviderResult = await getPool().query<{
    resource_type: string;
    provider: string;
    attempts: string;
    successes: string;
    failures: string;
    avg_latency_ms: string | null;
    avg_unit_price: string | null;
  }>(
    `SELECT
       resource_type,
       provider,
       COUNT(*)::text AS attempts,
       COUNT(*) FILTER (WHERE success)::text AS successes,
       COUNT(*) FILTER (WHERE NOT success)::text AS failures,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       AVG(unit_price)::text AS avg_unit_price
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       ${typeFilter}
     GROUP BY resource_type, provider
     ORDER BY resource_type, provider`,
    params,
  );

  const seriesResult = await getPool().query<{
    date: string;
    resource_type: string;
    provider: string;
    model: string;
    attempts: string;
    successes: string;
    failures: string;
    avg_latency_ms: string | null;
    avg_unit_price: string | null;
    avg_cost: string | null;
  }>(
    `SELECT
       TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
       resource_type,
       provider,
       model,
       COUNT(*)::text AS attempts,
       COUNT(*) FILTER (WHERE success)::text AS successes,
       COUNT(*) FILTER (WHERE NOT success)::text AS failures,
       ROUND(AVG(latency_ms))::text AS avg_latency_ms,
       AVG(unit_price)::text AS avg_unit_price,
       AVG(cost) FILTER (WHERE success)::text AS avg_cost
     FROM usage_events
     WHERE created_at >= NOW() - ($1::int || ' days')::interval
       ${typeFilter}
     GROUP BY DATE(created_at AT TIME ZONE 'UTC'), resource_type, provider, model
     ORDER BY date, resource_type, provider, model`,
    params,
  );

  return {
    object: "reliability_telemetry",
    windowDays,
    resourceType: resourceType ?? null,
    overall: {
      attempts,
      successes,
      failures,
      successRate: rate(successes, attempts),
      avgLatencyMs:
        overallRow.avg_latency_ms === null ? null : Number(overallRow.avg_latency_ms),
      avgUnitPrice:
        overallRow.avg_unit_price === null ? null : Number(overallRow.avg_unit_price),
    },
    byProvider: byProviderResult.rows.map((row) => {
      const pAttempts = Number(row.attempts);
      const pSuccesses = Number(row.successes);
      return {
        resourceType: row.resource_type,
        provider: row.provider,
        attempts: pAttempts,
        successes: pSuccesses,
        failures: Number(row.failures),
        successRate: rate(pSuccesses, pAttempts),
        avgLatencyMs: row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
        avgUnitPrice: row.avg_unit_price === null ? null : Number(row.avg_unit_price),
      };
    }),
    series: seriesResult.rows.map((row) => {
      const sAttempts = Number(row.attempts);
      const sSuccesses = Number(row.successes);
      return {
        date: row.date,
        resourceType: row.resource_type,
        provider: row.provider,
        model: row.model,
        attempts: sAttempts,
        successes: sSuccesses,
        failures: Number(row.failures),
        successRate: rate(sSuccesses, sAttempts),
        avgLatencyMs: row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
        avgUnitPrice: row.avg_unit_price === null ? null : Number(row.avg_unit_price),
        avgCost: row.avg_cost === null ? null : Number(row.avg_cost),
      };
    }),
  };
}

