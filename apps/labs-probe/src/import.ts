import { BASE_NETWORK, BASE_USDC, formatUsdc, parseQuotedAtomic } from "./price.js";
import { discoveryOutput, type JsonSchema } from "./schema.js";

export const DISCOVERY_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

const PAGE_SIZE = 100;

export interface DiscoveryPage {
  items?: unknown[];
  pagination?: { limit?: number; offset?: number; total?: number };
}

export interface ImportedTarget {
  id: string;
  url: string;
  method: string;
  /** Null when the listing has no Base USDC price. Never 0 as a stand-in. */
  listedPriceUsdc: number | null;
  x402Version: number | null;
  payTo: string | null;
  scheme: string | null;
  asset: string | null;
  network: string | null;
  mimeType: string | null;
  source: "bazaar";
  importStatus?: "unmatched" | "v1-only" | "price-unknown";
  body?: unknown;
  query?: Record<string, string>;
  outputExample?: unknown;
  listingOutputSchema?: JsonSchema;
  domain?: string;
  pathFilter?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeHost(domain: string): string {
  const trimmed = domain.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw new Error(`Invalid domain: ${domain}`);
  }
  host = host.replace(/\.$/, "").toLowerCase();
  if (!host) throw new Error(`Invalid domain: ${domain}`);
  return host;
}

