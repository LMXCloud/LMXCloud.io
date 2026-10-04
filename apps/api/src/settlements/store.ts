import { getPool } from "../db/pool.js";
import type { SettlementReceiptPayload } from "../anchors/receipt.js";

export interface InsertSettlementReceipt {
  id: string;
  referenceId: string;
  payer: string;
  payee: string;
  amount: number;
  asset: string;
  createdAt: string;
  payloadJson: string;
  receiptHash: `0x${string}`;
  txHash: string | null;
  chainId: number;
}

export interface StoredSettlementReceipt {
  id: string;
  payload: SettlementReceiptPayload;
  receiptHash: `0x${string}`;
  txHash: string | null;
  chainId: number;
}

export interface SettlementStore {
  insert(input: InsertSettlementReceipt): Promise<void>;
  getById(id: string): Promise<StoredSettlementReceipt | null>;
}

export class PostgresSettlementStore implements SettlementStore {
  async insert(input: InsertSettlementReceipt): Promise<void> {
    await getPool().query(
      `INSERT INTO settlement_receipts (
         id, reference_id, payer_wallet, payee_wallet, amount, asset,
         created_at, payload_json, receipt_hash, tx_hash, chain_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.id,
        input.referenceId,
        input.payer,
        input.payee,
        input.amount,
        input.asset,
        input.createdAt,
        input.payloadJson,
        input.receiptHash,
        input.txHash,
        input.chainId,
      ],
    );
  }

  async getById(id: string): Promise<StoredSettlementReceipt | null> {
    const result = await getPool().query<{
      id: string;
      payload_json: string;
      receipt_hash: string;
      tx_hash: string | null;
      chain_id: number;
    }>(
      `SELECT id, payload_json, receipt_hash, tx_hash, chain_id
       FROM settlement_receipts
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      payload: JSON.parse(row.payload_json) as SettlementReceiptPayload,
      receiptHash: row.receipt_hash as `0x${string}`,
      txHash: row.tx_hash,
      chainId: row.chain_id,
    };
  }
}

export function createSettlementStore(): SettlementStore | null {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresSettlementStore();
}
