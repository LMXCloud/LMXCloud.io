import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as Sentry from "@sentry/node";
import { AllProvidersDownError, ModelNotSupportedError, ProviderError } from "../providers/types.js";
import { calculateRequestCost, roundCredits } from "../credits/pricing.js";
import type { CreditStore } from "../credits/store.js";
import { requireAuthenticatedKey } from "../auth/optional-auth.js";
import { parseRoutingPreference } from "../routing/strategies.js";
import type { InferenceRouter } from "../routing/router.js";
import type { RateLimitResult } from "../rate-limit.js";
import type { UsageStore } from "../usage/store.js";
import type { PaymentStore } from "../payments/store.js";
import { parseChatBody } from "../payments/quote-context.js";
import { hashPaymentPayload } from "../payments/idempotency.js";

interface ChatRouteDeps {
  router: InferenceRouter;
  usageStore: UsageStore;
  creditStore: CreditStore;
  paymentStore: PaymentStore | null;
  chatRateLimit: (key: string) => RateLimitResult;
  x402RateLimit?: (key: string) => RateLimitResult;
  minChatCost: number;
  x402Enabled: boolean;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractUsageFromSseChunk(chunk: string): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} | null {
  const frames = chunk.split("\n\n");
  for (const frame of frames) {
    const lines = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"));

    for (const line of lines) {
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const data = JSON.parse(raw) as {
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        };
        if (data.usage) return data.usage;
      } catch {
        // Ignore malformed vendor chunks; upstream stream continues.
      }
    }
  }
  return null;
}

function extractX402Payer(request: FastifyRequest): string | undefined {
  const payload = request.x402Context?.paymentPayload.payload as {
    permit2Authorization?: { from?: string };
    authorization?: { from?: string };
  };
  return (
    payload.permit2Authorization?.from ?? payload.authorization?.from
  )?.toLowerCase();
}

function x402RateLimitKey(request: FastifyRequest): string {
  const payer = extractX402Payer(request);
  if (payer) return `x402:payer:${payer}`;
  return `x402:ip:${request.ip}`;
}

async function rejectReplayedX402Payment(
  paymentStore: PaymentStore | null,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!paymentStore || !request.x402Context) return false;

  const payloadHash = hashPaymentPayload(
    JSON.stringify(request.x402Context.paymentPayload),
  );
  const payment = await paymentStore.findByPayloadHash(payloadHash);
  if (!payment) return false;

  const alreadyConsumed =
    payment.status === "completed" ||
    payment.status === "refunded" ||
    payment.usageEventId !== null;
  if (alreadyConsumed) {
    await reply.status(409).send({
      error: {
        message: "Payment payload has already been consumed",
        type: "invalid_request_error",
        code: "x402_payment_replay",
      },
    });
    return true;
  }

  if (payment.status === "settled") {
    await reply.status(409).send({
      error: {
        message: "Payment payload is already settled and cannot be reused",
        type: "invalid_request_error",
        code: "x402_payment_replay",
      },
    });
    return true;
  }

  return false;
}

async function linkX402Usage(
  paymentStore: PaymentStore | null,
  request: FastifyRequest,
  usageEventId: string | null,
): Promise<void> {
  if (!paymentStore || !request.x402Context || !usageEventId) return;

  const payloadHash = hashPaymentPayload(
    JSON.stringify(request.x402Context.paymentPayload),
  );
  const payment = await paymentStore.findByPayloadHash(payloadHash);
  if (!payment) return;

  await paymentStore.linkUsageEvent(payment.id, usageEventId);
}

async function handleProviderErrors(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (err instanceof ModelNotSupportedError) {
    await reply.status(400).send({
      error: {
        message: err.message,
        type: "invalid_request_error",
        code: "model_not_supported",
        param: "model",
      },
    });
    return;
  }

  if (err instanceof AllProvidersDownError) {
    await reply.status(503).send({
      error: {
        message: err.message,
        type: "service_unavailable",
        code: "all_providers_down",
      },
    });
    return;
  }

  if (err instanceof ProviderError) {
    request.log.error({ err, provider: err.provider }, "Provider request failed");
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err);
    }
    const status = err.statusCode === 429 ? 429 : err.statusCode === 401 ? 502 : 504;
    await reply.status(status).send({
      error: {
        message: err.message,
        type: "provider_error",
        code: err.provider,
      },
    });
    return;
  }

  request.log.error({ err }, "Unexpected error during chat completion");
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  await reply.status(500).send({
    error: {
      message: "Internal server error",
      type: "internal_error",
    },
  });
}

