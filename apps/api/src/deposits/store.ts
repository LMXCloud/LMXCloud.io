import { getPool } from "../db/pool.js";
import { roundCredits } from "../credits/pricing.js";

export interface PendingDeposit {
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountUsdc: number;
  blockNumber: bigint;
}

export interface DepositStore {
  getLastScannedBlock(): Promise<bigint>;
  setLastScannedBlock(block: bigint): Promise<void>;
  insertPendingDeposit(deposit: PendingDeposit): Promise<boolean>;
  listPendingDeposits(): Promise<
    Array<PendingDeposit & { confirmations: number }>
  >;
  listDepositsForWallet(
    wallet: string,
    apiKeyId: string,
    limit?: number,
  ): Promise<DepositRecord[]>;
  markCredited(txHash: string, logIndex: number, apiKeyId: string): Promise<void>;
  markUnmatched(txHash: string, logIndex: number): Promise<void>;
  updateConfirmations(
    txHash: string,
    logIndex: number,
    confirmations: number,
  ): Promise<void>;
  /** Atomically credits the API key only if the deposit is still pending. */
  creditPendingDeposit(
    txHash: string,
    logIndex: number,
    apiKeyId: string,
  ): Promise<{ amount: number; balance: number } | null>;
}

export interface DepositRecord {
  txHash: string;
  logIndex: number;
  fromAddress: string;
  amountUsdc: number;
  status: "pending" | "credited" | "unmatched";
  confirmations: number;
  createdAt: string;
  creditedAt: string | null;
}

export class PostgresDepositStore implements DepositStore {
  async getLastScannedBlock(): Promise<bigint> {
    const result = await getPool().query<{ last_scanned_block: string }>(
      `SELECT last_scanned_block FROM deposit_scan_state WHERE id = 'base_usdc'`,
    );
    if (result.rows[0]) {
      return BigInt(result.rows[0].last_scanned_block);
    }
    await getPool().query(
      `INSERT INTO deposit_scan_state (id, last_scanned_block) VALUES ('base_usdc', 0)
       ON CONFLICT (id) DO NOTHING`,
    );
    return 0n;
  }

  async setLastScannedBlock(block: bigint): Promise<void> {
    await getPool().query(
      `INSERT INTO deposit_scan_state (id, last_scanned_block)
       VALUES ('base_usdc', $1)
       ON CONFLICT (id) DO UPDATE SET last_scanned_block = EXCLUDED.last_scanned_block`,
      [block.toString()],
    );
  }

  async insertPendingDeposit(deposit: PendingDeposit): Promise<boolean> {
    const result = await getPool().query(
      `INSERT INTO usdc_deposits (
         tx_hash, log_index, from_address, to_address, amount_usdc, block_number, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING tx_hash`,
      [
        deposit.txHash,
        deposit.logIndex,
        deposit.fromAddress.toLowerCase(),
        deposit.toAddress.toLowerCase(),
        deposit.amountUsdc,
        deposit.blockNumber.toString(),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listPendingDeposits(): Promise<
    Array<PendingDeposit & { confirmations: number }>
  > {
    const result = await getPool().query<{
      tx_hash: string;
      log_index: number;
      from_address: string;
      to_address: string;
      amount_usdc: string;
      block_number: string;
      confirmations: number;
    }>(
      `SELECT tx_hash, log_index, from_address, to_address, amount_usdc, block_number, confirmations
       FROM usdc_deposits
       WHERE status = 'pending'
       ORDER BY block_number ASC`,
    );

    return result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      amountUsdc: Number(row.amount_usdc),
      blockNumber: BigInt(row.block_number),
      confirmations: row.confirmations,
    }));
  }

  async listDepositsForWallet(
    wallet: string,
    apiKeyId: string,
    limit = 50,
  ): Promise<DepositRecord[]> {
    const result = await getPool().query<{
      tx_hash: string;
      log_index: number;
      from_address: string;
      amount_usdc: string;
      status: "pending" | "credited" | "unmatched";
      confirmations: number;
      created_at: Date;
      credited_at: Date | null;
    }>(
      `SELECT tx_hash, log_index, from_address, amount_usdc, status, confirmations,
              created_at, credited_at
       FROM usdc_deposits
       WHERE from_address = $1 OR api_key_id = $2::uuid
       ORDER BY COALESCE(credited_at, created_at) DESC
       LIMIT $3`,
      [wallet.toLowerCase(), apiKeyId, limit],
    );

    return result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      fromAddress: row.from_address,
      amountUsdc: Number(row.amount_usdc),
      status: row.status,
      confirmations: row.confirmations,
      createdAt: row.created_at.toISOString(),
      creditedAt: row.credited_at?.toISOString() ?? null,
    }));
  }

  async markCredited(
    txHash: string,
    logIndex: number,
    apiKeyId: string,
  ): Promise<void> {
    await getPool().query(
      `UPDATE usdc_deposits
       SET status = 'credited', api_key_id = $3, credited_at = NOW()
       WHERE tx_hash = $1 AND log_index = $2`,
      [txHash, logIndex, apiKeyId],
    );
  }

  async markUnmatched(txHash: string, logIndex: number): Promise<void> {
    await getPool().query(
      `UPDATE usdc_deposits SET status = 'unmatched'
       WHERE tx_hash = $1 AND log_index = $2`,
      [txHash, logIndex],
    );
  }

  async updateConfirmations(
    txHash: string,
    logIndex: number,
    confirmations: number,
  ): Promise<void> {
    await getPool().query(
      `UPDATE usdc_deposits SET confirmations = $3
       WHERE tx_hash = $1 AND log_index = $2 AND status = 'pending'`,
      [txHash, logIndex, confirmations],
    );
  }

  async creditPendingDeposit(
    txHash: string,
    logIndex: number,
    apiKeyId: string,
  ): Promise<{ amount: number; balance: number } | null> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");

      const pending = await client.query<{ amount_usdc: string }>(
        `UPDATE usdc_deposits
         SET status = 'credited', api_key_id = $3, credited_at = NOW()
         WHERE tx_hash = $1 AND log_index = $2 AND status = 'pending'
         RETURNING amount_usdc`,
        [txHash, logIndex, apiKeyId],
      );

      if ((pending.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const amount = roundCredits(Number(pending.rows[0]!.amount_usdc));
      const credited = await client.query<{ credit_balance: string }>(
        `UPDATE api_keys
         SET credit_balance = credit_balance + $2
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING credit_balance`,
        [apiKeyId, amount],
      );

      if ((credited.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        throw new Error(`API key not found while crediting deposit ${txHash}`);
      }

      await client.query("COMMIT");
      return {
        amount,
        balance: Number(credited.rows[0]!.credit_balance),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export function createDepositStore(): DepositStore | null {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresDepositStore();
}
