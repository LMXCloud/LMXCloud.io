import type {
  InfraSpendSnapshot,
  OpsMcpEventDetail,
  OpsOverview,
  OpsPaymentDetail,
  OpsUsageDetail,
} from "./types";

const ENV_API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const ENV_OPS_KEY = (import.meta.env.VITE_OPS_API_KEY as string | undefined)?.trim() ?? "";

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
