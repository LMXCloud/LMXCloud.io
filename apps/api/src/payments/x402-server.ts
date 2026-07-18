import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { x402HTTPResourceServer } from "@x402/core/server";
import type {
  HTTPRequestContext,
  HTTPTransportContext,
  SettleResultContext,
  VerifyResultContext,
  VerifiedPaymentCanceledContext,
} from "@x402/core/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddlewareFromHTTPServer } from "@x402/fastify";
import type { Network } from "@x402/core/types";
import {
  createLmxX402ResourceServer,
  formatUsdPrice,
} from "@lmxcloud/x402";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import {
  buildChatQuoteFromHttpContext,
  parseChatBody,
} from "./quote-context.js";
import { hashPaymentPayload } from "./idempotency.js";
import type { PaymentStore } from "./store.js";
import { roundCredits } from "../credits/pricing.js";

export interface X402ServerDeps {
  app: FastifyInstance;
  providers: ProviderAdapter[];
  healthStore: HealthStore;
  paymentStore: PaymentStore | null;
  payToAddress: string;
  networkId: Network;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  marginPct: number;
  minCallUsdc: number;
  defaultMaxCompletionTokens: number;
}

function extractPayerWallet(
  verify: VerifyResultContext | SettleResultContext | VerifiedPaymentCanceledContext,
): string {
  const fromVerify = "result" in verify && verify.result.payer;
  if (fromVerify) return fromVerify.toLowerCase();

  const payload = verify.paymentPayload.payload as {
    permit2Authorization?: { from?: string };
    authorization?: { from?: string };
  };
  const fromPayload =
    payload.permit2Authorization?.from ?? payload.authorization?.from;
  return (fromPayload ?? "unknown").toLowerCase();
}

function quotedUsdFromRequirements(amountAtomic: string): number {
  return roundCredits(Number(amountAtomic) / 1e6);
}

/** Fire-and-forget DB writes — never block the x402 verify/settle HTTP path. */
function deferPaymentStoreWork(
  app: FastifyInstance,
  label: string,
  work: () => Promise<void>,
): void {
  void work().catch((err) => {
    app.log.error({ err }, `x402 ${label} recording failed`);
  });
}

async function recordVerifiedPayment(
  deps: X402ServerDeps,
  context: VerifyResultContext,
): Promise<void> {
  if (!deps.paymentStore || !context.result.isValid) return;

  const httpContext = context.transportContext as HTTPTransportContext | undefined;
  const body = parseChatBody(httpContext?.request.adapter.getBody?.());
  const model = typeof body === "string" ? "unknown" : body.model;
  let estimatedTokenCount: number | undefined;
  if (typeof body !== "string" && httpContext) {
    const quoteResult = buildChatQuoteFromHttpContext(
      httpContext.request,
      deps.providers,
      deps.healthStore,
      {
        marginPct: deps.marginPct,
        minCallUsdc: deps.minCallUsdc,
        defaultMaxCompletionTokens: deps.defaultMaxCompletionTokens,
      },
    );
    estimatedTokenCount =
      typeof quoteResult === "string" ? undefined : quoteResult.quote.estimatedTokens;
  }

  const payloadHash = hashPaymentPayload(JSON.stringify(context.paymentPayload));
  const payerWallet = extractPayerWallet(context);
  const quotedAmount = quotedUsdFromRequirements(context.requirements.amount);

  const event = await deps.paymentStore.createQuoted({
    payerWallet,
    quotedAmount,
    chainId: Number(deps.networkId.split(":")[1]),
    paymentPayloadHash: payloadHash,
    model,
    estimatedTokens: estimatedTokenCount,
  });
  await deps.paymentStore.markVerified(event.id);
}

const earlyParsedBodyKey = Symbol("x402EarlyParsedBody");
const earlyRawBodyKey = Symbol("x402EarlyRawBody");

/**
 * x402 middleware runs on Fastify's onRequest hook, before the JSON body parser.
 * Read and replay the body so dynamic pricing can inspect model/messages.
 */
