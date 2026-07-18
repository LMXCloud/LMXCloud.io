import { getPool } from "../db/pool.js";
import { buildReceiptMerkleTree } from "./merkle.js";
import {
  buildUsageLogProof,
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
  ): Promise<void>;
  markBatchFailed(batchId: string): Promise<void>;
  listRecentAnchoredBatches(limit: number): Promise<AnchorBatchRecord[]>;
  getLogProof(
    logId: string,
    apiKeyIds: string[] | null,
    contractAddress: `0x${string}`,
  ): Promise<UsageLogProofResult | null>;
}

export class PostgresAnchorStore implements AnchorStore {
  async countUnanchoredEvents(): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM usage_events
       WHERE receipt_hash IS NOT NULL AND anchor_batch_id IS NULL`,
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

      const selected = await client.query<{
        id: string;
        receipt_hash: string;
      }>(
        `SELECT id, receipt_hash
         FROM usage_events
         WHERE receipt_hash IS NOT NULL
           AND anchor_batch_id IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [maxEvents],
      );

      if (selected.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const receiptHashes = selected.rows.map(
        (row) => row.receipt_hash as `0x${string}`,
      );
      const { root } = buildReceiptMerkleTree(receiptHashes);

      const batch = await client.query<{ id: string }>(
        `INSERT INTO anchor_batches (merkle_root, event_count, status, chain_id)
         VALUES ($1, $2, 'submitting', $3)
         RETURNING id`,
        [root, selected.rows.length, chainId],
      );

      const batchId = batch.rows[0]!.id;
      const leaves: ClaimedBatchLeaf[] = [];

      for (let index = 0; index < selected.rows.length; index++) {
        const row = selected.rows[index]!;
        await client.query(
          `UPDATE usage_events
           SET anchor_batch_id = $2, leaf_index = $3
           WHERE id = $1`,
          [row.id, batchId, index],
        );
        leaves.push({
          eventId: row.id,
          receiptHash: row.receipt_hash as `0x${string}`,
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
      created_at: Date;
      anchored_at: Date | null;
    }>(
      `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
              chain_id, created_at, anchored_at
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
  ): Promise<void> {
    await getPool().query(
      `UPDATE anchor_batches
       SET status = 'anchored',
           tx_hash = $2,
           block_number = $3,
           anchored_at = NOW()
       WHERE id = $1`,
      [batchId, txHash, blockNumber.toString()],
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
      created_at: Date;
      anchored_at: Date | null;
    }>(
      `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
              chain_id, created_at, anchored_at
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

    let batch: AnchorBatchRecord | null = null;
    let batchReceiptHashes: `0x${string}`[] = [];

    if (row.anchor_batch_id) {
      const batchResult = await getPool().query<{
        id: string;
        merkle_root: string;
        event_count: number;
        status: AnchorBatchStatus;
        tx_hash: string | null;
        block_number: string | null;
        chain_id: number;
        created_at: Date;
        anchored_at: Date | null;
      }>(
        `SELECT id, merkle_root, event_count, status, tx_hash, block_number,
                chain_id, created_at, anchored_at
         FROM anchor_batches
         WHERE id = $1`,
        [row.anchor_batch_id],
      );

      if (batchResult.rows[0]) {
        batch = mapBatchRow(batchResult.rows[0]);

        const leaves = await getPool().query<{ receipt_hash: string }>(
          `SELECT receipt_hash
           FROM usage_events
           WHERE anchor_batch_id = $1
           ORDER BY leaf_index ASC`,
          [row.anchor_batch_id],
        );

        batchReceiptHashes = leaves.rows.map(
          (leaf) => leaf.receipt_hash as `0x${string}`,
        );
      }
    }

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
      batch,
      batchReceiptHashes,
      contractAddress,
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
    createdAt: row.created_at.toISOString(),
    anchoredAt: row.anchored_at?.toISOString() ?? null,
  };
}

export function createAnchorStore(): AnchorStore | null {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresAnchorStore();
}
