import type {
  ApiError,
  BalanceResponse,
  CreateKeyResponse,
  DepositInfoResponse,
  DepositHistoryResponse,
  KeysResponse,
  LoginResponse,
  PaymentsResponse,
  UsageHistoryResponse,
  UsageLogsResponse,
  UsageResponse,
  WalletLinkResponse,
  WalletNonceResponse,
} from "./types";



function normalizeApiBase(url: string | undefined): string {
  const trimmed = (url ?? "http://localhost:3000").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL);



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
    headers: {
      Authorization: `Bearer ${clerkToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<LoginResponse>;
}

export async function fetchWalletNonce(address: string): Promise<WalletNonceResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/wallet/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<WalletNonceResponse>;
}

export async function exchangeWalletSession(
  message: string,
  signature: string,
): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/wallet/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<LoginResponse>;
}

export async function linkWalletToSession(
  token: string,
  message: string,
  signature: string,
): Promise<WalletLinkResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/wallet/link`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<WalletLinkResponse>;
}

export async function fetchDepositInfo(token: string): Promise<DepositInfoResponse> {
  const res = await fetch(`${API_BASE}/v1/billing/deposit-info`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<DepositInfoResponse>;
}

export async function fetchDepositHistory(token: string): Promise<DepositHistoryResponse> {
  const res = await fetch(`${API_BASE}/v1/billing/deposits`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<DepositHistoryResponse>;
}

export async function fetchPayments(
  token: string,
  options: { limit?: number; cursor?: string; days?: number } = {},
): Promise<PaymentsResponse> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.days !== undefined) params.set("days", String(options.days));
  const query = params.toString();

  const res = await fetch(
    `${API_BASE}/v1/billing/payments${query ? `?${query}` : ""}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<PaymentsResponse>;
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



/** Create a key linked to the signed-in account (console). */
export async function createAccountApiKey(sessionToken: string): Promise<CreateKeyResponse> {
  const res = await fetch(`${API_BASE}/v1/auth/keys`, {
    method: "POST",
    headers: {
      ...authHeaders(sessionToken),
      "Content-Type": "application/json",
    },
    body: "{}",
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



export async function fetchUsageLogs(

  token: string,

  options: { limit?: number; cursor?: string; days?: number } = {},

): Promise<UsageLogsResponse> {

  const params = new URLSearchParams();

  if (options.limit !== undefined) params.set("limit", String(options.limit));

  if (options.cursor) params.set("cursor", options.cursor);

  if (options.days !== undefined) params.set("days", String(options.days));

  const query = params.toString();

  const res = await fetch(

    `${API_BASE}/v1/usage/logs${query ? `?${query}` : ""}`,

    { headers: authHeaders(token) },

  );

  if (!res.ok) throw new Error(await parseError(res));

  return res.json() as Promise<UsageLogsResponse>;

}

export async function fetchUsageLogProof(
  token: string,
  logId: string,
): Promise<UsageLogProofResponse> {
  const res = await fetch(`${API_BASE}/v1/usage/logs/${logId}/proof`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<UsageLogProofResponse>;
}



export interface ProviderStatusInfo {
  healthy: boolean;
  latency: number | null;
  tier: number;
  is_depin: boolean;
  last_check: number | null;
}

export interface StatusAnchoringInfo {
  enabled: boolean;
  chain_id?: number;
  contract_address?: string;
  recent_roots?: Array<{
    root: string;
    tx_hash: string | null;
    event_count: number;
    anchored_at: string | null;
  }>;
}

export interface StatusReliabilityInfo {
  window_days: number;
  overall: {
    attempts: number;
    successes: number;
    failures: number;
    success_rate: number;
    avg_latency_ms: number | null;
    avg_unit_price: number | null;
  };
  by_provider: Array<{
    resource_type: string;
    provider: string;
    attempts: number;
    successes: number;
    failures: number;
    success_rate: number;
    avg_latency_ms: number | null;
    avg_unit_price: number | null;
  }>;
}

export interface StatusResponse {
  object: "status";
  providers: Record<string, ProviderStatusInfo>;
  fallback_chain: string[];
  anchoring: StatusAnchoringInfo;
  reliability?: StatusReliabilityInfo;
}

export interface UsageLogProofResponse {
  object: "usage_log_proof";
  log_id: string;
  status: "no_receipt" | "pending" | "anchored";
  anchoring_enabled?: boolean;
  receipt_version: string;
  receipt: Record<string, unknown> | null;
  receipt_hash: string | null;
  leaf_index: number | null;
  merkle_proof: string[] | null;
  merkle_root: string | null;
  anchor: {
    chain_id: number;
    contract_address: string;
    tx_hash: string;
    block_number: string | null;
    anchored_at: string | null;
  } | null;
}

export interface ModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: "list";
  data: ModelInfo[];
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/v1/status`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<StatusResponse>;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${API_BASE}/v1/models`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<ModelsResponse>;
}

export interface PricingModelEntry {
  id: string;
  provider: string;
  list_price_per_1k_tokens: string;
  cost_price_per_1k_tokens: string;
}

export interface PricingCatalogResponse {
  currency: string;
  network: string;
  min_call_usdc: string;
  default_max_completion_tokens: number;
  models: PricingModelEntry[];
}

export async function fetchPricing(): Promise<PricingCatalogResponse> {
  const res = await fetch(`${API_BASE}/v1/pricing`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<PricingCatalogResponse>;
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

export interface LmxStreamMeta extends LmxChatHeaders {
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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

export async function streamChatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: {
    onToken: (token: string) => void;
    onMeta: (meta: LmxStreamMeta) => void;
  },
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) throw new Error(await parseError(res));
  if (!res.body) throw new Error("Streaming not supported by this environment");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");

      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = frame.split("\n").map((line) => line.trim());
        const dataLines: string[] = [];
        eventName = "message";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const rawData = dataLines.join("\n");
        if (!rawData) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        if (rawData === "[DONE]") {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        const parsed = JSON.parse(rawData) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
          provider?: string;
          fallback?: boolean;
          latencyMs?: number;
          cost?: number;
          balance?: number;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        };

        if (eventName === "lmx.meta" && parsed.usage) {
          handlers.onMeta({
            provider: parsed.provider ?? "unknown",
            fallback: parsed.fallback ?? false,
            latencyMs: parsed.latencyMs ?? 0,
            cost: parsed.cost ?? 0,
            balance: parsed.balance ?? 0,
            usage: parsed.usage,
          });
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        if (eventName === "lmx.error") {
          const message =
            typeof (parsed as { message?: unknown }).message === "string"
              ? ((parsed as { message: string }).message ?? "Streaming error")
              : "Streaming error";
          throw new Error(message);
        }

        const token = parsed.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token.length > 0) {
          handlers.onToken(token);
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}


