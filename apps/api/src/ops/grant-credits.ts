import type { ApiKeyRecord, ApiKeyStore } from "../auth/store.js";
import { normalizeWalletAddress } from "../auth/wallet.js";
import { roundCredits } from "../credits/pricing.js";
import type { CreditStore } from "../credits/store.js";

/** Fat-finger cap for manual ops grants (USD). */
export const MAX_OPS_CREDIT_GRANT = 10_000;

export type IdentifierKind = "email" | "wallet" | "api_key_id";

export type GrantCreditsInput = {
  identifier: string;
  amount: number;
};

export function parseGrantCreditsBody(
  body: unknown,
): { ok: true; value: GrantCreditsInput } | { ok: false; message: string } {
  if (body === undefined || body === null || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }

  const rec = body as Record<string, unknown>;
  const identifier =
    typeof rec.identifier === "string"
      ? rec.identifier.trim()
      : typeof rec.api_key_id === "string"
        ? rec.api_key_id.trim()
        : typeof rec.email === "string"
          ? rec.email.trim()
          : typeof rec.wallet === "string"
            ? rec.wallet.trim()
            : "";

  if (!identifier) {
    return {
      ok: false,
      message: "Provide identifier (API key id, email, or wallet)",
    };
  }

  const amount =
    typeof rec.amount === "number" ? rec.amount : Number(rec.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: "Field 'amount' must be a positive number" };
  }
  if (amount > MAX_OPS_CREDIT_GRANT) {
    return {
      ok: false,
      message: `Field 'amount' must be at most ${MAX_OPS_CREDIT_GRANT}`,
    };
  }

  return { ok: true, value: { identifier, amount } };
}

export function classifyIdentifier(identifier: string): IdentifierKind {
  const value = identifier.trim();
  if (value.includes("@")) return "email";
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return "wallet";
  return "api_key_id";
}

export async function resolveGrantTarget(
  store: ApiKeyStore,
  identifier: string,
): Promise<
  | { ok: true; record: ApiKeyRecord; kind: IdentifierKind }
  | { ok: false; status: 400 | 404; message: string }
> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { ok: false, status: 400, message: "identifier is required" };
  }

  const kind = classifyIdentifier(trimmed);

  if (kind === "email") {
    const record = await store.findPrimaryKeyForEmail(trimmed);
    if (!record) {
      return { ok: false, status: 404, message: "No account found for that email" };
    }
    return { ok: true, record, kind };
  }

  if (kind === "wallet") {
    let normalized: string;
    try {
      normalized = normalizeWalletAddress(trimmed);
    } catch {
      return { ok: false, status: 400, message: "Invalid wallet address" };
    }
    const record = await store.findPrimaryKeyForWallet(normalized);
    if (!record) {
      return { ok: false, status: 404, message: "No account found for that wallet" };
    }
    return { ok: true, record, kind };
  }

  const record = await store.findById(trimmed);
  if (!record) {
    return { ok: false, status: 404, message: "API key not found" };
  }
  return { ok: true, record, kind };
}

export async function grantOpsCredits(input: {
  apiKeyStore: ApiKeyStore;
  creditStore: CreditStore;
  identifier: string;
  amount: number;
}): Promise<
  | {
      ok: true;
      record: ApiKeyRecord;
      kind: IdentifierKind;
      credited: number;
      balance: number;
    }
  | { ok: false; status: 400 | 404; message: string }
> {
  const resolved = await resolveGrantTarget(input.apiKeyStore, input.identifier);
  if (!resolved.ok) return resolved;

  try {
    const balance = await input.creditStore.credit(
      resolved.record.id,
      input.amount,
      { source: "ops_grant" },
    );
    return {
      ok: true,
      record: resolved.record,
      kind: resolved.kind,
      credited: roundCredits(input.amount),
      balance: roundCredits(balance),
    };
  } catch (err) {
    if (err instanceof Error && err.message === "API key not found") {
      return { ok: false, status: 404, message: "API key not found" };
    }
    throw err;
  }
}
