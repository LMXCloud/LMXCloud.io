import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as Sentry from "@sentry/node";
import { requireAuthenticatedKey } from "../auth/optional-auth.js";
import { roundCredits } from "../credits/pricing.js";
import type { CreditStore } from "../credits/store.js";
import type { RateLimitResult } from "../rate-limit.js";
import {
  RESOURCE_TYPE_WEB_SEARCH,
  recordProviderFailure,
  recordProviderSuccess,
} from "../telemetry/index.js";
import type { UsageStore } from "../usage/store.js";
import {
  BraveSearchError,
  braveWebSearch,
  type BraveSearchConfig,
} from "../search/brave.js";

const MAX_RESULTS = 20;
const DEFAULT_RESULTS = 5;
/** Fixed unit label recorded on usage_events.model for this tool. */
const WEB_SEARCH_MODEL = "web_search";
const WEB_SEARCH_PROVIDER = "brave";

interface WebSearchRouteDeps {
  brave: BraveSearchConfig | null;
  usageStore: UsageStore;
  creditStore: CreditStore;
  priceUsdc: number;
  rateLimit: (key: string) => RateLimitResult;
}

function parseSearchBody(
  body: unknown,
): { query: string; maxResults: number } | string {
  if (typeof body !== "object" || body === null) {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.query !== "string" || b.query.trim() === "") {
    return "Field 'query' is required and must be a non-empty string";
  }
  let maxResults = DEFAULT_RESULTS;
  if (b.max_results !== undefined) {
    if (typeof b.max_results !== "number" || !Number.isInteger(b.max_results)) {
      return "Field 'max_results' must be an integer";
    }
    if (b.max_results < 1 || b.max_results > MAX_RESULTS) {
      return `Field 'max_results' must be between 1 and ${MAX_RESULTS}`;
    }
    maxResults = b.max_results;
  }
  return { query: b.query.trim(), maxResults };
}

/**
 * POST /v1/web/search — Brave Search passthrough with LMX fixed per-call billing.
 *
 * Telemetry: records usage_events with resource_type=web_search on success and
 * failure in this route (InferenceRouter does not apply). Measurable in ops
 * reliability filters, but excluded from the DePIN multi-network reliability claim.
 */
export async function registerWebSearchRoutes(
  app: FastifyInstance,
  deps: WebSearchRouteDeps,
): Promise<void> {
  app.post<{ Body: unknown }>("/v1/web/search", async (request, reply) => {
    const startedAt = Date.now();

    if (!requireAuthenticatedKey(request, reply)) return;

    if (!deps.brave) {
      return reply.status(503).send({
        error: {
          message:
            "Web search is not configured. Set BRAVE_SEARCH_API_KEY on the API server.",
          type: "service_unavailable",
          code: "web_search_unconfigured",
        },
      });
    }

    const limit = deps.rateLimit(request.apiKey!.id);
    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Web search rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    const parsed = parseSearchBody(request.body);
    if (typeof parsed === "string") {
      return reply.status(400).send({
        error: { message: parsed, type: "invalid_request_error" },
      });
    }

    const price = roundCredits(deps.priceUsdc);
    const hasCredits = await deps.creditStore.hasMinimumBalance(
      request.apiKey!.id,
      price,
    );
    if (!hasCredits) {
      const balance = await deps.creditStore.getBalance(request.apiKey!.id);
      return reply.status(402).send({
        error: {
          message: `Insufficient credits. Balance: $${roundCredits(balance).toFixed(8)}. Need $${price.toFixed(6)} per web_search call.`,
          type: "insufficient_credits",
          code: "insufficient_credits",
        },
      });
    }

    try {
      const search = await braveWebSearch(deps.brave, {
        query: parsed.query,
        count: parsed.maxResults,
      });

      const deducted = await deps.creditStore.deduct(request.apiKey!.id, price);
      if (!deducted && price > 0) {
        return reply.status(402).send({
          error: {
            message: "Insufficient credits to cover web_search cost",
            type: "insufficient_credits",
            code: "insufficient_credits",
          },
        });
      }

      let usageEventId: string | null = null;
      try {
        usageEventId = await recordProviderSuccess(deps.usageStore, {
          apiKeyId: request.apiKey!.id,
          provider: WEB_SEARCH_PROVIDER,
          model: WEB_SEARCH_MODEL,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: search.latencyMs,
          fallbackUsed: false,
          cost: price,
          unitPrice: price,
          resourceType: RESOURCE_TYPE_WEB_SEARCH,
        });
      } catch (usageErr) {
        request.log.error({ err: usageErr }, "web_search usage recording failed");
      }

      const balance = await deps.creditStore.getBalance(request.apiKey!.id);
      reply.header("x-lmx-provider", WEB_SEARCH_PROVIDER);
      reply.header("x-lmx-fallback", "false");
      reply.header("x-lmx-latency", String(search.latencyMs));
      reply.header("x-lmx-cost", String(price));
      if (usageEventId) reply.header("x-lmx-usage-id", usageEventId);
      reply.header("x-lmx-balance", String(roundCredits(balance)));

      return reply.send({
        object: "web.search",
        query: search.rawQuery,
        provider: WEB_SEARCH_PROVIDER,
        results: search.results,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errorCode =
        err instanceof BraveSearchError
          ? `brave_${err.statusCode ?? "error"}`
          : "web_search_error";

      void recordProviderFailure(deps.usageStore, {
        apiKeyId: request.apiKey!.id,
        provider: WEB_SEARCH_PROVIDER,
        model: WEB_SEARCH_MODEL,
        latencyMs,
        fallbackUsed: false,
        unitPrice: price,
        errorCode,
        resourceType: RESOURCE_TYPE_WEB_SEARCH,
      });

      return handleWebSearchError(err, request, reply);
    }
  });
}

async function handleWebSearchError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (err instanceof BraveSearchError) {
    request.log.error({ err }, "Brave Search request failed");
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
    const status =
      err.statusCode === 429
        ? 429
        : err.statusCode === 401 || err.statusCode === 403
          ? 502
          : 504;
    await reply.status(status).send({
      error: {
        message: err.message,
        type: "provider_error",
        code: "brave",
      },
    });
    return;
  }

  request.log.error({ err }, "Unexpected error during web_search");
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  await reply.status(500).send({
    error: {
      message: "Internal server error",
      type: "internal_error",
    },
  });
}
