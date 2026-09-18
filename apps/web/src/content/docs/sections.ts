export const DOC_PAGES = [
  {
    id: "overview",
    label: "Overview",
    heading: "LMX Cloud",
    description:
      "OpenAI-compatible inference routed through decentralized compute. Same chat completions API, DePIN providers, and pay-per-call rails for developers and agents.",
    group: "Getting Started",
    icon: "home",
    nextCta: "Get started",
  },
  {
    id: "quickstart",
    label: "Quickstart",
    heading: "Make your first request",
    description:
      "Create an API key, point an OpenAI SDK at LMX Cloud, and send a chat completion.",
    group: "Getting Started",
    icon: "rocket",
  },
  {
    id: "mcp",
    label: "MCP",
    heading: "MCP (Model Context Protocol)",
    description:
      "Call pricing, models, status, inference, and web search as MCP tools — balance-funded or x402 pay-per-call.",
    group: "Getting Started",
    icon: "plug",
  },
  {
    id: "eliza",
    label: "ElizaOS plugin",
    heading: "ElizaOS plugin",
    description:
      "x402-only ElizaOS plugin: one EVM wallet funded with USDC on Base pays per call. No API key or signup.",
    group: "Getting Started",
    icon: "puzzle",
  },
  {
    id: "vault",
    label: "Vault",
    heading: "Vault (lmx-tool-storage)",
    description:
      "Self-hostable agent memory: namespaced markdown, local embeddings, and optional Grid consolidation.",
    group: "Getting Started",
    icon: "database",
  },
  {
    id: "agent-template",
    label: "Agent template",
    heading: "Agent template",
    description:
      "Forkable starter kit: Grid reasoning plus a local Vault with zero configuration.",
    group: "Getting Started",
    icon: "bot",
  },
  {
    id: "authentication",
    label: "Authentication",
    heading: "Authentication",
    description:
      "Bearer API keys in lmx_ format, sessions, and project-scoped credentials.",
    group: "API",
    icon: "key",
  },
  {
    id: "wallet-auth",
    label: "Wallet authentication",
    heading: "Wallet authentication",
    description:
      "Sign-In with Ethereum (SIWE) for browser wallets and headless agents.",
    group: "API",
    icon: "wallet",
  },
  {
    id: "usdc-funding",
    label: "Funding with USDC",
    heading: "Funding with USDC",
    description:
      "Send USDC on Base to the LMX treasury. Credits appear after on-chain confirmations.",
    group: "API",
    icon: "coins",
  },
  {
    id: "chat",
    label: "Chat completions",
    heading: "Chat completions",
    description:
      "POST /v1/chat/completions — OpenAI-compatible bodies, DePIN routing, optional vision content.",
    group: "API",
    icon: "message",
  },
  {
    id: "vision",
    label: "Vision",
    heading: "Vision",
    description:
      "Multimodal user messages with text and image_url parts on vision-capable aliases.",
    group: "API",
    icon: "image",
  },
  {
    id: "web-search",
    label: "Web search",
    heading: "Web search",
    description:
      "POST /v1/web/search — Brave Search passthrough with fixed per-call balance billing.",
    group: "API",
    icon: "search",
  },
  {
    id: "streaming",
    label: "Streaming",
    heading: "Streaming",
    description:
      "Server-Sent Events with OpenAI token deltas and a final LMX billing metadata event.",
    group: "API",
    icon: "radio",
  },
  {
    id: "routing",
    label: "Routing",
    heading: "Routing",
    description:
      "Prefer cheapest, fastest, depin-only, or a named provider. Failures fall through the chain.",
    group: "API",
    icon: "route",
  },
  {
    id: "headers",
    label: "Response headers",
    heading: "Response headers",
    description:
      "Every completion includes provider, fallback, latency, and billing metadata.",
    group: "API",
    icon: "panel",
  },
  {
    id: "verifiable-logs",
    label: "Verifiable logs",
    heading: "Verifiable logs",
    description:
      "Deterministic receipts, Merkle batches, and Base anchors you can verify outside the dashboard.",
    group: "API",
    icon: "shield",
  },
  {
    id: "models",
    label: "Models",
    heading: "Models",
    description:
      "Public GET /v1/models list plus alias-to-upstream mappings across io.net, AkashML, and Aethir Mesh.",
    group: "API",
    icon: "boxes",
  },
  {
    id: "pricing",
    label: "Pricing (x402)",
    heading: "Pricing (x402)",
    description:
      "Public list prices, per-call USDC quotes, and the anonymous 402 payment path on Base.",
    group: "API",
    icon: "badge-dollar",
  },
  {
    id: "endpoints",
    label: "Public endpoints",
    heading: "Public endpoints",
    description:
      "Status, pricing, models, auth, and account surfaces that require no inference key.",
    group: "API",
    icon: "list",
  },
  {
    id: "roadmap",
    label: "Roadmap",
    heading: "Roadmap",
    description:
      "What you can build on today and what is still in flight.",
    group: "Platform",
    icon: "map",
  },
] as const;

