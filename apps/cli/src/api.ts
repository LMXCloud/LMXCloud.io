import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ErrorResponse,
} from "@lmxcloud/shared";

import type { BalanceResponse, LoginResponse, UsageResponse } from "./types.js";

export interface LmxHeaders {
  provider: string;
  fallback: boolean;
  latencyMs: number;
  cost: number;
  balance: number;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ErrorResponse;
    return body.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function generateDemoKey(
  apiUrl: string,
  email?: string,
): Promise<{ apiKey: string; balance: number }> {
  const body = email?.trim() ? { email: email.trim() } : {};
  const res = await fetch(`${apiUrl}/v1/auth/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { api_key: string; balance: number };
  return { apiKey: data.api_key, balance: data.balance };
}

export async function loginWithEmail(apiUrl: string, email: string): Promise<LoginResponse> {
  const res = await fetch(`${apiUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<LoginResponse>;
}

export async function fetchBalance(apiUrl: string, token: string): Promise<BalanceResponse> {
  const res = await fetch(`${apiUrl}/v1/balance`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<BalanceResponse>;
}

export async function fetchUsage(apiUrl: string, token: string): Promise<UsageResponse> {
  const res = await fetch(`${apiUrl}/v1/usage`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<UsageResponse>;
}

export async function sendChatCompletion(
  apiUrl: string,
  token: string,
  model: string,
  messages: ChatMessage[],
  prefer?: string,
): Promise<{ response: ChatCompletionResponse; headers: LmxHeaders }> {
  const headers: Record<string, string> = {
    ...authHeaders(token),
    "Content-Type": "application/json",
  };
  if (prefer?.trim()) {
    headers["x-lmx-prefer"] = prefer.trim();
  }

  const body: ChatCompletionRequest = {
    model,
    messages,
    stream: false,
  };

  const res = await fetch(`${apiUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await parseError(res));

  const response = (await res.json()) as ChatCompletionResponse;
  return {
    response,
    headers: {
      provider: res.headers.get("x-lmx-provider") ?? "unknown",
      fallback: res.headers.get("x-lmx-fallback") === "true",
      latencyMs: Number(res.headers.get("x-lmx-latency") ?? 0),
      cost: Number(res.headers.get("x-lmx-cost") ?? 0),
      balance: Number(res.headers.get("x-lmx-balance") ?? 0),
    },
  };
}
