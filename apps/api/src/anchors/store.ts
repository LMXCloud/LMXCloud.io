import type { PoolClient } from "pg";
import { getAddress } from "viem";
import { getPool } from "../db/pool.js";
import { parseSettlementProofKey } from "./lookup.js";
import { buildReceiptMerkleTree } from "./merkle.js";
import {
  buildSettlementReceiptProof,
  buildUsageLogProof,
  type SettlementReceiptProofResult,
  type UsageLogProofResult,
} from "./proof.js";

export type AnchorBatchStatus = "submitting" | "anchored" | "failed";

export interface AnchorBatchRecord {
  id: string;
  merkleRoot: `0x${string}`;
  eventCount: number;
  status: AnchorBatchStatus;
  txHash: string | null;
  blockNumber: bigint | null;
  chainId: number;
  contractAddress: `0x${string}` | null;
  createdAt: string;
  anchoredAt: string | null;
}

export interface ClaimedBatchLeaf {
  eventId: string;
  receiptHash: `0x${string}`;
  leafIndex: number;
}

export interface ClaimedBatch {
  batchId: string;
  merkleRoot: `0x${string}`;
  leaves: ClaimedBatchLeaf[];
}

export interface AnchorStore {
  countUnanchoredEvents(): Promise<number>;
  claimEventsForBatch(maxEvents: number, chainId: number): Promise<ClaimedBatch | null>;
  listPendingBatches(): Promise<AnchorBatchRecord[]>;
  markBatchAnchored(
    batchId: string,
    txHash: string,
    blockNumber: bigint,
    contractAddress: `0x${string}`,
  ): Promise<void>;
  recordBatchContractAddress(
    txHash: string,
    contractAddress: `0x${string}`,
  ): Promise<void>;
  markBatchFailed(batchId: string): Promise<void>;
  listRecentAnchoredBatches(limit: number): Promise<AnchorBatchRecord[]>;
  getLogProof(
    logId: string,
    apiKeyIds: string[] | null,
    contractAddress: `0x${string}`,
  ): Promise<UsageLogProofResult | null>;
  /** Settlement UUID or `0x` receipt hash. */
  getSettlementProof(
    settlementIdOrHash: string,
  ): Promise<SettlementReceiptProofResult | null>;
}

