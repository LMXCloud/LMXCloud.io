import type {
  InfraSpendSnapshot,
  OpsMcpEventDetail,
  OpsNotificationsResponse,
  OpsNotification,
  OpsOverview,
  OpsPaymentDetail,
  OpsUsageDetail,
} from "./types";

const ENV_API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const ENV_OPS_KEY = (import.meta.env.VITE_OPS_API_KEY as string | undefined)?.trim() ?? "";
const ENV_GRID_KEY =
  (import.meta.env.VITE_OPS_GRID_API_KEY as string | undefined)?.trim() ?? "";

function isLoopbackApi(url: string): boolean {
  if (!url) return true;
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Same-origin in `vite dev` so Chrome does not block :5175 → :3000 as a local-network fetch. */
const API_BASE =
  import.meta.env.DEV && isLoopbackApi(ENV_API_BASE) ? "" : ENV_API_BASE;

const OPS_KEY_STORAGE = "lmx_ops_api_key";

export function getEnvOpsKey(): string {
  return ENV_OPS_KEY;
}

export function getStoredOpsKey(): string {
  try {
    return localStorage.getItem(OPS_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

/** Prefer browser override, then Vite env (local auto-connect). */
export function resolveOpsKey(): string {
  return getStoredOpsKey() || ENV_OPS_KEY;
}

export function setStoredOpsKey(key: string): void {
  try {
    if (key) localStorage.setItem(OPS_KEY_STORAGE, key);
    else localStorage.removeItem(OPS_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

const GRID_KEY_STORAGE = "lmx_ops_grid_api_key";

/** How long we wait on Grid before giving the form back for manual writing. */
export const CHAT_TIMEOUT_MS = 60_000;

export function getEnvOpsGridKey(): string {
  return ENV_GRID_KEY;
}

export function getStoredOpsGridKey(): string {
  try {
    return localStorage.getItem(GRID_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

/** Prefer browser override, then Vite env (local auto-connect). Same pattern as the ops key. */
export function resolveOpsGridKey(): string {
  return getStoredOpsGridKey() || ENV_GRID_KEY;
}

export function setStoredOpsGridKey(key: string): void {
  try {
    if (key) localStorage.setItem(GRID_KEY_STORAGE, key);
    else localStorage.removeItem(GRID_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function getApiBase(): string {
  return ENV_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:3000" : "");
}

function requireApiBase(): void {
  if (!API_BASE && !import.meta.env.DEV) {
    throw new Error("VITE_API_URL is not set");
  }
}

async function opsFetch<T>(opsKey: string, path: string): Promise<T> {
  requireApiBase();
  if (!opsKey) {
    throw new Error("Ops API key required");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${opsKey}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function fetchOpsOverview(
  opsKey: string,
  opts: { days?: number; limit?: number } = {},
): Promise<OpsOverview> {
  const params = new URLSearchParams();
  if (opts.days) params.set("days", String(opts.days));
  if (opts.limit) params.set("limit", String(opts.limit));

  const query = params.size ? `?${params}` : "";
  return opsFetch<OpsOverview>(opsKey, `/v1/ops/overview${query}`);
}

export async function fetchOpsPayment(
  opsKey: string,
  id: string,
): Promise<OpsPaymentDetail> {
  return opsFetch<OpsPaymentDetail>(
    opsKey,
    `/v1/ops/payments/${encodeURIComponent(id)}`,
  );
}

export async function fetchOpsUsage(
  opsKey: string,
  id: string,
): Promise<OpsUsageDetail> {
  return opsFetch<OpsUsageDetail>(
    opsKey,
    `/v1/ops/usage/${encodeURIComponent(id)}`,
  );
}

export async function fetchOpsMcpEvent(
  opsKey: string,
  id: string,
): Promise<OpsMcpEventDetail> {
  return opsFetch<OpsMcpEventDetail>(
    opsKey,
    `/v1/ops/mcp-events/${encodeURIComponent(id)}`,
  );
}

export async function grantOpsCredits(
  opsKey: string,
  body: { identifier: string; amount: number },
): Promise<{
  object: string;
  api_key_id: string;
  email: string | null;
  wallet: string | null;
  identifier_kind: string;
  credited: number;
  balance: number;
  currency: string;
}> {
  requireApiBase();
  if (!opsKey) {
    throw new Error("Ops API key required");
  }

  const res = await fetch(`${API_BASE}/v1/ops/credits`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opsKey}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as {
    object: string;
    api_key_id: string;
    email: string | null;
    wallet: string | null;
    identifier_kind: string;
    credited: number;
    balance: number;
    currency: string;
  };
}

export async function executeOpsReconciliation(
  opsKey: string,
  id: string,
): Promise<{ object: string; status: string; refundTxHash: string | null }> {
  requireApiBase();
  if (!opsKey) {
    throw new Error("Ops API key required");
  }

  const res = await fetch(
    `${API_BASE}/v1/ops/reconciliation/${encodeURIComponent(id)}/execute`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${opsKey}`,
        accept: "application/json",
      },
    },
  );

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as {
    object: string;
    status: string;
    refundTxHash: string | null;
  };
}

export async function fetchInfraSpend(
  opsKey: string,
  opts: { months?: number } = {},
): Promise<InfraSpendSnapshot> {
  const params = new URLSearchParams();
  if (opts.months) params.set("months", String(opts.months));
  const query = params.size ? `?${params}` : "";
  return opsFetch<InfraSpendSnapshot>(opsKey, `/v1/ops/infra-spend${query}`);
}

export async function logInfraSpend(
  opsKey: string,
  body: {
    service: string;
    amount: number;
    date: string;
    note?: string;
    kind?: "spend" | "balance" | "note";
  },
): Promise<InfraSpendSnapshot["entries"][number]> {
  requireApiBase();
  if (!opsKey) {
    throw new Error("Ops API key required");
  }

  const res = await fetch(`${API_BASE}/v1/ops/infra-spend`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opsKey}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as InfraSpendSnapshot["entries"][number];
}

async function opsMutate<T>(
  opsKey: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  requireApiBase();
  if (!opsKey) {
    throw new Error("Ops API key required");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${opsKey}`,
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function fetchOpsNotifications(
  opsKey: string,
): Promise<OpsNotificationsResponse> {
  return opsFetch<OpsNotificationsResponse>(opsKey, "/v1/ops/notifications");
}

export async function createOpsNotification(
  opsKey: string,
  body: {
    kind: "product_update" | "company_update";
    title: string;
    body: string;
    href?: string;
    hrefLabel?: string;
    visibleAt?: string;
    expiresAt?: string;
  },
): Promise<OpsNotification> {
  return opsMutate<OpsNotification>(opsKey, "/v1/ops/notifications", "POST", body);
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResponse = {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type LmxChatHeaders = {
  provider: string;
  fallback: boolean;
  latencyMs: number;
  cost: number;
  balance: number;
};

export type LmxStreamMeta = LmxChatHeaders & {
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

async function readResponseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? "Grid returned an empty response"
        : `Request failed (${res.status})`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      res.ok
        ? "Grid returned a non-JSON response"
        : `Request failed (${res.status})`,
    );
  }
}

async function parseChatError(res: Response): Promise<string> {
  try {
    const body = (await readResponseJson(res)) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch (err) {
    if (err instanceof Error && err.message) return err.message;
  }
  return `Request failed (${res.status})`;
}

function chatHeaders(res: Response): LmxChatHeaders {
  return {
    provider: res.headers.get("x-lmx-provider") ?? "unknown",
    fallback: res.headers.get("x-lmx-fallback") === "true",
    latencyMs: Number(res.headers.get("x-lmx-latency") ?? 0),
    cost: Number(res.headers.get("x-lmx-cost") ?? 0),
    balance: Number(res.headers.get("x-lmx-balance") ?? 0),
  };
}

/** Balance-funded `/v1/chat/completions` — same path as ConsoleChat, not x402. */
export async function sendChatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ response: ChatCompletionResponse; headers: LmxChatHeaders }> {
  requireApiBase();
  if (!apiKey) throw new Error("Ops Grid API key required");

  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal,
  });

  if (!res.ok) throw new Error(await parseChatError(res));

  const response = (await readResponseJson(res)) as ChatCompletionResponse;
  return { response, headers: chatHeaders(res) };
}

export async function streamChatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: {
    onToken: (token: string) => void;
    onMeta?: (meta: LmxStreamMeta) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  requireApiBase();
  if (!apiKey) throw new Error("Ops Grid API key required");

  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) throw new Error(await parseChatError(res));
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
          message?: unknown;
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
          handlers.onMeta?.({
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
            typeof parsed.message === "string" ? parsed.message : "Streaming error";
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