export async function registerChatRoutes(
  app: FastifyInstance,
  deps: ChatRouteDeps,
): Promise<void> {
  app.post<{ Body: unknown }>("/v1/chat/completions", async (request, reply) => {
    const startedAt = Date.now();
    const isX402 = Boolean(request.x402Context);
    const isBalance = Boolean(request.apiKey);
    request.log.info({ isX402, isBalance, phase: "chat_handler_start" }, "x402 chat handler");

    if (!isX402 && !isBalance) {
      if (!deps.x402Enabled) {
        return reply.status(401).send({
          error: {
            message: "Missing Authorization header. Use: Bearer <token>",
            type: "authentication_error",
          },
        });
      }
      return;
    }

    if (isBalance && !requireAuthenticatedKey(request, reply)) {
      return;
    }

    const rateLimitKey = isBalance
      ? request.apiKey!.id
      : x402RateLimitKey(request);
    const limiter = isBalance ? deps.chatRateLimit : deps.x402RateLimit;
    const limit = limiter ? limiter(rateLimitKey) : { allowed: true as const };

    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Chat rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    if (isX402 && await rejectReplayedX402Payment(deps.paymentStore, request, reply)) {
      return;
    }

    const validated = parseChatBody(request.body);
    if (typeof validated === "string") {
      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    if (validated.stream && isX402) {
      return reply.status(400).send({
        error: {
          message: "Streaming is not supported for x402 payments yet",
          type: "invalid_request_error",
          code: "x402_stream_unsupported",
        },
      });
    }

    if (isBalance) {
      const hasCredits = await deps.creditStore.hasMinimumBalance(
        request.apiKey!.id,
        deps.minChatCost,
      );

      if (!hasCredits) {
        const balance = await deps.creditStore.getBalance(request.apiKey!.id);
        return reply.status(402).send({
          error: {
            message: `Insufficient credits. Balance: $${roundCredits(balance).toFixed(8)}. Top up to continue.`,
            type: "insufficient_credits",
            code: "insufficient_credits",
          },
        });
      }
    }

    const preference = parseRoutingPreference(headerValue(request.headers["x-lmx-prefer"]));

    try {
      const result = await deps.router.route(validated, preference);

      if (validated.stream && isBalance) {
        if (!result.stream) {
          throw new ProviderError(
            `Provider ${result.provider} did not return a stream`,
            result.provider,
          );
        }

        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("x-lmx-provider", result.provider);
        reply.raw.setHeader("x-lmx-fallback", result.fallbackUsed ? "true" : "false");
        reply.raw.setHeader("x-lmx-latency", String(result.latencyMs));

        let usage = result.usage ?? result.response.usage ?? null;
        try {
          for await (const chunk of result.stream) {
            const parsedUsage = extractUsageFromSseChunk(chunk);
            if (parsedUsage) usage = parsedUsage;
            reply.raw.write(chunk);
          }

          const promptTokens = usage?.prompt_tokens ?? 0;
          const completionTokens = usage?.completion_tokens ?? 0;
          const totalTokens = usage?.total_tokens ?? 0;
          const requestCost = roundCredits(
            calculateRequestCost(totalTokens, result.costPer1kTokens),
          );

          const deducted = await deps.creditStore.deduct(request.apiKey!.id, requestCost);
          if (!deducted && requestCost > 0) {
            reply.raw.write(
              `event: lmx.error\ndata: ${JSON.stringify({
                message: "Insufficient credits to cover streamed request cost",
                type: "insufficient_credits",
                code: "insufficient_credits",
              })}\n\n`,
            );
          }

          const balance = await deps.creditStore.getBalance(request.apiKey!.id);
          reply.raw.write(
            `event: lmx.meta\ndata: ${JSON.stringify({
              provider: result.provider,
              fallback: result.fallbackUsed,
              latencyMs: result.latencyMs,
              cost: requestCost,
              balance: roundCredits(balance),
              usage: usage ?? {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            })}\n\n`,
          );

          void deps.usageStore.recordUsage({
            apiKeyId: request.apiKey!.id,
            provider: result.provider,
            model: validated.model,
            promptTokens,
            completionTokens,
            latencyMs: result.latencyMs,
            fallbackUsed: result.fallbackUsed,
            cost: requestCost,
          });
        } catch (streamErr) {
          request.log.error({ err: streamErr }, "Streaming response failed");
          reply.raw.write(
            `event: lmx.error\ndata: ${JSON.stringify({
              message: "Streaming interrupted",
              type: "stream_error",
            })}\n\n`,
          );
        } finally {
          reply.raw.end();
        }
        return;
      }

      const usage = result.usage ?? result.response.usage ?? null;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? 0;
      const requestCost = roundCredits(
        calculateRequestCost(totalTokens, result.costPer1kTokens),
      );

      if (isBalance) {
        const deducted = await deps.creditStore.deduct(request.apiKey!.id, requestCost);
        if (!deducted && requestCost > 0) {
          return reply.status(402).send({
            error: {
              message: "Insufficient credits to cover request cost",
              type: "insufficient_credits",
              code: "insufficient_credits",
            },
          });
        }
      }

      let usageEventId: string | null = null;
      try {
        usageEventId = await deps.usageStore.recordUsage({
          apiKeyId: isBalance ? request.apiKey!.id : undefined,
          payerWallet: isX402 ? extractX402Payer(request) : undefined,
          provider: result.provider,
          model: validated.model,
          promptTokens,
          completionTokens,
          latencyMs: result.latencyMs,
          fallbackUsed: result.fallbackUsed,
          cost: requestCost,
        });
      } catch (usageErr) {
        request.log.error({ err: usageErr }, "usage recording failed");
      }

      if (isX402) {
        try {
          await linkX402Usage(deps.paymentStore, request, usageEventId);
        } catch (paymentErr) {
          request.log.error({ err: paymentErr }, "x402 payment linkage failed");
        }
      }

      const balance = isBalance
        ? await deps.creditStore.getBalance(request.apiKey!.id)
        : null;

      reply.header("x-lmx-provider", result.provider);
      reply.header("x-lmx-fallback", result.fallbackUsed ? "true" : "false");
      reply.header("x-lmx-latency", String(result.latencyMs));
      reply.header("x-lmx-cost", String(requestCost));
      if (balance !== null) {
        reply.header("x-lmx-balance", String(roundCredits(balance)));
      }

      return reply.send(result.response);
    } catch (err) {
      request.log.error({ err, elapsedMs: Date.now() - startedAt }, "x402 chat handler failed");
      await handleProviderErrors(err, request, reply);
    } finally {
      request.log.info({ elapsedMs: Date.now() - startedAt, isX402 }, "x402 chat handler done");
    }
  });
}
