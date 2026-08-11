import { formatAuthError, resolveApiKey, type ResolvedApiKey } from "./auth.js";
import { logToolEvent } from "./log.js";
import { createRateLimiter } from "./rate-limit.js";

const API_BASE_URL =
  process.env.LMX_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";

export const PDF_EXTRACT_URL =
  process.env.PDF_EXTRACT_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

const toolRateLimit = createRateLimiter({
  max: Number(process.env.MCP_RATE_LIMIT_MAX ?? 60),
  windowMs: Number(process.env.MCP_RATE_LIMIT_WINDOW_MS ?? 60_000),
});

export type LmxChatResponse = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export type LmxModelsResponse = {
  object: "list";
  data: Array<{
    id: string;
    owned_by: string;
  }>;
};

export function authHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatAuthError(response.status, text || response.statusText),
      };
    }

    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}

export function pricingQuotePath(params: {
  model: string;
  max_tokens?: number;
  prompt_tokens?: number;
}): string {
  const search = new URLSearchParams({ model: params.model });
  if (params.max_tokens !== undefined) {
    search.set("max_tokens", String(params.max_tokens));
  }
  if (params.prompt_tokens !== undefined) {
    search.set("prompt_tokens", String(params.prompt_tokens));
  }
  return `/v1/pricing?${search.toString()}`;
}

export async function getSupportedModels(apiKey?: string) {
  return fetchJson<LmxModelsResponse>("/v1/models", {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(apiKey),
    },
  });
}

export function normalizeMessageContent(content: LmxChatResponse["choices"]): string {
  const raw = content?.[0]?.message?.content;
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  return raw
    .map((part) => (part?.type === "text" && part?.text ? part.text : ""))
    .join("");
}

export type ToolGuardContext = {
  tool: string;
  transport: "stdio" | "http";
  toolApiKey?: string;
  requireApiKey: boolean;
  /** When false, do not treat LMX_ADMIN_API_KEY / server LMX_API_KEY as the caller key. */
  allowAdminFallback?: boolean;
};

export function guardToolAccess(
  context: ToolGuardContext,
):
  | { ok: true; auth: Extract<ResolvedApiKey, { ok: true }> }
  | { ok: false; message: string } {
  const resolved = resolveApiKey({
    toolApiKey: context.toolApiKey,
    transport: context.transport,
    allowAdminFallback: context.allowAdminFallback ?? true,
  });

  if (!resolved.ok) {
    if (!context.requireApiKey) {
      const publicCaller = {
        ok: true as const,
        apiKey: "",
        source: "public" as const,
        callerId: "public",
      };
      const limit = toolRateLimit(publicCaller.callerId);
      if (!limit.allowed) {
        const message = `MCP rate limit exceeded. Try again in ${limit.retryAfterSec}s.`;
        return { ok: false, message };
      }
      return { ok: true, auth: publicCaller };
    }

    logToolEvent({
      tool: context.tool,
      callerId: "anonymous",
      source: "none",
      ok: false,
      detail: resolved.message,
    });
    return { ok: false, message: resolved.message };
  }

  const limit = toolRateLimit(resolved.callerId);
  if (!limit.allowed) {
    const message = `MCP rate limit exceeded for caller ${resolved.callerId}. Try again in ${limit.retryAfterSec}s.`;
    logToolEvent({
      tool: context.tool,
      callerId: resolved.callerId,
      source: resolved.source,
      ok: false,
      detail: message,
    });
    return { ok: false, message };
  }

  return { ok: true, auth: resolved };
}

export async function validateApiKey(apiKey: string): Promise<string | null> {
  const result = await fetchJson<{ object: string }>("/v1/usage", {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(apiKey),
    },
  });
  if (!result.ok) return result.error;
  return null;
}