function registerEarlyJsonBodyParser(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    const path = request.url.split("?")[0];
    if (path !== "/v1/chat/completions") return;

    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) return;
    if (request.body !== undefined) return;

    const chunks: Buffer[] = [];
    const incoming = request.raw as IncomingMessage;
    for await (const chunk of incoming) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);

    let parsed: unknown = null;
    if (rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        parsed = null;
      }
    }

    (
      request as {
        [earlyParsedBodyKey]?: unknown;
        [earlyRawBodyKey]?: Buffer;
      }
    )[earlyParsedBodyKey] = parsed;
    (request as { [earlyRawBodyKey]?: Buffer })[earlyRawBodyKey] = rawBody;
    request.body = parsed;
  });

  app.addHook("preParsing", async (request, _reply, payload) => {
    const earlyRaw = (request as { [earlyRawBodyKey]?: Buffer })[earlyRawBodyKey];
    if (earlyRaw === undefined) {
      return payload;
    }
    return Readable.from([earlyRaw]);
  });

  app.addHook("preValidation", async (request) => {
    const early = (request as { [earlyParsedBodyKey]?: unknown })[earlyParsedBodyKey];
    if (early !== undefined) {
      request.body = early;
    }
  });
}

export function registerX402ChatPayments(deps: X402ServerDeps): void {
  const resourceServer = createLmxX402ResourceServer({
    networkId: deps.networkId,
    cdpApiKeyId: deps.cdpApiKeyId,
    cdpApiKeySecret: deps.cdpApiKeySecret,
  });

  if (deps.paymentStore) {
    resourceServer.onAfterVerify(async (context: VerifyResultContext) => {
      deferPaymentStoreWork(deps.app, "verify", () =>
        recordVerifiedPayment(deps, context),
      );
    });

    resourceServer.onAfterSettle(async (context: SettleResultContext) => {
      if (!context.result.success || !deps.paymentStore) return;
      deferPaymentStoreWork(deps.app, "settle", async () => {
        const payloadHash = hashPaymentPayload(JSON.stringify(context.paymentPayload));
        const existing = await deps.paymentStore!.findByPayloadHash(payloadHash);
        if (!existing) return;

        const settledAmount = context.result.amount
          ? quotedUsdFromRequirements(context.result.amount)
          : existing.quotedAmount;

        const settled = await deps.paymentStore!.markSettled(
          existing.id,
          context.result.transaction,
          settledAmount,
        );

        // Handler normally markCompleted while status=fulfilling before onSend.
        // This covers the race where settle recording runs first, and webhook-style
        // redelivery when usage is already linked but status is still settled.
        if (settled?.usageEventId && settled.status !== "completed") {
          await deps.paymentStore!.markCompleted(settled.id, settled.usageEventId);
        }
      });
    });

    resourceServer.onVerifiedPaymentCanceled(async (context: VerifiedPaymentCanceledContext) => {
      if (!deps.paymentStore) return;
      deferPaymentStoreWork(deps.app, "cancel", async () => {
        const payloadHash = hashPaymentPayload(JSON.stringify(context.paymentPayload));
        const existing = await deps.paymentStore!.findByPayloadHash(payloadHash);
        if (!existing) return;

        await deps.paymentStore!.markFailed(
          existing.id,
          `payment_canceled:${context.reason}`,
        );
      });
    });
  }

  const httpServer = new x402HTTPResourceServer(resourceServer, {
    "POST /v1/chat/completions": {
      accepts: {
        scheme: "upto",
        payTo: deps.payToAddress,
        network: deps.networkId,
        maxTimeoutSeconds: 300,
        price: (context: HTTPRequestContext) => {
          const quoteResult = buildChatQuoteFromHttpContext(
            context,
            deps.providers,
            deps.healthStore,
            {
              marginPct: deps.marginPct,
              minCallUsdc: deps.minCallUsdc,
              defaultMaxCompletionTokens: deps.defaultMaxCompletionTokens,
            },
          );
          if (typeof quoteResult === "string") {
            throw new Error(quoteResult);
          }
          return formatUsdPrice(quoteResult.quote.quotedAmount);
        },
      },
      description:
        "Pay-per-request OpenAI-compatible chat completions on DePIN infrastructure. Generate text from Llama, Qwen, DeepSeek, and other models with USDC micropayments on Base — no prepaid API credits required.",
      mimeType: "application/json",
      // Catalog siblings on resource (not inside declareDiscoveryExtension).
      serviceName: "LMX Cloud",
      tags: ["inference", "llm", "openai", "chat-completions", "depin"],
      iconUrl: "https://lmxcloud.io/favicon.svg",
      extensions: {
        ...declareDiscoveryExtension({
          input: {
            model: "llama-3-70b",
            messages: [
              { role: "user", content: "Say hello in one sentence." },
            ],
          },
          // Agentic.Market treats schemas without type:"object" as absent.
          inputSchema: {
            type: "object",
            properties: {
              model: {
                type: "string",
                description:
                  "LMX model alias (e.g. llama-3-70b, qwen-3.6-35b, deepseek-r1)",
              },
              messages: {
                type: "array",
                description: "OpenAI-style chat messages",
                items: {
                  type: "object",
                  properties: {
                    role: {
                      type: "string",
                      enum: ["system", "user", "assistant", "tool"],
                    },
                    content: {
                      description:
                        "Plain text string, or OpenAI vision content parts (text + image_url with https or data:image/...;base64,...)",
                      oneOf: [
                        { type: "string" },
                        {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              type: {
                                type: "string",
                                enum: ["text", "image_url"],
                              },
                              text: { type: "string" },
                              image_url: {
                                type: "object",
                                properties: {
                                  url: { type: "string" },
                                  detail: {
                                    type: "string",
                                    enum: ["auto", "low", "high"],
                                  },
                                },
                                required: ["url"],
                              },
                            },
                            required: ["type"],
                          },
                        },
                      ],
                    },
                  },
                  required: ["role", "content"],
                },
              },
              temperature: {
                type: "number",
                description: "Sampling temperature (optional)",
              },
              max_tokens: {
                type: "integer",
                description: "Maximum tokens to generate (optional)",
              },
              stream: {
                type: "boolean",
                description: "If true, stream the response as SSE (optional)",
              },
            },
            required: ["model", "messages"],
          },
          bodyType: "json",
          output: {
            example: {
              id: "chatcmpl-lmx-example",
              object: "chat.completion",
              created: 1718000000,
              model: "llama-3-70b",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Hello! How can I help you today?",
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 10,
                total_tokens: 22,
              },
            },
          },
        }),
      },
      unpaidResponseBody: (context) => {
        const quoteResult = buildChatQuoteFromHttpContext(
          context,
          deps.providers,
          deps.healthStore,
          {
            marginPct: deps.marginPct,
            minCallUsdc: deps.minCallUsdc,
            defaultMaxCompletionTokens: deps.defaultMaxCompletionTokens,
          },
        );
        if (typeof quoteResult === "string") {
          return {
            contentType: "application/json",
            body: {
              error: {
                message: quoteResult,
                type: "invalid_request_error",
              },
            },
          };
        }
        return {
          contentType: "application/json",
          body: {
            error: {
              message: "Payment required for chat completion",
              type: "payment_required",
              code: "x402_payment_required",
            },
            quote: {
              model: quoteResult.model,
              estimated_tokens: quoteResult.quote.estimatedTokens,
              quoted_amount_usdc: quoteResult.quote.quotedAmount.toFixed(6),
            },
          },
        };
      },
    },
  });

  httpServer.onProtectedRequest(async (context) => {
    const authHeader = context.adapter.getHeader("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return { grantAccess: true };
    }
  });

  registerEarlyJsonBodyParser(deps.app);
  paymentMiddlewareFromHTTPServer(deps.app, httpServer, undefined, undefined, true);
}
