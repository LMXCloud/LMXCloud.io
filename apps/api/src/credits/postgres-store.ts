import { getPool } from "../db/pool.js";
import { roundCredits } from "./pricing.js";
import { releaseReservation, settleReservation } from "./reservation.js";
import type { CreditMeta, CreditStore } from "./store.js";

export class PostgresCreditStore implements CreditStore {
  async getBalance(apiKeyId: string): Promise<number> {
    const result = await getPool().query<{ credit_balance: string }>(
      `SELECT credit_balance FROM api_keys WHERE id = $1 AND revoked_at IS NULL`,
      [apiKeyId],
    );
    const row = result.rows[0];
    return row ? Number(row.credit_balance) : 0;
  }

  async getBalances(apiKeyIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    if (apiKeyIds.length === 0) return balances;

    const result = await getPool().query<{ id: string; credit_balance: string }>(
      `SELECT id, credit_balance FROM api_keys WHERE id = ANY($1::uuid[])`,
      [apiKeyIds],
    );
    for (const row of result.rows) {
      balances.set(row.id, Number(row.credit_balance));
    }
    for (const id of apiKeyIds) {
      if (!balances.has(id)) balances.set(id, 0);
    }
    return balances;
  }

  async hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean> {
    const result = await getPool().query<{ ok: boolean }>(
      `SELECT credit_balance >= $2 AS ok
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL`,
      [apiKeyId, roundCredits(minimum)],
    );
    return result.rows[0]?.ok ?? false;
  }

  async deduct(apiKeyId: string, amount: number): Promise<boolean> {
    const cost = roundCredits(amount);
    if (cost <= 0) return true;

    const result = await getPool().query(
      `UPDATE api_keys
       SET credit_balance = credit_balance - $2
       WHERE id = $1 AND revoked_at IS NULL AND credit_balance >= $2
       RETURNING id`,
      [apiKeyId, cost],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async reserve(apiKeyId: string, amount: number): Promise<boolean> {
    return this.deduct(apiKeyId, amount);
  }

  async settleReservation(
    apiKeyId: string,
    reservedAmount: number,
    actualAmount: number,
    meta?: CreditMeta,
  ): Promise<boolean> {
    return settleReservation(this, apiKeyId, reservedAmount, actualAmount, meta);
  }

  async releaseReservation(
    apiKeyId: string,
    reservedAmount: number,
    meta?: CreditMeta,
  ): Promise<void> {
    await releaseReservation(this, apiKeyId, reservedAmount, meta);
  }

  async credit(apiKeyId: string, amount: number, _meta?: unknown): Promise<number> {
    const added = roundCredits(amount);
    if (added <= 0) {
      return this.getBalance(apiKeyId);
    }

    const result = await getPool().query<{ credit_balance: string }>(
      `UPDATE api_keys
       SET credit_balance = credit_balance + $2
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING credit_balance`,
      [apiKeyId, added],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("API key not found");
    }

    return Number(row.credit_balance);
  }
}