export type DocPage = (typeof DOC_PAGES)[number];
export type DocPageId = DocPage["id"];
export type DocIconName = DocPage["icon"];

/** @deprecated Use DOC_PAGES. Kept for command-palette search. */
export const DOC_SECTIONS = DOC_PAGES;

export type DocNavFolder = {
  type: "folder";
  id: string;
  label: string;
  icon: DocIconName;
  children: readonly DocPageId[];
};

export type DocNavItem = { type: "page"; id: DocPageId } | DocNavFolder;

export type DocNavGroup = {
  label: string;
  items: readonly DocNavItem[];
};

export const DOC_NAV: readonly DocNavGroup[] = [
  {
    label: "Getting Started",
    items: [
      { type: "page", id: "overview" },
      { type: "page", id: "quickstart" },
      {
        type: "folder",
        id: "tools",
        label: "Tools & Libraries",
        icon: "plug",
        children: ["mcp", "eliza"],
      },
      {
        type: "folder",
        id: "agents",
        label: "Agent Resources",
        icon: "bot",
        children: ["vault", "agent-template"],
      },
    ],
  },
  {
    label: "API",
    items: [
      { type: "page", id: "authentication" },
      { type: "page", id: "wallet-auth" },
      { type: "page", id: "usdc-funding" },
      { type: "page", id: "chat" },
      { type: "page", id: "vision" },
      { type: "page", id: "web-search" },
      { type: "page", id: "streaming" },
      { type: "page", id: "routing" },
      { type: "page", id: "headers" },
      { type: "page", id: "verifiable-logs" },
      { type: "page", id: "models" },
      { type: "page", id: "pricing" },
      { type: "page", id: "endpoints" },
    ],
  },
  {
    label: "Platform",
    items: [{ type: "page", id: "roadmap" }],
  },
] as const;

const PAGE_BY_ID = new Map(DOC_PAGES.map((page) => [page.id, page]));

export function isDocPageId(value: string | undefined): value is DocPageId {
  return Boolean(value && PAGE_BY_ID.has(value as DocPageId));
}

export function getDocPage(id: DocPageId): DocPage {
  return PAGE_BY_ID.get(id)!;
}

export function docPath(id: DocPageId): string {
  return `/docs/${id}`;
}

export function getAdjacentDocPages(id: DocPageId): {
  prev: DocPage | null;
  next: DocPage | null;
} {
  const index = DOC_PAGES.findIndex((page) => page.id === id);
  return {
    prev: index > 0 ? DOC_PAGES[index - 1]! : null,
    next: index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1]! : null,
  };
}

export function folderContainsPage(
  folder: DocNavFolder,
  id: DocPageId,
): boolean {
  return folder.children.includes(id);
}
