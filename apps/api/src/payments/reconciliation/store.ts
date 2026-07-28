import { getPool } from "../../db/pool.js";
import { roundCredits } from "../../credits/pricing.js";
import type {
  CreateReconciliationInput,
  ReconciliationEvent,
  ReconciliationStatus,
} from "./types.js";

interface ReconciliationRow {
  id: string;
  kind: string;
  payment_event_id: string | null;
  api_key_id: string | null;
  usage_event_id: string | null;
  amount: string;
  status: string;
  reason: string;
  failure_detail: string | null;
  refund_tx_hash: string | null;
  idempotency_key: string;
  created_at: Date;
  completed_at: Date | null;
}

function mapRow(row: ReconciliationRow): ReconciliationEvent {
  return {
    id: row.id,
    kind: row.kind as ReconciliationEvent["kind"],
    paymentEventId: row.payment_event_id,
    apiKeyId: row.api_key_id,
    usageEventId: row.usage_event_id,
    amount: Number(row.amount),
    status: row.status as ReconciliationStatus,
    reason: row.reason,
    failureDetail: row.failure_detail,
    refundTxHash: row.refund_tx_hash,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export interface ReconciliationStore {
  findByIdempotencyKey(key: string): Promise<ReconciliationEvent | null>;
  findById(id: string): Promise<ReconciliationEvent | null>;
  create(input: CreateReconciliationInput): Promise<ReconciliationEvent>;
  updateStatus(
    id: string,
    status: ReconciliationStatus,
    fields?: { refundTxHash?: string; failureDetail?: string },
  ): Promise<ReconciliationEvent | null>;
  listPendingManual(limit?: number): Promise<ReconciliationEvent[]>;
  listRecent(limit?: number): Promise<ReconciliationEvent[]>;
}

export class PostgresReconciliationStore implements ReconciliationStore {
  async findByIdempotencyKey(key: string): Promise<ReconciliationEvent | null> {
    const result = await getPool().query<ReconciliationRow>(
      `SELECT * FROM reconciliation_events WHERE idempotency_key = $1`,
      [key],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<ReconciliationEvent | null> {
    const result = await getPool().query<ReconciliationRow>(
      `SELECT * FROM reconciliation_events WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async create(input: CreateReconciliationInput): Promise<ReconciliationEvent> {
    const result = await getPool().query<ReconciliationRow>(
      `INSERT INTO reconciliation_events (
         kind, payment_event_id, api_key_id, usage_event_id,
         amount, status, reason, failure_detail, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.kind,
        input.paymentEventId ?? null,
        input.apiKeyId ?? null,
        input.usageEventId ?? null,
        roundCredits(input.amount),
        input.status ?? "pending",
        input.reason,
        input.failureDetail ?? null,
        input.idempotencyKey,
      ],
    );

    if (result.rows[0]) {
      return mapRow(result.rows[0]);
    }

    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (!existing) {
      throw new Error("Failed to create reconciliation event");
    }
    return existing;
  }

  async updateStatus(
    id: string,
    status: ReconciliationStatus,
    fields?: { refundTxHash?: string; failureDetail?: string },
  ): Promise<ReconciliationEvent | null> {
    const result = await getPool().query<ReconciliationRow>(
      `UPDATE reconciliation_events
       SET status = $2,
           refund_tx_hash = COALESCE($3, refund_tx_hash),
           failure_detail = COALESCE($4, failure_detail),
           completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        fields?.refundTxHash ?? null,
        fields?.failureDetail ?? null,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listPendingManual(limit = 20): Promise<ReconciliationEvent[]> {
    const result = await getPool().query<ReconciliationRow>(
      `SELECT * FROM reconciliation_events
       WHERE status = 'manual_required'
       ORDER BY created_at ASC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map(mapRow);
  }

  async listRecent(limit = 40): Promise<ReconciliationEvent[]> {
    const result = await getPool().query<ReconciliationRow>(
      `SELECT * FROM reconciliation_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map(mapRow);
  }
}

export function createReconciliationStore(): ReconciliationStore | null {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresReconciliationStore();
}
