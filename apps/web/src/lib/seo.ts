/** Canonical site origin used for SEO meta, sitemap, and structured data. */
export const SITE_URL = "https://www.lmxcloud.io";

export const SITE_NAME = "LMX Cloud";

export const DEFAULT_TITLE =
  "LMX Cloud — OpenAI-compatible DePIN inference API";

export const DEFAULT_DESCRIPTION =
  "OpenAI-compatible inference API routed across DePIN networks (io.net, AkashML, and Aethir Mesh). Wallet auth, USDC funding, and x402 pay-per-call for developers and autonomous agents.";

/** Default Open Graph / Twitter share image (1200×630). */
export const DEFAULT_OG_IMAGE_PATH = "/brand/og-share.png";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export function absoluteUrl(path = "/"): string {
  if (!path || path === "/") return `${SITE_URL}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalized}`;
}

export const DEFAULT_OG_IMAGE = absoluteUrl(DEFAULT_OG_IMAGE_PATH);