function hostOf(resource: string): string | null {
  try {
    return new URL(resource).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(resource: string): string {
  try {
    const url = new URL(resource);
    return `${url.pathname}${url.search}`;
  } catch {
    return resource;
  }
}

export function targetKey(resourceUrl: string, method: string): string {
  const url = new URL(resourceUrl);
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  const path = url.pathname.replace(/\/$/, "") || "/";
  return `${method.toUpperCase()} ${host}${path}`;
}

interface ChosenAccept {
  atomic: bigint | null;
  payTo: string | null;
  scheme: string | null;
  asset: string | null;
  network: string | null;
  mimeType: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readAccept(accept: Record<string, unknown>): ChosenAccept {
  const raw = accept.amount ?? accept.maxAmountRequired;
  let atomic: bigint | null = null;
  if (typeof raw === "string" || typeof raw === "number") {
    try {
      atomic = parseQuotedAtomic(String(raw));
    } catch {
      atomic = null;
    }
  }
  return {
    atomic,
    payTo: textOrNull(accept.payTo),
    scheme: textOrNull(accept.scheme),
    asset: textOrNull(accept.asset),
    network: textOrNull(accept.network),
    mimeType: textOrNull(accept.mimeType),
  };
}

function isBaseUsdc(accept: ChosenAccept): boolean {
  return accept.network === BASE_NETWORK && accept.asset !== null && accept.asset.toLowerCase() === BASE_USDC && accept.atomic !== null;
}

/**
 * Price comes only from a Base USDC accept.
 * When the listing has none, the first accept's payTo, scheme, asset, network,
 * and mimeType are still kept so a dry run can diff them. The price stays null.
 */
function chosenAccept(accepts: unknown[]): ChosenAccept {
  const parsed = accepts.filter(isRecord).map(readAccept);
  const base = parsed.filter(isBaseUsdc);
  const pool = base.length > 0 ? base : parsed;
  const chosen = pool.find((item) => item.scheme === "exact") ?? pool[0];
  if (!chosen) {
    return { atomic: null, payTo: null, scheme: null, asset: null, network: null, mimeType: null };
  }
  return {
    ...chosen,
    atomic: isBaseUsdc(chosen) ? chosen.atomic : null,
  };
}

function listedPriceUsdc(atomic: bigint): number {
  return Number(formatUsdc(atomic));
}

const DESCRIPTIVE_PARAM = /\b(example|placeholder|your[-\s]|description|wallet address|evm wallet|string|integer|number|boolean|param(?:eter)?|replace(?:\s+it)?|sample|todo|changeme|address here)\b/i;

/**
 * A concrete example: a number, a boolean, or a string that is a value rather than a description.
 * Schema objects count only when they carry an example, default, or const that is itself concrete.
 */
export function concreteParamText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /\s/.test(text) || DESCRIPTIVE_PARAM.test(text) || /^[:{]/.test(text)) return null;
    return text;
  }
  if (!isRecord(value)) return null;
  for (const key of ["example", "default", "const", "value"]) {
    if (!(key in value)) continue;
    const found = concreteParamText(value[key]);
    if (found) return found;
  }
  return null;
}

function queryRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const query: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const text = concreteParamText(item);
    if (text === null) continue;
    query[key] = text;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

function applyPathParams(resource: string, pathParams: unknown): string {
  if (!isRecord(pathParams)) return resource;
  let next = resource;
  for (const [key, value] of Object.entries(pathParams)) {
    const text = concreteParamText(value);
    if (text === null) continue;
    const encoded = encodeURIComponent(text);
    next = next.replaceAll(`:${key}`, encoded).replaceAll(`{${key}}`, encoded);
  }
  return next;
}

function applyQuery(resource: string, query: Record<string, string> | undefined): string {
  if (!query) return resource;
  const url = new URL(resource);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function targetId(resource: string, method: string): string {
  const url = new URL(resource);
  const path = url.pathname.replace(/^\//, "").replaceAll("/", "-") || "root";
  return `${url.hostname}-${method.toLowerCase()}-${path}`.slice(0, 96);
}

/** One catalog resource. Null when it has no absolute resource URL. */
export function resourceToListing(resource: unknown): ImportedTarget | null {
  if (!isRecord(resource) || typeof resource.resource !== "string") return null;
  if (!hostOf(resource.resource)) return null;

  const input = isRecord(resource.extensions) && isRecord(resource.extensions.bazaar)
    && isRecord(resource.extensions.bazaar.info) && isRecord(resource.extensions.bazaar.info.input)
    ? resource.extensions.bazaar.info.input
    : undefined;
  const method = typeof input?.method === "string"
    ? input.method.toUpperCase()
    : input && "body" in input
      ? "POST"
      : "GET";
  const query = queryRecord(input?.queryParams);
  const url = applyQuery(applyPathParams(resource.resource, input?.pathParams), query);
  const output = discoveryOutput(resource.extensions);
  const version = typeof resource.x402Version === "number" ? resource.x402Version : null;
  const chosen = chosenAccept(Array.isArray(resource.accepts) ? resource.accepts : []);
  const priceUnknown = chosen.atomic === null;

  const target: ImportedTarget = {
    id: targetId(resource.resource, method),
    url,
    method,
    listedPriceUsdc: priceUnknown ? null : listedPriceUsdc(chosen.atomic as bigint),
    x402Version: version,
    payTo: chosen.payTo,
    scheme: chosen.scheme,
    asset: chosen.asset,
    network: chosen.network,
    mimeType: chosen.mimeType,
    source: "bazaar",
  };
  if (priceUnknown) target.importStatus = "price-unknown";
  else if (version === 1) target.importStatus = "v1-only";
  if (input && "body" in input && method !== "GET" && method !== "HEAD") target.body = input.body;
  if (query) target.query = query;
  if (output.example !== undefined) target.outputExample = output.example;
  if (output.schema) target.listingOutputSchema = output.schema;
  return target;
}

/** One catalog resource, or null when the URL host does not match. */
export function resourceToTarget(
  resource: unknown,
  domain: string,
  pathFilter?: string,
): ImportedTarget | null {
  if (!isRecord(resource) || typeof resource.resource !== "string") return null;
  const host = hostOf(resource.resource);
  if (host !== domain) return null;
  if (pathFilter && !pathOf(resource.resource).includes(pathFilter)) return null;
  return resourceToListing(resource);
}

export function unmatchedTarget(domain: string, pathFilter?: string): ImportedTarget {
  const path = pathFilter ? `:${pathFilter}` : "";
  return {
    id: `unmatched:${domain}${path}`,
    url: `https://${domain}/`,
    method: "GET",
    listedPriceUsdc: null,
    x402Version: null,
    payTo: null,
    scheme: null,
    asset: null,
    network: null,
    mimeType: null,
    source: "bazaar",
    importStatus: "unmatched",
    domain,
    ...(pathFilter ? { pathFilter } : {}),
  };
}

function draftRecord(draft: ImportedTarget): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: draft.id,
    url: draft.url,
    method: draft.method,
    listedPriceUsdc: draft.listedPriceUsdc,
    x402Version: draft.x402Version,
    payTo: draft.payTo,
    scheme: draft.scheme,
    asset: draft.asset,
    network: draft.network,
    mimeType: draft.mimeType,
    source: draft.source,
  };
  if (draft.importStatus) record.importStatus = draft.importStatus;
  if (draft.body !== undefined) record.body = draft.body;
  if (draft.query) record.query = draft.query;
  if (draft.outputExample !== undefined) record.outputExample = draft.outputExample;
  if (draft.listingOutputSchema) record.listingOutputSchema = draft.listingOutputSchema;
  if (draft.domain) record.domain = draft.domain;
  if (draft.pathFilter) record.pathFilter = draft.pathFilter;
  return record;
}

function overlay(current: Record<string, unknown>, draft: ImportedTarget): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...current,
    url: draft.url,
    method: draft.method,
    listedPriceUsdc: draft.listedPriceUsdc,
    x402Version: draft.x402Version,
    payTo: draft.payTo,
    scheme: draft.scheme,
    asset: draft.asset,
    network: draft.network,
    mimeType: draft.mimeType,
    source: "bazaar",
  };
  if (typeof current.id === "string") merged.id = current.id;
  if (draft.importStatus) merged.importStatus = draft.importStatus;
  else delete merged.importStatus;
  if (!("body" in current) && draft.body !== undefined) merged.body = draft.body;
  if (draft.query) merged.query = draft.query;
  if (draft.outputExample !== undefined) merged.outputExample = draft.outputExample;
  if (draft.listingOutputSchema) merged.listingOutputSchema = draft.listingOutputSchema;
  return merged;
}

