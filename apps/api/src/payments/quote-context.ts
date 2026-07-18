import type {
  ChatCompletionRequest,
  ChatContentPart,
  ChatMessage,
  ChatMessageContent,
} from "@lmxcloud/shared";
import {
  chatMessagesHaveImageContent,
  listVisionModelAliases,
  modelSupportsImageInput,
} from "@lmxcloud/shared";
import type { HTTPRequestContext } from "@x402/core/server";
import type { ProviderAdapter } from "../providers/types.js";
import type { HealthStore } from "../health/store.js";
import { buildPricingCatalog, getModelPrice } from "../pricing/catalog.js";
import {
  estimatePromptTokens,
  quoteCallPrice,
  resolveMaxCompletionTokens,
} from "../pricing/quote.js";

export interface ChatQuoteContext {
  model: string;
  quote: ReturnType<typeof quoteCallPrice>;
  listPricePer1k: number;
  provider: string;
}

function parseImageDetail(
  value: unknown,
): "auto" | "low" | "high" | undefined | string {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "low" || value === "high") return value;
  return "image_url.detail must be one of: auto, low, high";
}

function parseContentPart(part: unknown, index: number): ChatContentPart | string {
  if (typeof part !== "object" || part === null) {
    return `content[${index}] must be an object`;
  }
  const p = part as Record<string, unknown>;

  if (p.type === "text") {
    if (typeof p.text !== "string") {
      return `content[${index}] text parts require a string 'text' field`;
    }
    return { type: "text", text: p.text };
  }

  if (p.type === "image_url") {
    if (typeof p.image_url !== "object" || p.image_url === null) {
      return `content[${index}] image_url parts require an 'image_url' object`;
    }
    const imageUrl = p.image_url as Record<string, unknown>;
    if (typeof imageUrl.url !== "string" || imageUrl.url.trim() === "") {
      return `content[${index}] image_url.url must be a non-empty string (https URL or data:image/...;base64,...)`;
    }
    const detail = parseImageDetail(imageUrl.detail);
    if (typeof detail === "string" && detail !== "auto" && detail !== "low" && detail !== "high") {
      return detail;
    }
    return {
      type: "image_url",
      image_url: {
        url: imageUrl.url,
        ...(detail ? { detail } : {}),
      },
    };
  }

  return `content[${index}] has unsupported type (expected "text" or "image_url")`;
}

function parseMessageContent(
  content: unknown,
  role: string,
): ChatMessageContent | string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return "Each message 'content' must be a string or a non-empty array of content parts";
  }

  const parts: ChatContentPart[] = [];
  for (let i = 0; i < content.length; i++) {
    const parsed = parseContentPart(content[i], i);
    if (typeof parsed === "string") return parsed;
    parts.push(parsed);
  }

  const hasImage = parts.some((part) => part.type === "image_url");
  if (hasImage && role !== "user") {
    return "Image content is only allowed on user messages";
  }

  return parts;
}

export function parseChatBody(body: unknown): ChatCompletionRequest | string {
  if (typeof body !== "object" || body === null) {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;

  if (typeof b.model !== "string" || b.model.trim() === "") {
    return "Field 'model' is required and must be a non-empty string";
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return "Field 'messages' is required and must be a non-empty array";
  }

  const messages: ChatMessage[] = [];
  for (const msg of b.messages) {
    if (typeof msg !== "object" || msg === null) {
      return "Each message must be a valid object";
    }
    const m = msg as Record<string, unknown>;
    if (
      typeof m.role !== "string" ||
      !["system", "user", "assistant", "tool"].includes(m.role)
    ) {
      return "Each message must have a valid 'role' and 'content'";
    }

    if (typeof m.content === "string") {
      messages.push({ role: m.role as ChatMessage["role"], content: m.content });
      continue;
    }

    const content = parseMessageContent(m.content, m.role);
    if (typeof content === "string") {
      return content;
    }

    messages.push({ role: m.role as ChatMessage["role"], content });
  }

  if (chatMessagesHaveImageContent(messages) && !modelSupportsImageInput(b.model)) {
    const visionModels = listVisionModelAliases().join(", ");
    return `Model "${b.model}" does not support image input. Use a vision-capable model such as: ${visionModels}`;
  }

  return {
    model: b.model,
    messages,
    temperature: typeof b.temperature === "number" ? b.temperature : undefined,
    max_tokens: typeof b.max_tokens === "number" ? b.max_tokens : undefined,
    max_completion_tokens:
      typeof b.max_completion_tokens === "number"
        ? b.max_completion_tokens
        : undefined,
    stream: b.stream === true,
  };
}

export function buildChatQuote(
  body: ChatCompletionRequest,
  providers: ProviderAdapter[],
  healthStore: HealthStore,
  options: {
    marginPct: number;
    minCallUsdc: number;
    defaultMaxCompletionTokens: number;
  },
): ChatQuoteContext | string {
  const healthyProviders = providers.filter(
    (provider) => healthStore.getAll()[provider.name]?.healthy,
  );
  const entry = getModelPrice(buildPricingCatalog(healthyProviders, options.marginPct), body.model);
  if (!entry) {
    return `Model "${body.model}" is not available from healthy providers`;
  }

  const promptTokens = estimatePromptTokens(body.messages);
  const maxCompletionTokens = resolveMaxCompletionTokens(
    body.max_tokens,
    body.max_completion_tokens,
  );
  const quote = quoteCallPrice({
    listPricePer1k: entry.listPricePer1kTokens,
    promptTokens,
    maxCompletionTokens,
    minCallUsdc: options.minCallUsdc,
  });

  return {
    model: body.model,
    quote,
    listPricePer1k: entry.listPricePer1kTokens,
    provider: entry.provider,
  };
}

export function buildChatQuoteFromHttpContext(
  context: HTTPRequestContext,
  providers: ProviderAdapter[],
  healthStore: HealthStore,
  options: {
    marginPct: number;
    minCallUsdc: number;
    defaultMaxCompletionTokens: number;
  },
): ChatQuoteContext | string {
  const body = parseChatBody(context.adapter.getBody?.());
  if (typeof body === "string") return body;
  return buildChatQuote(body, providers, healthStore, options);
}

export { formatUsdPrice } from "@lmxcloud/x402";
