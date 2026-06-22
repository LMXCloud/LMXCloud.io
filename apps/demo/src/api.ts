import type {
  ApiError,
  ChatCompletionResponse,
  LmxHeaders,
  StatusResponse,
  UsageResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    return body.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/v1/status`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<StatusResponse>;
}

export async function generateApiKey(email?: string): Promise<string> {
  const body = email?.trim() ? { email: email.trim() } : {};
  const res = await fetch(`${API_BASE}/v1/auth/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { api_key: string };
  return data.api_key;
}

export async function sendChatCompletion(
  apiKey: string,
  model: string,
  message: string,
  route: string,
): Promise<{ response: ChatCompletionResponse; headers: LmxHeaders }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (route !== "default") {
    headers["x-lmx-prefer"] = route;
  }

  const res = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) throw new Error(await parseError(res));

  const response = (await res.json()) as ChatCompletionResponse;
  return {
    response,
    headers: {
      provider: res.headers.get("x-lmx-provider") ?? "unknown",
      fallback: res.headers.get("x-lmx-fallback") === "true",
      latencyMs: Number(res.headers.get("x-lmx-latency") ?? 0),
    },
  };
}

export async function fetchUsage(apiKey: string): Promise<UsageResponse> {
  const res = await fetch(`${API_BASE}/v1/usage`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<UsageResponse>;
}

export { API_BASE };
