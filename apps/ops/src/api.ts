import type {
  OpsMcpEventDetail,
  OpsOverview,
  OpsPaymentDetail,
  OpsUsageDetail,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const ENV_OPS_KEY = (import.meta.env.VITE_OPS_API_KEY as string | undefined)?.trim() ?? "";

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

export function getApiBase(): string {
  return API_BASE;
}

async function opsFetch<T>(opsKey: string, path: string): Promise<T> {
  if (!API_BASE) {
    throw new Error("VITE_API_URL is not set");
  }
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
