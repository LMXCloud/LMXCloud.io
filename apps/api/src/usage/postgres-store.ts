import { getPool } from "../db/pool.js";
import type { KeyUsageStats, RecordUsageInput, UsageDayBucket, UsageStore } from "./store.js";

export class PostgresUsageStore implements UsageStore {
  async recordUsage(input: RecordUsageInput): Promise<void> {
    const pool = getPool();
    const totalTokens = input.promptTokens + input.completionTokens;

    await pool.query(
      `INSERT INTO key_usage (
         api_key_id, request_count, prompt_tokens, completion_tokens, total_tokens, last_request_at
       ) VALUES ($1, 1, $2, $3, $4, NOW())
       ON CONFLICT (api_key_id) DO UPDATE SET
         request_count = key_usage.request_count + 1,
         prompt_tokens = key_usage.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = key_usage.completion_tokens + EXCLUDED.completion_tokens,
         total_tokens = key_usage.total_tokens + EXCLUDED.total_tokens,
         last_request_at = NOW()`,
      [input.apiKeyId, input.promptTokens, input.completionTokens, totalTokens],
    );

    await pool.query(
      `INSERT INTO usage_events (
         api_key_id, provider, model, prompt_tokens, completion_tokens,
         total_tokens, cost, latency_ms, fallback_used
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.apiKeyId,
        input.provider,
        input.model,
        input.promptTokens,
        input.completionTokens,
        totalTokens,
        input.cost ?? 0,
        input.latencyMs,
        input.fallbackUsed,
      ],
    );
  }

  async getUsage(apiKeyId: string): Promise<KeyUsageStats | null> {
    const result = await getPool().query<{
      api_key_id: string;
      request_count: number;
      prompt_tokens: string;
      completion_tokens: string;
      total_tokens: string;
      last_request_at: Date | null;
    }>(
      `SELECT api_key_id, request_count, prompt_tokens, completion_tokens, total_tokens, last_request_at
       FROM key_usage
       WHERE api_key_id = $1`,
      [apiKeyId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      apiKeyId: row.api_key_id,
      requestCount: row.request_count,
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      lastRequestAt: row.last_request_at?.toISOString() ?? null,
    };
  }

  async getUsageHistory(apiKeyIds: string[], days: number): Promise<UsageDayBucket[]> {
    if (apiKeyIds.length === 0) return [];

    const result = await getPool().query<{
      date: string;
      requests: string;
      prompt_tokens: string;
      completion_tokens: string;
      total_tokens: string;
      cost: string;
    }>(
      `SELECT
         TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
         COUNT(*)::text AS requests,
         SUM(prompt_tokens)::text AS prompt_tokens,
         SUM(completion_tokens)::text AS completion_tokens,
         SUM(total_tokens)::text AS total_tokens,
         SUM(cost)::text AS cost
       FROM usage_events
       WHERE api_key_id = ANY($1::uuid[])
         AND created_at >= NOW() - ($2::int || ' days')::interval
       GROUP BY DATE(created_at AT TIME ZONE 'UTC')
       ORDER BY date`,
      [apiKeyIds, days],
    );

    return result.rows.map((row) => ({
      date: row.date,
      requests: Number(row.requests),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cost: Number(row.cost),
    }));
  }
}
