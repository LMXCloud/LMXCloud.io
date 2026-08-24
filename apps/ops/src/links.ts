export type OpsLinkGroup = "vendors" | "stack" | "product" | "distribution";

export type OpsLink = {
  id: string;
  label: string;
  href: string;
  group: OpsLinkGroup;
};

/** Consoles and surfaces an operator jumps to while the dashboard is open. */
export const OPS_LINKS: readonly OpsLink[] = [
  { id: "ionet", label: "io.net", href: "https://ai.io.net/ai/api-keys", group: "vendors" },
  { id: "akash", label: "AkashML", href: "https://akashml.com", group: "vendors" },
  { id: "aethir", label: "Aethir Mesh", href: "https://mesh.aethir.com", group: "vendors" },
  { id: "nosana", label: "Nosana", href: "https://dashboard.nosana.com", group: "vendors" },
  { id: "together", label: "Together.ai", href: "https://api.together.xyz", group: "vendors" },
  { id: "brave", label: "Brave Search", href: "https://api-dashboard.search.brave.com", group: "vendors" },
  { id: "railway", label: "Railway", href: "https://railway.com/dashboard", group: "stack" },
  { id: "neon", label: "Neon", href: "https://console.neon.tech", group: "stack" },
  { id: "sentry", label: "Sentry", href: "https://sentry.io", group: "stack" },
  { id: "vercel", label: "Vercel", href: "https://vercel.com/dashboard", group: "stack" },
  { id: "clerk", label: "Clerk", href: "https://dashboard.clerk.com", group: "stack" },
  { id: "cloudflare", label: "Cloudflare", href: "https://dash.cloudflare.com", group: "stack" },
  { id: "uptime", label: "UptimeRobot", href: "https://uptimerobot.com/dashboard", group: "stack" },
  { id: "cdp", label: "Coinbase CDP", href: "https://portal.cdp.coinbase.com", group: "stack" },
  { id: "api", label: "API health", href: "https://api.lmxcloud.io/health", group: "product" },
  { id: "mcp", label: "MCP health", href: "https://mcp.lmxcloud.io/healthz", group: "product" },
  { id: "web", label: "Dashboard", href: "https://lmxcloud.io", group: "product" },
  { id: "status", label: "Status page", href: "https://lmxcloud.io/status", group: "product" },
  { id: "ops", label: "Ops prod", href: "https://ops.lmxcloud.io", group: "product" },
  { id: "github", label: "GitHub", href: "https://github.com/LMXCloud/LMXCloud.io", group: "distribution" },
  { id: "plugin", label: "ElizaOS plugin", href: "https://github.com/LMXCloud/plugin-lmxcloud", group: "distribution" },
  { id: "npm", label: "npm plugin", href: "https://www.npmjs.com/package/@lmxcloud/plugin-lmxcloud", group: "distribution" },
  { id: "agentic", label: "Agentic.Market", href: "https://agentic.market/services/api-lmxcloud-io", group: "distribution" },
  { id: "bazaar", label: "x402 Bazaar", href: "https://docs.cdp.coinbase.com/x402/bazaar", group: "distribution" },
  { id: "x", label: "X @LMXCloudio", href: "https://x.com/LMXCloudio", group: "distribution" },
];

export const LINK_GROUP_LABEL: Record<OpsLinkGroup, string> = {
  vendors: "Inference",
  stack: "Infra",
  product: "Live sites",
  distribution: "Distribution",
};