export class PostgresAnchorStore implements AnchorStore {
  async countUnanchoredEvents(): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM usage_events
          WHERE receipt_hash IS NOT NULL AND anchor_batch_id IS NULL)
         +
         (SELECT COUNT(*) FROM settlement_receipts
          WHERE receipt_hash IS NOT NULL AND anchor_batch_id IS NULL)
       )::text AS count`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async claimEventsForBatch(
    maxEvents: number,
    chainId: number,
  ): Promise<ClaimedBatch | null> {
    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const selected = await lockUnanchoredReceipts(client, maxEvents);

      if (selected.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const receiptHashes = selected.map((row) => row.receiptHash);
      const { root } = buildReceiptMerkleTree(receiptHashes);

      const batch = await client.query<{ id: string }>(
        `INSERT INTO anchor_batches (merkle_root, event_count, status, chain_id)
         VALUES ($1, $2, 'submitting', $3)
         RETURNING id`,
        [root, selected.length, chainId],
      );

      const batchId = batch.rows[0]!.id;
      const leaves: ClaimedBatchLeaf[] = [];

      for (let index = 0; index < selected.length; index++) {
        const row = selected[index]!;
        const table = row.source === "usage" ? "usage_events" : "settlement_receipts";
        await client.query(
          `UPDATE ${table}
           SET anchor_batch_id = $2, leaf_index = $3
           WHERE id = $1`,
          [row.id, batchId, index],
        );
        leaves.push({
          eventId: row.id,
          receiptHash: row.receiptHash,
          leafIndex: index,
        });
      }

      await client.query("COMMIT");

      return {
        batchId,
        merkleRoot: root,
        leaves,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listPendingBatches(): Promise<AnchorBatchRecord[]> {
    const result = await getPool().query<{
      id: string;
      merkle_root: string;
      event_count: number;
      status: AnchorBatchStatus;
      tx_hash: string | null;
      block_number: string | null;
      chain_id: number;
      contract_address: string | null;
      created_at: Date;
      anchored_at: Date | null;
    }>(
      `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
              chain_id, contract_address, created_at, anchored_at
       FROM anchor_batches
       WHERE status IN ('submitting', 'failed')
       ORDER BY created_at ASC`,
    );

    return result.rows.map(mapBatchRow);
  }

  async markBatchAnchored(
    batchId: string,
    txHash: string,
    blockNumber: bigint,
    contractAddress: `0x${string}`,
  ): Promise<void> {
    await getPool().query(
      `UPDATE anchor_batches
       SET status = 'anchored',
           tx_hash = $2,
           block_number = $3,
           contract_address = $4,
           anchored_at = NOW()
       WHERE id = $1`,
      [batchId, txHash, blockNumber.toString(), getAddress(contractAddress)],
    );
  }

  async recordBatchContractAddress(
    txHash: string,
    contractAddress: `0x${string}`,
  ): Promise<void> {
    await getPool().query(
      `UPDATE anchor_batches
       SET contract_address = $2
       WHERE tx_hash = $1
         AND contract_address IS NULL`,
      [txHash, getAddress(contractAddress)],
    );
  }

  async markBatchFailed(batchId: string): Promise<void> {
    await getPool().query(
      `UPDATE anchor_batches SET status = 'failed' WHERE id = $1`,
      [batchId],
    );
  }

  async listRecentAnchoredBatches(limit: number): Promise<AnchorBatchRecord[]> {
    const result = await getPool().query<{
      id: string;
      merkle_root: string;
      event_count: number;
      status: AnchorBatchStatus;
      tx_hash: string | null;
      block_number: string | null;
      chain_id: number;
      contract_address: string | null;
      created_at: Date;
      anchored_at: Date | null;
    }>(
      `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
              chain_id, contract_address, created_at, anchored_at
       FROM anchor_batches
       WHERE status = 'anchored'
       ORDER BY anchored_at DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map(mapBatchRow);
  }

  async getLogProof(
    logId: string,
    apiKeyIds: string[] | null,
    contractAddress: `0x${string}`,
  ): Promise<UsageLogProofResult | null> {
    const eventResult = await getPool().query<{
      id: string;
      api_key_id: string | null;
      provider: string;
      model: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cost: string;
      latency_ms: number | null;
      fallback_used: boolean;
      created_at: Date;
      receipt_hash: string | null;
      anchor_batch_id: string | null;
      leaf_index: number | null;
    }>(
      `SELECT id, api_key_id, provider, model, prompt_tokens, completion_tokens,
              total_tokens, cost, latency_ms, fallback_used, created_at,
              receipt_hash, anchor_batch_id, leaf_index
       FROM usage_events
       WHERE id = $1
         AND ($2::uuid[] IS NULL OR api_key_id = ANY($2::uuid[]))`,
      [logId, apiKeyIds],
    );

    const row = eventResult.rows[0];
    if (!row) return null;

    const loaded = row.anchor_batch_id
      ? await loadBatchReceipts(row.anchor_batch_id)
      : null;

    return buildUsageLogProof(
      {
        id: row.id,
        provider: row.provider,
        model: row.model,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        cost: Number(row.cost),
        latencyMs: row.latency_ms ?? 0,
        fallbackUsed: row.fallback_used,
        createdAt: row.created_at.toISOString(),
        receiptHash: row.receipt_hash,
        leafIndex: row.leaf_index,
      },
      loaded?.batch ?? null,
      loaded?.receiptHashes ?? [],
      contractAddress,
    );
  }

  async getSettlementProof(
    settlementIdOrHash: string,
  ): Promise<SettlementReceiptProofResult | null> {
    const key = parseSettlementProofKey(settlementIdOrHash);
    if (!key) return null;

    const where = key.kind === "id" ? "id = $1" : "receipt_hash = $1";
    const eventResult = await getPool().query<{
      id: string;
      reference_id: string;
      payer_wallet: string;
      payee_wallet: string;
      amount: string;
      asset: string;
      created_at: Date;
      receipt_hash: string | null;
      anchor_batch_id: string | null;
      leaf_index: number | null;
    }>(
      `SELECT id, reference_id, payer_wallet, payee_wallet, amount, asset,
              created_at, receipt_hash, anchor_batch_id, leaf_index
       FROM settlement_receipts
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 1`,
      [key.value],
    );

    const row = eventResult.rows[0];
    if (!row) return null;

    const loaded = row.anchor_batch_id
      ? await loadBatchReceipts(row.anchor_batch_id)
      : null;

    return buildSettlementReceiptProof(
      {
        id: row.id,
        referenceId: row.reference_id,
        payer: row.payer_wallet,
        payee: row.payee_wallet,
        amount: Number(row.amount),
        asset: row.asset,
        createdAt: row.created_at.toISOString(),
        receiptHash: row.receipt_hash,
        leafIndex: row.leaf_index,
      },
      loaded?.batch ?? null,
      loaded?.receiptHashes ?? [],
    );
  }
}

