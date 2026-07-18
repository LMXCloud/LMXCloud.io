import type { Network } from "@x402/core/types";
import type { x402ResourceServer } from "@x402/core/server";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  createLmxX402ResourceServer,
  formatUsdPrice,
  toCaip2ChainId,
} from "@lmxcloud/x402";
import {
  fetchJson,
  getSupportedModels,
  normalizeMessageContent,
  pricingQuotePath,
  type LmxChatResponse,
} from "./lmx-client.js";
import { logToolEvent } from "./log.js";

export type McpX402Config = {
  enabled: true;
  resourceServer: x402ResourceServer;
  networkId: Network;
  payToAddress: string;
  fulfillmentApiKey: string;
};

export type McpX402LoadResult =
  | { ok: true; config: McpX402Config }
  | { ok: false; reason: string };

type PricingQuoteResponse = {
  quote?: {
    quoted_amount_usdc?: string;
    estimated_tokens?: number;
  } | null;
  error?: string;
  model?: unknown;
};

function isHexAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(value);
}

/**
 * Load MCP seller-side x402 config from env. Returns disabled with a reason when
 * incomplete so chat_completion can fall back to requiring an API key.
 */
export async function loadMcpX402Config(): Promise<McpX402LoadResult> {
  if (process.env.X402_ENABLED !== "true") {
    return { ok: false, reason: "X402_ENABLED is not true" };
  }

  const cdpApiKeyId = process.env.CDP_API_KEY_ID?.trim();
  const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET?.trim();
  const treasury = process.env.TREASURY_ADDRESS?.trim();
  const fulfillmentApiKey = (
    process.env.LMX_X402_FULFILLMENT_API_KEY ??
    process.env.LMX_ADMIN_API_KEY ??
    ""
  ).trim();

  if (!cdpApiKeyId || !cdpApiKeySecret) {
    return {
      ok: false,
      reason: "X402_ENABLED requires CDP_API_KEY_ID and CDP_API_KEY_SECRET",
    };
  }
  if (!treasury || !isHexAddress(treasury)) {
    return {
      ok: false,
      reason: "X402_ENABLED requires a valid TREASURY_ADDRESS",
    };
  }
  if (!fulfillmentApiKey) {
    return {
      ok: false,
      reason:
        "X402_ENABLED requires LMX_X402_FULFILLMENT_API_KEY or LMX_ADMIN_API_KEY to fulfill paid MCP calls against the API",
    };
  }

  const chainId = Number(process.env.SIWE_CHAIN_ID ?? process.env.X402_CHAIN_ID ?? 8453);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return { ok: false, reason: "Invalid SIWE_CHAIN_ID / X402_CHAIN_ID" };
  }

  const networkId = toCaip2ChainId(chainId);
  const resourceServer = createLmxX402ResourceServer({
    networkId,
    cdpApiKeyId,
    cdpApiKeySecret,
  });
  await resourceServer.initialize();

  return {
    ok: true,
    config: {
      enabled: true,
      resourceServer,
      networkId,
      payToAddress: treasury,
      fulfillmentApiKey,
    },
  };
}

function estimatePromptTokens(prompt: string, imageCount = 0): number {
  /** Keep in sync with apps/api ESTIMATED_IMAGE_TOKENS for ceiling quotes. */
  const IMAGE_TOKENS = 765;
  return Math.max(1, Math.ceil(prompt.length / 4) + imageCount * IMAGE_TOKENS);
}

export function buildUserMessageContent(
  prompt: string,
  imageUrl?: string,
  images?: string[],
): string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  const urls = [
    ...(imageUrl ? [imageUrl] : []),
    ...(images ?? []),
  ].filter((url) => url.trim() !== "");

  if (urls.length === 0) return prompt;

  return [
    { type: "text" as const, text: prompt },
    ...urls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}

function countImages(imageUrl?: string, images?: string[]): number {
  return [
    ...(imageUrl ? [imageUrl] : []),
    ...(images ?? []),
  ].filter((url) => url.trim() !== "").length;
}

async function quoteChatCall(params: {
  model: string;
  prompt: string;
  maxTokens?: number;
  imageCount?: number;
}): Promise<{ ok: true; amount: number; estimatedTokens?: number } | { ok: false; error: string }> {
  const quote = await fetchJson<PricingQuoteResponse>(
    pricingQuotePath({
      model: params.model,
      max_tokens: params.maxTokens,
      prompt_tokens: estimatePromptTokens(params.prompt, params.imageCount ?? 0),
    }),
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );

  if (!quote.ok) {
    return { ok: false, error: quote.error };
  }

  if (!quote.data.quote?.quoted_amount_usdc || quote.data.model == null) {
    return {
      ok: false,
      error:
        quote.data.error ??
        `Unable to quote model "${params.model}" for x402 payment`,
    };
  }

  const amount = Number(quote.data.quote.quoted_amount_usdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Pricing quote returned an invalid amount" };
  }

  return {
    ok: true,
    amount,
    estimatedTokens: quote.data.quote.estimated_tokens,
  };
}

