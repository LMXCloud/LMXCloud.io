import { getPool } from "../db/pool.js";
import { hashReceipt } from "../anchors/receipt.js";
import type {
  KeyUsageStats,
  RecordUsageInput,
  UsageDayBucket,
  UsageLogEntry,
  UsageLogsQuery,
  UsageLogsResult,
  UsageStore,
} from "./store.js";

function routeForResourceType(resourceType: string): string {
  if (resourceType === "chat") return "/v1/chat/completions";
  if (resourceType === "web_search") return "/v1/web/search";
  return `/v1/${resourceType}`;
}

export class PostgresUsageStore implements UsageStore {
  async recordUsage(input: RecordUsageInput): Promise<string | null> {
    const pool = getPool();
    const totalTokens = input.promptTokens + input.completionTokens;
    const cost = input.cost ?? 0;
    const success = input.success !== false;
    const resourceType = input.resourceType ?? "chat";
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (input.apiKeyId && success) {
        await client.query(
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
      }

      const inserted = await client.query<{
        id: string;
        created_at: Date;
      }>(
        `INSERT INTO usage_events (
           api_key_id, payer_wallet, payment_event_id, provider, model,
           prompt_tokens, completion_tokens, total_tokens, cost, latency_ms, fallback_used,
           resource_type, success, error_code, unit_price
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, created_at`,
        [
          input.apiKeyId ?? null,
          input.payerWallet?.toLowerCase() ?? null,
          input.paymentEventId ?? null,
          input.provider,
          input.model,
          input.promptTokens,
          input.completionTokens,
          totalTokens,
          cost,
          input.latencyMs,
          input.fallbackUsed,
          resourceType,
          success,
          input.errorCode ?? null,
          input.unitPrice ?? null,
        ],
      );

      const row = inserted.rows[0]!;

      // Receipts remain a success/delivery proof — failures are telemetry only.
      if (success) {
        const createdAt = row.created_at.toISOString();
        const receiptHash = hashReceipt({
          id: row.id,
          provider: input.provider,
          model: input.model,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          totalTokens,
          cost,
          latencyMs: input.latencyMs,
          fallbackUsed: input.fallbackUsed,
          createdAt,
        });

        await client.query(
          `UPDATE usage_events SET receipt_hash = $2 WHERE id = $1`,
          [row.id, receiptHash],
        );
      }

      await client.query("COMMIT");
      return row.id;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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
         AND success = true
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

  async getUsageLogs(apiKeyIds: string[], query: UsageLogsQuery): Promise<UsageLogsResult> {
    if (apiKeyIds.length === 0) {
      return { data: [], hasMore: false, nextCursor: null };
    }

    const params: unknown[] = [apiKeyIds];
    const filters = ["api_key_id = ANY($1::uuid[])", "success = true"];

    if (query.days !== undefined) {
      params.push(query.days);
      filters.push(`created_at >= NOW() - ($${params.length}::int || ' days')::interval`);
    }

    if (query.cursor) {
      params.push(query.cursor);
      filters.push(
        `(created_at, id) < (
          SELECT created_at, id FROM usage_events WHERE id = $${params.length}::uuid
        )`,
      );
    }

    params.push(query.limit + 1);
    const limitParam = `$${params.length}`;

    const result = await getPool().query<{
      id: string;
      api_key_id: string;
      provider: string;
      model: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cost: string;
      latency_ms: number | null;
      fallback_used: boolean;
      resource_type: string;
      success: boolean;
      created_at: Date;
    }>(
      `SELECT
         id, api_key_id, provider, model,
         prompt_tokens, completion_tokens, total_tokens,
         cost, latency_ms, fallback_used, resource_type, success, created_at
       FROM usage_events
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;

    return {
      data: rows.map((row): UsageLogEntry => ({
        id: row.id,
        apiKeyId: row.api_key_id,
        route: routeForResourceType(row.resource_type),
        resourceType: row.resource_type,
        provider: row.provider,
        model: row.model,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        cost: Number(row.cost),
        latencyMs: row.latency_ms ?? 0,
        fallbackUsed: row.fallback_used,
        success: row.success,
        status: row.success ? 200 : 502,
        createdAt: row.created_at.toISOString(),
      })),
      hasMore,
      nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }
}
