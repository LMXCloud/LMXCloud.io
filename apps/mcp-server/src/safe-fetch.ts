import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching a caller-supplied URL from inside our network is an SSRF risk: the
 * URL (or a redirect it returns) can point at Railway private services,
 * localhost, or link-local metadata addresses. These helpers only fetch public
 * https hosts, re-check every redirect hop, and cap size and time.
 */

export const SAFE_FETCH_DEFAULTS = {
  maxBytes: 25 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 3,
} as const;

export class UnsafeUrlError extends Error {}

const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".lan", ".home.arpa"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True when an IP literal is loopback, private, link-local, or otherwise not public. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    const firstHextet = parseInt(lower.split(":")[0] || "0", 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:")) return true;
    return false;
  }
  return true;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** Throws UnsafeUrlError unless the URL is https to a host that resolves only to public addresses. */
export async function assertPublicHttpsUrl(
  raw: string,
  resolve: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("file_url is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("file_url must be an https URL.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("file_url must not contain credentials.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrlError("file_url must point to a public host.");
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new UnsafeUrlError("file_url host could not be resolved.");
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("file_url must point to a public host.");
  }
  return url;
}

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolve?: HostResolver;
  fetchImpl?: typeof fetch;
};

/**
 * GET a caller-supplied URL safely. Redirects are followed by hand so every hop
 * is re-validated. Returns the body bytes or throws (UnsafeUrlError for policy
 * refusals, Error with a generic message otherwise).
 */
export async function safeFetchBytes(raw: string, options: SafeFetchOptions = {}): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs);

  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicHttpsUrl(current, options.resolve);
    let response: Response;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal });
    } catch {
      throw new Error("Could not fetch file_url.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("Could not fetch file_url.");
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Could not fetch file_url (HTTP ${response.status}).`);
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("file_url is too large.");
    }

    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("file_url is too large.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "file_url is too large.") throw error;
      throw new Error("Could not fetch file_url.");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  throw new UnsafeUrlError("file_url redirected too many times.");
}