export type ChatCompletionArgs = {
  prompt: string;
  image_url?: string;
  images?: string[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  api_key?: string;
};

const CHAT_TOOL_DESCRIPTION =
  "Pay-per-request OpenAI-compatible chat completions on DePIN infrastructure. Generate text from Llama, Qwen, DeepSeek, and other models with USDC micropayments on Base — no prepaid API credits required. Optional image_url / images for vision models (llama-3.2-90b-vision, qwen-3.6-35b, qwen-3.5-35b).";

/**
 * Run an x402-gated chat_completion: quote → build payment requirements →
 * createPaymentWrapper → fulfill via funded service API key after verify.
 */
export async function runX402ChatCompletion(options: {
  args: ChatCompletionArgs;
  extra: unknown;
  defaultModel: string;
  x402: McpX402Config;
  started: number;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
}> {
  const { args, extra, defaultModel, x402, started } = options;
  const selectedModel = args.model ?? defaultModel;
  const imageCount = countImages(args.image_url, args.images);

  const models = await getSupportedModels(x402.fulfillmentApiKey);
  if (!models.ok) {
    logToolEvent({
      tool: "chat_completion",
      callerId: "x402",
      source: "public",
      ok: false,
      latencyMs: Date.now() - started,
      detail: models.error,
    });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Model validation failed because /v1/models was unavailable: ${models.error}`,
        },
      ],
    };
  }

  const ids = new Set((models.data.data ?? []).map((entry) => entry.id));
  if (!ids.has(selectedModel)) {
    const suggestions = (models.data.data ?? []).slice(0, 12).map((entry) => entry.id);
    const message = [
      `Model "${selectedModel}" is not currently supported.`,
      "Use `list_models` to see the full live list.",
      `Try one of: ${suggestions.join(", ")}`,
    ].join("\n");
    logToolEvent({
      tool: "chat_completion",
      callerId: "x402",
      source: "public",
      ok: false,
      latencyMs: Date.now() - started,
      detail: message,
    });
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  const quoted = await quoteChatCall({
    model: selectedModel,
    prompt: args.prompt,
    maxTokens: args.max_tokens,
    imageCount,
  });
  if (!quoted.ok) {
    logToolEvent({
      tool: "chat_completion",
      callerId: "x402",
      source: "public",
      ok: false,
      latencyMs: Date.now() - started,
      detail: quoted.error,
    });
    return { isError: true, content: [{ type: "text", text: quoted.error }] };
  }

  const accepts = await x402.resourceServer.buildPaymentRequirements({
    scheme: "upto",
    network: x402.networkId,
    payTo: x402.payToAddress,
    price: formatUsdPrice(quoted.amount),
    maxTimeoutSeconds: 300,
  });

  if (accepts.length === 0) {
    const message =
      "x402 payment requirements could not be built (facilitator may not support upto on this network).";
    logToolEvent({
      tool: "chat_completion",
      callerId: "x402",
      source: "public",
      ok: false,
      latencyMs: Date.now() - started,
      detail: message,
    });
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  const paid = createPaymentWrapper(x402.resourceServer, {
    accepts,
    resource: {
      url: "mcp://tool/chat_completion",
      description: CHAT_TOOL_DESCRIPTION,
      mimeType: "application/json",
      serviceName: "LMX Cloud",
      tags: ["inference", "llm", "openai", "chat-completions", "depin", "mcp", "vision"],
      iconUrl: "https://lmxcloud.io/favicon.svg",
    },
    extensions: declareDiscoveryExtension({
      toolName: "chat_completion",
      description: CHAT_TOOL_DESCRIPTION,
      transport: "streamable-http",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "User prompt to send to the selected model.",
          },
          image_url: {
            type: "string",
            description:
              "Optional image as https URL or data:image/...;base64,... URI (vision models only).",
          },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Optional additional images (vision models only).",
          },
          model: {
            type: "string",
            description:
              "LMX model alias (e.g. llama-3-70b, llama-3.2-90b-vision, qwen-3.6-35b)",
          },
          max_tokens: {
            type: "integer",
            description: "Maximum tokens to generate (optional)",
          },
          temperature: {
            type: "number",
            description: "Sampling temperature (optional)",
          },
        },
        required: ["prompt"],
      },
      example: {
        prompt: "Say hello in one sentence.",
        model: "llama-3-70b",
      },
      output: {
        example: {
          text: "Hello! How can I help you today?",
          model: "llama-3-70b",
        },
      },
    }),
  });

  return paid(async (paidArgs) => {
    const fulfillment = paidArgs as ChatCompletionArgs;
    const fulfillmentModel = fulfillment.model ?? defaultModel;
    const payload = {
      model: fulfillmentModel,
      messages: [
        {
          role: "user",
          content: buildUserMessageContent(
            fulfillment.prompt,
            fulfillment.image_url,
            fulfillment.images,
          ),
        },
      ],
      ...(fulfillment.max_tokens ? { max_tokens: fulfillment.max_tokens } : {}),
      ...(typeof fulfillment.temperature === "number"
        ? { temperature: fulfillment.temperature }
        : {}),
      stream: false,
    };

    const completion = await fetchJson<LmxChatResponse>("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${x402.fulfillmentApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    logToolEvent({
      tool: "chat_completion",
      callerId: "x402",
      source: "public",
      ok: completion.ok,
      latencyMs: Date.now() - started,
      detail: completion.ok
        ? `x402 quote=${quoted.amount.toFixed(6)} estimated_tokens=${quoted.estimatedTokens ?? "?"}`
        : completion.error,
    });

    if (!completion.ok) {
      return { isError: true, content: [{ type: "text", text: completion.error }] };
    }

    const text = normalizeMessageContent(completion.data.choices);
    return {
      content: [
        {
          type: "text",
          text: text || "LMX API returned a completion response without text content.",
        },
        {
          type: "text",
          text: JSON.stringify(
            {
              id: completion.data.id,
              model: completion.data.model,
              usage: completion.data.usage,
              payment: {
                scheme: "upto",
                network: x402.networkId,
                quoted_amount_usdc: quoted.amount.toFixed(6),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  })(args, extra);
}