function mapBatchRow(row: {
  id: string;
  merkle_root: string;
  event_count: number;
  status: AnchorBatchStatus;
  tx_hash: string | null;
  block_number: string | null;
  chain_id: number;
  contract_address: string | null;
  created_at: Date;
  anchored_at: Date | null;
}): AnchorBatchRecord {
  return {
    id: row.id,
    merkleRoot: row.merkle_root as `0x${string}`,
    eventCount: row.event_count,
    status: row.status,
    txHash: row.tx_hash,
    blockNumber: row.block_number !== null ? BigInt(row.block_number) : null,
    chainId: row.chain_id,
    contractAddress: row.contract_address ? getAddress(row.contract_address) : null,
    createdAt: row.created_at.toISOString(),
    anchoredAt: row.anchored_at?.toISOString() ?? null,
  };
}

async function loadBatchReceipts(batchId: string): Promise<{
  batch: AnchorBatchRecord;
  receiptHashes: `0x${string}`[];
} | null> {
  const batchResult = await getPool().query<{
    id: string;
    merkle_root: string;
    event_count: number;
    status: AnchorBatchStatus;
    tx_hash: string | null;
    block_number: string | null;
    chain_id: number;
    contract_address: string | null;
    created_at: Date;
    anchored_at: Date | null;
  }>(
    `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
            chain_id, contract_address, created_at, anchored_at
     FROM anchor_batches
     WHERE id = $1`,
    [batchId],
  );

  const batchRow = batchResult.rows[0];
  if (!batchRow) return null;

  const leaves = await getPool().query<{ receipt_hash: string }>(
    `SELECT receipt_hash
     FROM (
       SELECT receipt_hash, leaf_index
       FROM usage_events
       WHERE anchor_batch_id = $1
       UNION ALL
       SELECT receipt_hash, leaf_index
       FROM settlement_receipts
       WHERE anchor_batch_id = $1
     ) batch_leaves
     ORDER BY leaf_index ASC`,
    [batchId],
  );

  return {
    batch: mapBatchRow(batchRow),
    receiptHashes: leaves.rows.map((leaf) => leaf.receipt_hash as `0x${string}`),
  };
}

interface UnanchoredReceipt {
  id: string;
  receiptHash: `0x${string}`;
  createdAt: Date;
  source: "usage" | "settlement";
}

async function lockSource(
  client: PoolClient,
  source: UnanchoredReceipt["source"],
  limit: number,
): Promise<UnanchoredReceipt[]> {
  const sql =
    source === "usage"
      ? `SELECT id, receipt_hash, created_at
         FROM usage_events
         WHERE receipt_hash IS NOT NULL
           AND anchor_batch_id IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`
      : `SELECT id, receipt_hash, created_at
         FROM settlement_receipts
         WHERE receipt_hash IS NOT NULL
           AND anchor_batch_id IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`;

  const result = await client.query<{
    id: string;
    receipt_hash: string;
    created_at: Date;
  }>(sql, [limit]);

  return result.rows.map((row) => ({
    id: row.id,
    receiptHash: row.receipt_hash as `0x${string}`,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    source,
  }));
}

/**
 * Oldest unanchored receipts across inference logs and wallet settlements.
 * Locking the oldest `limit` rows of each table is enough to pick the global
 * oldest `limit`, then the unused locks drop when the transaction ends.
 */
async function lockUnanchoredReceipts(
  client: PoolClient,
  limit: number,
): Promise<UnanchoredReceipt[]> {
  const usage = await lockSource(client, "usage", limit);
  const settlements = await lockSource(client, "settlement", limit);

  return [...usage, ...settlements]
    .sort((a, b) => {
      const time = a.createdAt.getTime() - b.createdAt.getTime();
      if (time !== 0) return time;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .slice(0, limit);
}

export function createAnchorStore(): AnchorStore | null {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresAnchorStore();
}
