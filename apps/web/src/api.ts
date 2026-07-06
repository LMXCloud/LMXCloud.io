import type {

  ApiError,

  BalanceResponse,

  CreateKeyResponse,

  KeysResponse,

  LoginResponse,

  UsageHistoryResponse,

  UsageResponse,

} from "./types";



export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";



async function parseError(res: Response): Promise<string> {

  try {

    const body = (await res.json()) as ApiError;

    return body.error?.message ?? `Request failed (${res.status})`;

  } catch {

    return `Request failed (${res.status})`;

  }

}



function authHeaders(token: string): HeadersInit {

  return { Authorization: `Bearer ${token}` };

}



export async function checkAccountExists(email: string): Promise<boolean> {

  const res = await fetch(

    `${API_BASE}/v1/auth/account?email=${encodeURIComponent(email.trim())}`,

  );

  if (!res.ok) throw new Error(await parseError(res));

  const data = (await res.json()) as { exists: boolean };

  return data.exists;

}



export async function exchangeClerkSession(clerkToken: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/clerk`, {
    method: "POST",
    headers: { Authorization: `Bearer ${clerkToken}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<LoginResponse>;
}

export async function loginWithEmail(email: string): Promise<LoginResponse> {

  const res = await fetch(`${API_BASE}/v1/auth/login`, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({ email: email.trim() }),

  });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<LoginResponse>;

}



export async function validateSession(token: string): Promise<UsageResponse> {

  const res = await fetch(`${API_BASE}/v1/usage`, { headers: authHeaders(token) });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<UsageResponse>;

}



export async function fetchKeys(token: string): Promise<KeysResponse> {

  const res = await fetch(`${API_BASE}/v1/auth/keys`, { headers: authHeaders(token) });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<KeysResponse>;

}



export async function createApiKey(email?: string): Promise<CreateKeyResponse> {

  const body = email?.trim() ? { email: email.trim() } : {};

  const res = await fetch(`${API_BASE}/v1/auth/key`, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify(body),

  });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<CreateKeyResponse>;

}



export async function revokeApiKey(token: string, id?: string): Promise<void> {

  const res = await fetch(`${API_BASE}/v1/auth/key`, {

    method: "DELETE",

    headers: {

      ...authHeaders(token),

      "Content-Type": "application/json",

    },

    body: id ? JSON.stringify({ id }) : undefined,

  });

  if (!res.ok) throw new Error(await parseError(res));

}



export async function fetchBalance(token: string): Promise<BalanceResponse> {

  const res = await fetch(`${API_BASE}/v1/balance`, { headers: authHeaders(token) });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<BalanceResponse>;

}



export async function topUpCredits(token: string, amount: number): Promise<BalanceResponse> {

  const res = await fetch(`${API_BASE}/v1/credits/topup`, {

    method: "POST",

    headers: {

      ...authHeaders(token),

      "Content-Type": "application/json",

    },

    body: JSON.stringify({ amount }),

  });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<BalanceResponse>;

}



export async function fetchUsageHistory(

  token: string,

  days = 7,

): Promise<UsageHistoryResponse> {

  const res = await fetch(`${API_BASE}/v1/usage/history?days=${days}`, {

    headers: authHeaders(token),

  });

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<UsageHistoryResponse>;

}



export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LmxChatHeaders {
  provider: string;
  fallback: boolean;
  latencyMs: number;
  cost: number;
  balance: number;
}

export async function sendChatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<{ response: ChatCompletionResponse; headers: LmxChatHeaders }> {
  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: false }),
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


