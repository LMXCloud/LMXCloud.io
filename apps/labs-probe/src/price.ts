/** Base mainnet. The probe never signs any other network. */
export const BASE_NETWORK = "eip155:8453";

/** Base mainnet USDC. Compared case-insensitively. */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** Hard per-call ceiling. Not configurable. */
export const MAX_CALL_USDC = 0.05;
export const MAX_CALL_ATOMIC = 50_000n;

/** Default and absolute ceilings for one probe run. */
export const DEFAULT_SPEND_CAP_USDC = 0.25;
export const HARD_SPEND_CAP_USDC = 1;

const USDC_SCALE = 1_000_000n;

export function usdcToAtomic(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }
  return BigInt(Math.round(amount * 1_000_000));
}

export function formatUsdc(atomic: bigint): string {
  const sign = atomic < 0n ? "-" : "";
  const value = atomic < 0n ? -atomic : atomic;
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

/**
 * 402 amounts are atomic token units. A decimal or `$` prefix is a dollar price.
 */
export function parseQuotedAtomic(amount: string): bigint {
  const trimmed = amount.trim();
  if (trimmed.startsWith("$") || trimmed.includes(".")) {
    const dollars = Number(trimmed.replace(/^\$/, ""));
    if (!Number.isFinite(dollars) || dollars < 0) {
      throw new Error(`Invalid 402 amount: ${amount}`);
    }
    return usdcToAtomic(dollars);
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid 402 amount: ${amount}`);
  }
  return BigInt(trimmed);
}

export function resolveSpendCap(raw: string | undefined): number {
  const value = Number(raw ?? DEFAULT_SPEND_CAP_USDC);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Spend cap must be a positive USDC amount, got ${raw ?? ""}`);
  }
  if (usdcToAtomic(value) > usdcToAtomic(HARD_SPEND_CAP_USDC)) {
    throw new Error(
      `Spend cap $${value} exceeds the hard $${HARD_SPEND_CAP_USDC} ceiling for one run`,
    );
  }
  return value;
}

interface QuotedRequirement {
  index: number;
  scheme: string;
  network: string;
  asset: string;
  atomic: bigint;
}

function readRequirement(requirement: unknown, index: number): QuotedRequirement | null {
  if (!requirement || typeof requirement !== "object") return null;
  const record = requirement as Record<string, unknown>;
  const rawAmount = record.amount ?? record.maxAmountRequired;
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") return null;
  try {
    return {
      index,
      scheme: typeof record.scheme === "string" ? record.scheme : "",
      network: typeof record.network === "string" ? record.network : "",
      asset: typeof record.asset === "string" ? record.asset : "",
      atomic: parseQuotedAtomic(String(rawAmount)),
    };
  } catch {
    return null;
  }
}

export type PriceDecision =
  | {
      ok: true;
      index: number;
      atomic: bigint;
      usdc: string;
      scheme: string;
    }
  | {
      ok: false;
      reason: string;
      quotedUsdc: string | null;
    };

export function spendCapReason(quotedUsdc: string, spentAtomic: bigint, capAtomic: bigint): string {
  return `402 price ${quotedUsdc} USDC would exceed the run spend cap (spent ${formatUsdc(spentAtomic)} of ${formatUsdc(capAtomic)})`;
}

/**
 * Accept a 402 only when one Base USDC option equals the listed price,
 * is at most $0.05, and still fits the run cap.
 * When exact and upto are both that price, exact is chosen.
 * Dry runs pass enforceSpendCap: false so a full cap is not a refusal.
 */
export function decidePayment(
  accepts: readonly unknown[],
  listedUsdc: number,
  spentAtomic: bigint,
  capAtomic: bigint,
  options?: { enforceSpendCap?: boolean },
): PriceDecision {
  const listedAtomic = usdcToAtomic(listedUsdc);
  const listedLabel = formatUsdc(listedAtomic);
  const parsed = accepts
    .map((item, index) => readRequirement(item, index))
    .filter((item): item is QuotedRequirement => item !== null);

  if (parsed.length === 0) {
    return {
      ok: false,
      quotedUsdc: null,
      reason: "402 response has no payment requirements",
    };
  }

  const baseUsdc = parsed.filter(
    (item) => item.network === BASE_NETWORK && item.asset.toLowerCase() === BASE_USDC,
  );
  if (baseUsdc.length === 0) {
    return {
      ok: false,
      quotedUsdc: formatUsdc(parsed[0]!.atomic),
      reason: "402 payment requirement is not Base mainnet USDC",
    };
  }

  const matches = baseUsdc.filter((item) => item.atomic === listedAtomic);
  const match = matches.find((item) => item.scheme === "exact") ?? matches[0];
  if (!match) {
    const quoted = baseUsdc.map((item) => formatUsdc(item.atomic)).join(", ");
    const overCap = baseUsdc.some((item) => item.atomic > MAX_CALL_ATOMIC);
    return {
      ok: false,
      quotedUsdc: formatUsdc(baseUsdc[0]!.atomic),
      reason: overCap
        ? `402 price ${quoted} USDC exceeds the $0.05 per-call cap and differs from listed ${listedLabel} USDC`
        : `402 price ${quoted} USDC differs from listed ${listedLabel} USDC`,
    };
  }

  const quotedUsdc = formatUsdc(match.atomic);
  if (match.atomic > MAX_CALL_ATOMIC) {
    return {
      ok: false,
      quotedUsdc,
      reason: `402 price ${quotedUsdc} USDC exceeds the $0.05 per-call cap`,
    };
  }
  if (options?.enforceSpendCap !== false && spentAtomic + match.atomic > capAtomic) {
    return {
      ok: false,
      quotedUsdc,
      reason: spendCapReason(quotedUsdc, spentAtomic, capAtomic),
    };
  }

  return {
    ok: true,
    index: match.index,
    atomic: match.atomic,
    usdc: quotedUsdc,
    scheme: match.scheme,
  };
}
