/** Vendors LMX pays — not customer-usage cost. */

export type InfraServiceCategory =
  | "inference"
  | "hosting"
  | "database"
  | "observability"
  | "auth"
  | "edge"
  | "search";

/** How this vendor's dollars can be observed — same modes as provider-balance observability. */
export type InfraSpendSource =
  | "railway_graphql"
  | "neon_consumption"
  | "provider_balance"
  | "manual";

export type InfraServiceDef = {
  id: string;
  name: string;
  category: InfraServiceCategory;
  purpose: string;
  consoleUrl: string;
  spendSource: InfraSpendSource;
  /** Env var that means this process is wired to the vendor. */
  configuredEnv?: string;
  /** Listed in DEPLOY.md / production stack even when the API cannot detect it. */
  inDocumentedStack?: boolean;
};

export const INFRA_SERVICES: readonly InfraServiceDef[] = [
  {
    id: "ionet",
    name: "io.net",
    category: "inference",
    purpose: "Primary DePIN inference (Tier 1)",
    consoleUrl: "https://ai.io.net/ai/api-keys",
    spendSource: "provider_balance",
    configuredEnv: "IONET_API_KEY",
    inDocumentedStack: true,
  },
  {
    id: "akash",
    name: "AkashML",
    category: "inference",
    purpose: "DePIN inference fallback (Tier 2)",
    consoleUrl: "https://akashml.com",
    spendSource: "manual",
    configuredEnv: "AKASHML_API_KEY",
    inDocumentedStack: true,
  },
  {
    id: "aethir",
    name: "Aethir Mesh",
    category: "inference",
    purpose: "DePIN inference fallback (Tier 2)",
    consoleUrl: "https://mesh.aethir.com",
    spendSource: "manual",
    configuredEnv: "AETHIR_API_KEY",
    inDocumentedStack: true,
  },
  {
    id: "nosana",
    name: "Nosana",
    category: "inference",
    purpose: "Per-deployment DePIN inference fallback (Tier 3)",
    consoleUrl: "https://dashboard.nosana.com",
    spendSource: "manual",
    configuredEnv: "NOSANA_API_KEY",
  },
  {
    id: "together",
    name: "Together.ai",
    category: "inference",
    purpose: "Last-resort centralized inference fallback (Tier 4)",
    consoleUrl: "https://api.together.xyz",
    spendSource: "manual",
    configuredEnv: "TOGETHER_API_KEY",
  },
  {
    id: "railway",
    name: "Railway",
    category: "hosting",
    purpose: "API, MCP server, and tools-host compute",
    consoleUrl: "https://railway.com/dashboard",
    spendSource: "railway_graphql",
    configuredEnv: "RAILWAY_ENVIRONMENT",
    inDocumentedStack: true,
  },
  {
    id: "neon",
    name: "Neon",
    category: "database",
    purpose: "Postgres for keys, usage, payments, and ops logs",
    consoleUrl: "https://console.neon.tech",
    spendSource: "neon_consumption",
    configuredEnv: "DATABASE_URL",
    inDocumentedStack: true,
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "observability",
    purpose: "API error reporting",
    consoleUrl: "https://sentry.io",
    spendSource: "manual",
    configuredEnv: "SENTRY_DSN",
    inDocumentedStack: true,
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "hosting",
    purpose: "Dashboard, demo, and ops SPA hosting",
    consoleUrl: "https://vercel.com/dashboard",
    spendSource: "manual",
    inDocumentedStack: true,
  },
  {
    id: "clerk",
    name: "Clerk",
    category: "auth",
    purpose: "Dashboard sign-in",
    consoleUrl: "https://dashboard.clerk.com",
    spendSource: "manual",
    configuredEnv: "CLERK_SECRET_KEY",
    inDocumentedStack: true,
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "edge",
    purpose: "DNS, TLS, and origin lock for api/mcp.lmxcloud.io",
    consoleUrl: "https://dash.cloudflare.com",
    spendSource: "manual",
    configuredEnv: "LMX_ORIGIN_SECRET",
    inDocumentedStack: true,
  },
  {
    id: "brave",
    name: "Brave Search",
    category: "search",
    purpose: "web_search passthrough (~$5/1k requests on Search plan)",
    consoleUrl: "https://api-dashboard.search.brave.com",
    spendSource: "manual",
    configuredEnv: "BRAVE_SEARCH_API_KEY",
  },
] as const;

export const INFRA_SERVICE_IDS = INFRA_SERVICES.map((s) => s.id);

export type InfraServiceId = (typeof INFRA_SERVICES)[number]["id"];

export function isInfraServiceId(value: string): value is InfraServiceId {
  return (INFRA_SERVICE_IDS as readonly string[]).includes(value);
}

export function getInfraService(id: string): InfraServiceDef | undefined {
  return INFRA_SERVICES.find((s) => s.id === id);
}

export function envConfigured(def: InfraServiceDef, env: NodeJS.ProcessEnv = process.env): boolean {
  if (def.id === "railway") {
    return Boolean(
      env.RAILWAY_ENVIRONMENT?.trim() ||
        env.RAILWAY_PROJECT_ID?.trim() ||
        env.RAILWAY_TOKEN?.trim(),
    );
  }
  if (!def.configuredEnv) return false;
  return Boolean(env[def.configuredEnv]?.trim());
}

export const MANUAL_REASON: Record<string, string> = {
  ionet:
    "Account credit top-ups are dashboard-only. Sub-key remaining allowance is polled separately when the key supports it.",
  akash: "AkashML has no account-balance or billing API — check the dashboard and log spend here.",
  aethir: "Aethir Mesh has no account-balance or billing API — check the dashboard and log spend here.",
  nosana: "Nosana billing is per-deployment in the dashboard — no spend API to poll.",
  together: "Together.ai usage lives in their dashboard — log invoices here.",
  railway:
    "Railway GraphQL can return current-cycle cost when RAILWAY_TOKEN and RAILWAY_WORKSPACE_ID are set. Until then, log usage from the Hobby dashboard.",
  neon:
    "Neon consumption API can estimate CU-hour cost when NEON_API_KEY and NEON_ORG_ID are set. Until then, log invoices from the console.",
  sentry:
    "SENTRY_DSN is ingest-only. Sentry's stats API returns event counts, not USD, and needs a separate org token. Log invoices here.",
  vercel: "Vercel has no public spend API wired here — log invoices from the dashboard.",
  clerk: "Clerk billing is dashboard-only — log invoices here.",
  cloudflare: "Cloudflare billing is dashboard-only — log invoices here.",
  brave: "Brave Search billing is dashboard-only — log invoices here.",
};
