import { parseSettlementProofKey } from "@lmxcloud/api/anchors/lookup";
import {
  verifySettlementProof,
  type SettlementProofResponse,
  type VerificationResult,
} from "./verify";

const ENV_API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

function isLoopbackApi(url: string): boolean {
  if (!url) return true;
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Same-origin in `vite dev` so the browser does not cross from the page to :3000. */
export const API_BASE =
  import.meta.env.DEV && isLoopbackApi(ENV_API_BASE)
    ? ""
    : ENV_API_BASE || "https://api.lmxcloud.io";

export class ProofLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofLookupError";
  }
}

export function lookupError(input: string): string | null {
  if (parseSettlementProofKey(input)) return null;
  return "Enter a settlement id or a receipt hash (0x…).";
}

function isProofResponse(value: unknown): value is SettlementProofResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as SettlementProofResponse;
  return body.object === "settlement_receipt_proof" && typeof body.status === "string";
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function verifySettlement(input: string): Promise<VerificationResult> {
  const key = parseSettlementProofKey(input);
  if (!key) {
    throw new ProofLookupError("Enter a settlement id or a receipt hash (0x…).");
  }

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/v1/settlements/${encodeURIComponent(key.value)}/proof`,
    );
  } catch {
    throw new ProofLookupError("Could not reach the API.");
  }

  if (!res.ok) {
    throw new ProofLookupError(await parseError(res));
  }

  const body: unknown = await res.json();
  if (!isProofResponse(body)) {
    throw new ProofLookupError("Unexpected response from the API.");
  }

  return verifySettlementProof(body);
}
