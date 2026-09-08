import { DOC_SECTIONS } from "../content/docs/sections";

export type SearchGroup = "Pages" | "Docs";

export type SearchIcon =
  | "overview"
  | "agents"
  | "notifications"
  | "projects"
  | "keys"
  | "playground"
  | "models"
  | "usage"
  | "logs"
  | "credits"
  | "billing"
  | "docs";

export type SearchItem = {
  id: string;
  title: string;
  href: string;
  group: SearchGroup;
  icon: SearchIcon;
  description: string;
  keywords: string[];
};

const CONSOLE_PAGES: SearchItem[] = [
  {
    id: "page-overview",
    title: "Overview",
    href: "/console/overview",
    group: "Pages",
    icon: "overview",
    description: "Console home, balances, and recent activity",
    keywords: ["dashboard", "home", "account"],
  },
  {
    id: "page-agents",
    title: "Agents",
    href: "/console/agents",
    group: "Pages",
    icon: "agents",
    description: "Directory of named API keys and agent status",
    keywords: ["agent", "vault", "directory", "bot", "instance", "lmx.agent"],
  },
  {
    id: "page-new-agent",
    title: "New agent",
    href: "/console/agents/new",
    group: "Pages",
    icon: "agents",
    description: "Clone the template, pick a key or wallet, run the first request",
    keywords: [
      "new agent",
      "quickstart",
      "degit",
      "template",
      "onboarding",
      "scaffold",
      "clone",
      "lmx-agent-template",
    ],
  },
  {
    id: "page-notifications",
    title: "Notifications",
    href: "/console/notifications",
    group: "Pages",
    icon: "notifications",
    description: "Account alerts, provider health, and billing notices",
    keywords: ["alerts", "bell", "inbox", "unread", "status", "balance"],
  },
  {
    id: "page-projects",
    title: "Projects",
    href: "/console/projects",
    group: "Pages",
    icon: "projects",
    description: "Group keys and budgets by integration",
    keywords: ["project", "app", "workspace", "budget", "group"],
  },
  {
    id: "page-keys",
    title: "API Keys",
    href: "/console/keys",
    group: "Pages",
    icon: "keys",
    description: "Create, tag, and revoke keys",
    keywords: ["key", "token", "credential", "mcp", "environment", "project"],
  },
  {
    id: "page-playground",
    title: "Playground",
    href: "/console/playground",
    group: "Pages",
    icon: "playground",
    description: "Test inference and copy snippets",
    keywords: ["chat", "demo", "try", "completions"],
  },
  {
    id: "page-models",
    title: "Models & pricing",
    href: "/console/models",
    group: "Pages",
    icon: "models",
    description: "Live catalog and list prices",
    keywords: ["models", "pricing", "catalog", "aliases", "providers"],
  },
  {
    id: "page-usage",
    title: "Usage",
    href: "/console/usage",
    group: "Pages",
    icon: "usage",
    description: "Requests and tokens across keys",
    keywords: ["tokens", "requests", "activity", "history"],
  },
  {
    id: "page-logs",
    title: "Request logs",
    href: "/console/logs",
    group: "Pages",
    icon: "logs",
    description: "Request receipts and verification",
    keywords: ["logs", "proof", "receipts", "history", "requests"],
  },
  {
    id: "page-credits",
    title: "Credits",
    href: "/console/credits",
    group: "Pages",
    icon: "credits",
    description: "Balance, usage runway, and USDC deposits",
    keywords: ["credits", "usdc", "deposit", "balance", "funding", "treasury"],
  },
  {
    id: "page-billing",
    title: "Billing information",
    href: "/console/billing",
    group: "Pages",
    icon: "billing",
    description: "On-chain deposit receipts and x402 spend",
    keywords: ["billing", "receipts", "usdc", "deposit", "x402", "spend"],
  },
];

const DOC_ITEMS: SearchItem[] = DOC_SECTIONS.map((section) => ({
  id: `docs-${section.id}`,
  title: section.heading,
  href: `/docs#${section.id}`,
  group: "Docs",
  icon: "docs",
  description: `Docs · ${section.label}`,
  keywords: [
    section.id.replaceAll("-", " "),
    section.label,
    "documentation",
    "docs",
  ],
}));

export const CONSOLE_SEARCH_INDEX: SearchItem[] = [...CONSOLE_PAGES, ...DOC_ITEMS];

const GROUP_ORDER: SearchGroup[] = ["Pages", "Docs"];

export function searchConsole(query: string, items = CONSOLE_SEARCH_INDEX): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const tokens = q.split(/\s+/).filter(Boolean);

  return items
    .map((item) => ({ item, score: scoreItem(item, q, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export function groupSearchResults(items: SearchItem[]): { group: SearchGroup; items: SearchItem[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

function scoreItem(item: SearchItem, query: string, tokens: string[]): number {
  const title = item.title.toLowerCase();
  const haystack = [item.title, item.description, item.href, ...item.keywords]
    .join(" ")
    .toLowerCase();

  if (!tokens.every((token) => haystack.includes(token))) return 0;

  let score = 10;
  if (title === query) score = 100;
  else if (title.startsWith(query)) score = 80;
  else if (title.includes(query)) score = 50;
  else if (item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) score = 40;

  if (item.group === "Pages") score += 5;
  return score;
}
