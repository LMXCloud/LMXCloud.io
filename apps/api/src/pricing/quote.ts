import type { ChatMessageContent } from "@lmxcloud/shared";
import { roundCredits } from "../credits/pricing.js";
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  MIN_CALL_USDC,
} from "./constants.js";

/** Conservative per-image token floor for x402 ceiling quotes (high-detail-ish). */
export const ESTIMATED_IMAGE_TOKENS = 765;

export interface QuoteInput {
  listPricePer1k: number;
  promptTokens: number;
  maxCompletionTokens?: number;
  minCallUsdc?: number;
}

export interface QuoteResult {
  estimatedTokens: number;
  quotedAmount: number;
  promptTokens: number;
  maxCompletionTokens: number;
}

function contentCharLength(content: ChatMessageContent): number {
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    return sum;
  }, 0);
}

function contentImageCount(content: ChatMessageContent): number {
  if (typeof content === "string") return 0;
  return content.filter((part) => part.type === "image_url").length;
}

/** Rough token estimate from message text (~4 chars/token) plus a per-image floor. */
export function estimatePromptTokens(
  messages: Array<{ content: ChatMessageContent }>,
): number {
  const chars = messages.reduce(
    (sum, message) => sum + contentCharLength(message.content),
    0,
  );
  const images = messages.reduce(
    (sum, message) => sum + contentImageCount(message.content),
    0,
  );
  return Math.max(1, Math.ceil(chars / 4) + images * ESTIMATED_IMAGE_TOKENS);
}

export function resolveMaxCompletionTokens(
  maxTokens?: number,
  maxCompletionTokens?: number,
): number {
  if (typeof maxCompletionTokens === "number" && maxCompletionTokens > 0) {
    return maxCompletionTokens;
  }
  if (typeof maxTokens === "number" && maxTokens > 0) {
    return maxTokens;
  }
  return DEFAULT_MAX_COMPLETION_TOKENS;
}

/** Ceiling quote for an x402 call before inference runs. */
export function quoteCallPrice(input: QuoteInput): QuoteResult {
  const maxCompletionTokens =
    input.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  const minCallUsdc = input.minCallUsdc ?? MIN_CALL_USDC;
  const estimatedTokens = input.promptTokens + maxCompletionTokens;
  const raw = (estimatedTokens / 1000) * input.listPricePer1k;
  const quotedAmount = roundCredits(Math.max(minCallUsdc, raw));

  return {
    estimatedTokens,
    quotedAmount,
    promptTokens: input.promptTokens,
    maxCompletionTokens,
  };
}