/**
 * Refresh listing fields in place.
 * An existing `expectedSchema` or `body` is left as the operator wrote it.
 * Targets for other hosts stay put. An unmatched marker is replaced, not duplicated.
 */
export function mergeImportedTargets(
  existing: unknown[],
  imported: ImportedTarget[],
  clearMarkerId?: string,
): unknown[] {
  const next = existing.map((item) => (isRecord(item) ? { ...item } : item));
  const indexByKey = new Map<string, number>();
  next.forEach((item, index) => {
    if (!isRecord(item) || typeof item.url !== "string" || item.importStatus === "unmatched" || item.source === "x402trust") return;
    const method = typeof item.method === "string" ? item.method.toUpperCase() : "GET";
    try {
      indexByKey.set(targetKey(item.url, method), index);
    } catch {
      // Keep a hand-written row whose URL is not absolute.
    }
  });

  for (const draft of imported) {
    if (draft.importStatus === "unmatched") continue;
    let at: number | undefined;
    try {
      at = indexByKey.get(targetKey(draft.url, draft.method));
    } catch {
      at = undefined;
    }
    if (at === undefined) {
      try {
        indexByKey.set(targetKey(draft.url, draft.method), next.length);
      } catch {
        // Still append; the probe will surface a bad URL.
      }
      next.push(draftRecord(draft));
      continue;
    }
    const current = next[at];
    if (!isRecord(current) || current.source === "x402trust") continue;
    next[at] = overlay(current, draft);
  }

  const dropIds = new Set<string>();
  if (clearMarkerId) dropIds.add(clearMarkerId);
  for (const draft of imported) {
    if (draft.importStatus === "unmatched") dropIds.add(draft.id);
  }
  const withoutMarkers = next.filter((item) => !(isRecord(item) && dropIds.has(String(item.id))));
  for (const draft of imported) {
    if (draft.importStatus === "unmatched") withoutMarkers.push(draftRecord(draft));
  }
  return withoutMarkers;
}

export async function collectDiscoveryResources(options: {
  domain: string;
  path?: string;
  fetchPage: (offset: number, limit: number) => Promise<DiscoveryPage>;
  pageSize?: number;
  onPage?: (info: { offset: number; total: number }) => void;
}): Promise<ImportedTarget[]> {
  const domain = normalizeHost(options.domain);
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const matched: ImportedTarget[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await options.fetchPage(offset, pageSize);
    const items = Array.isArray(page.items) ? page.items : [];
    if (typeof page.pagination?.total === "number") total = page.pagination.total;
    options.onPage?.({ offset, total });
    for (const item of items) {
      const target = resourceToTarget(item, domain, options.path);
      if (target) matched.push(target);
    }
    if (items.length === 0) break;
    offset += items.length;
    if (items.length < pageSize && !Number.isFinite(total)) break;
  }

  if (matched.length === 0) return [unmatchedTarget(domain, options.path)];
  return matched;
}

export async function importListings(options: {
  domain: string;
  path?: string;
  existing: unknown[];
  fetchPage: (offset: number, limit: number) => Promise<DiscoveryPage>;
  pageSize?: number;
  onPage?: (info: { offset: number; total: number }) => void;
}): Promise<{ targets: unknown[]; matched: number; v1Only: number; priceUnknown: number; unmatched: boolean }> {
  const domain = normalizeHost(options.domain);
  const marker = unmatchedTarget(domain, options.path);
  const imported = await collectDiscoveryResources(options);
  const unmatched = imported.some((item) => item.importStatus === "unmatched");
  return {
    targets: mergeImportedTargets(options.existing, imported, marker.id),
    matched: imported.filter((item) => item.importStatus !== "unmatched").length,
    v1Only: imported.filter((item) => item.importStatus === "v1-only").length,
    priceUnknown: imported.filter((item) => item.importStatus === "price-unknown").length,
    unmatched,
  };
}
