import { BASE_NETWORK, BASE_USDC, formatUsdc, parseQuotedAtomic, usdcToAtomic } from "./price.js";

export interface ListingDrift {
  field: "price" | "payTo" | "scheme" | "asset" | "network" | "x402Version" | "mimeType";
  listed: string | number | null;
  live: string | number | null;
  /** Set when a named payTo is no longer the live payee. */
  severity?: "high";
}

export interface ListedOffer {
  price: number | null;
  payTo?: string | null;
  scheme?: string | null;
  asset?: string | null;
  network?: string | null;
  x402Version?: number | null;
  mimeType?: string | null;
}

export interface LiveOffer {
  priceAtomic: bigint | null;
  payTo: string | null;
  scheme: string | null;
  asset: string | null;
  network: string | null;
  x402Version: number | null;
  mimeType: string | null;
}

export interface RecordedListingFields {
  payTo: boolean;
  scheme: boolean;
  asset: boolean;
  network: boolean;
  x402Version: boolean;
  mimeType: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function same(left: string | null, right: string | null): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

function isBaseUsdc(accept: Record<string, unknown>): boolean {
  const asset = text(accept.asset);
  return accept.network === BASE_NETWORK && asset !== null && asset.toLowerCase() === BASE_USDC;
}

/** Base USDC exact, else any Base USDC, else the first accept. */
function pickAccept(accepts: Record<string, unknown>[]): Record<string, unknown> | null {
  if (accepts.length === 0) return null;
  const base = accepts.filter(isBaseUsdc);
  const pool = base.length > 0 ? base : accepts;
  return pool.find((accept) => accept.scheme === "exact") ?? pool[0] ?? null;
}

export function emptyLiveOffer(): LiveOffer {
  return {
    priceAtomic: null,
    payTo: null,
    scheme: null,
    asset: null,
    network: null,
    x402Version: null,
    mimeType: null,
  };
}

/** Terms from a 402 body. Prefers the Base USDC exact accept. */
export function liveOffer(payment: unknown): LiveOffer {
  if (!isRecord(payment)) return emptyLiveOffer();
  const accepts = Array.isArray(payment.accepts) ? payment.accepts.filter(isRecord) : [];
  const chosen = pickAccept(accepts);
  const resourceMime = isRecord(payment.resource) ? text(payment.resource.mimeType) : null;
  let priceAtomic: bigint | null = null;
  if (chosen) {
    const raw = chosen.amount ?? chosen.maxAmountRequired;
    if (typeof raw === "string" || typeof raw === "number") {
      try {
        priceAtomic = parseQuotedAtomic(String(raw));
      } catch {
        priceAtomic = null;
      }
    }
  }
  return {
    priceAtomic,
    payTo: chosen ? text(chosen.payTo) : null,
    scheme: chosen ? text(chosen.scheme) : null,
    asset: chosen ? text(chosen.asset) : null,
    network: chosen ? text(chosen.network) : null,
    x402Version: typeof payment.x402Version === "number" ? payment.x402Version : null,
    mimeType: resourceMime ?? (chosen ? text(chosen.mimeType) : null),
  };
}

function pushText(
  drift: ListingDrift[],
  field: ListingDrift["field"],
  recorded: boolean,
  listed: string | null | undefined,
  live: string | null,
): void {
  if (!recorded) return;
  const listedText = text(listed);
  const liveText = text(live);
  if (!listedText || !liveText || same(listedText, liveText)) return;
  const item: ListingDrift = { field, listed: listedText, live: liveText };
  if (field === "payTo") item.severity = "high";
  drift.push(item);
}

/**
 * Differences between the stored listing and the live 402.
 * A field is drift only when both sides have a value and they differ.
 * A null or absent listing value is not drift. A payTo that names a different
 * address is high severity.
 */
export function compareListing(
  listed: ListedOffer,
  live: LiveOffer,
  recorded: RecordedListingFields,
): ListingDrift[] {
  const drift: ListingDrift[] = [];
  const listedPrice = listed.price === null ? null : formatUsdc(usdcToAtomic(listed.price));
  const livePrice = live.priceAtomic === null ? null : formatUsdc(live.priceAtomic);
  if (listedPrice !== null && livePrice !== null && listedPrice !== livePrice) {
    drift.push({ field: "price", listed: listedPrice, live: livePrice });
  }
  pushText(drift, "payTo", recorded.payTo, listed.payTo, live.payTo);
  pushText(drift, "scheme", recorded.scheme, listed.scheme, live.scheme);
  pushText(drift, "asset", recorded.asset, listed.asset, live.asset);
  pushText(drift, "network", recorded.network, listed.network, live.network);
  pushText(drift, "mimeType", recorded.mimeType, listed.mimeType, live.mimeType);
  if (
    recorded.x402Version
    && listed.x402Version != null
    && live.x402Version != null
    && listed.x402Version !== live.x402Version
  ) {
    drift.push({
      field: "x402Version",
      listed: listed.x402Version,
      live: live.x402Version,
    });
  }
  return drift;
}
