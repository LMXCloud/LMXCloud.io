/** Canonical site origin used for SEO meta, sitemap, and structured data. */
export const SITE_URL = "https://www.lmxcloud.io";

export const SITE_NAME = "LMX Cloud";

export const DEFAULT_TITLE =
  "LMX Cloud — OpenAI-compatible DePIN inference API";

export const DEFAULT_DESCRIPTION =
  "OpenAI-compatible inference API routed across DePIN networks (io.net, Akash, and Nosana). Wallet auth, USDC funding, and x402 pay-per-call for developers and autonomous agents.";

export function absoluteUrl(path = "/"): string {
  if (!path || path === "/") return `${SITE_URL}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalized}`;
}
