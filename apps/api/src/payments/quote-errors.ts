import { ModelNotSupportedError } from "../providers/types.js";

/**
 * Expected client-side quote / request failures on POST /v1/chat/completions.
 * Thrown from the x402 price callback so Fastify can return 400 instead of a
 * generic 500 (Sentry NODE-FASTIFY-2). Distinct subclasses fingerprint separately.
 */
export class ChatQuoteError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly code: string;
  readonly param?: string;

  constructor(
    message: string,
    code: string,
    options?: { statusCode?: number; type?: string; param?: string },
  ) {
    super(message);
    this.name = "ChatQuoteError";
    this.code = code;
    this.statusCode = options?.statusCode ?? 400;
    this.type = options?.type ?? "invalid_request_error";
    this.param = options?.param;
  }
}

export class InvalidChatRequestError extends ChatQuoteError {
  constructor(message: string, code = "invalid_request") {
    super(message, code);
    this.name = "InvalidChatRequestError";
  }
}

/** Catalog model whose only providers are currently unhealthy. */
export class ModelUnavailableError extends ChatQuoteError {
  constructor(public readonly model: string) {
    super(`Model "${model}" is not available from healthy providers`, "model_unavailable", {
      param: "model",
    });
    this.name = "ModelUnavailableError";
  }
}

export type ChatQuoteFailure = ChatQuoteError | ModelNotSupportedError;

const QUOTE_FAILURE_NAMES = new Set([
  "ChatQuoteError",
  "InvalidChatRequestError",
  "ModelUnavailableError",
  "ModelNotSupportedError",
]);

export function isChatQuoteFailure(value: unknown): value is ChatQuoteFailure {
  if (value instanceof ChatQuoteError || value instanceof ModelNotSupportedError) {
    return true;
  }
  if (typeof value !== "object" || value === null) return false;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && QUOTE_FAILURE_NAMES.has(name);
}

export function quoteFailureStatusCode(error: ChatQuoteFailure): number {
  return typeof error.statusCode === "number" ? error.statusCode : 400;
}

export function quoteFailurePayload(error: ChatQuoteFailure): {
  message: string;
  type: string;
  code: string;
  param?: string;
} {
  return {
    message: error.message,
    type: error.type || "invalid_request_error",
    code: error.code || "invalid_request",
    ...(error.param ? { param: error.param } : {}),
  };
}
