export const DOC_SECTIONS = [
  { id: "overview", label: "Overview", heading: "What is LMX Cloud?" },
  { id: "quickstart", label: "Quickstart", heading: "Quickstart" },
  { id: "mcp", label: "MCP", heading: "MCP (Model Context Protocol)" },
  { id: "eliza", label: "ElizaOS plugin", heading: "ElizaOS plugin" },
  { id: "vault", label: "Vault", heading: "Vault (lmx-tool-storage)" },
  { id: "agent-template", label: "Agent template", heading: "Agent template" },
  { id: "authentication", label: "Authentication", heading: "Authentication" },
  { id: "wallet-auth", label: "Wallet authentication", heading: "Wallet authentication" },
  { id: "usdc-funding", label: "Funding with USDC", heading: "Funding with USDC" },
  { id: "chat", label: "Chat completions", heading: "Chat completions" },
  { id: "vision", label: "Vision", heading: "Vision" },
  { id: "web-search", label: "Web search", heading: "Web search" },
  { id: "streaming", label: "Streaming", heading: "Streaming" },
  { id: "routing", label: "Routing", heading: "Routing" },
  { id: "headers", label: "Response headers", heading: "Response headers" },
  { id: "verifiable-logs", label: "Verifiable logs", heading: "Verifiable logs" },
  { id: "pricing", label: "Pricing (x402)", heading: "Pricing (x402)" },
  { id: "models", label: "Models", heading: "Models" },
  { id: "roadmap", label: "Roadmap", heading: "Roadmap" },
  { id: "endpoints", label: "Public endpoints", heading: "Public endpoints" },
] as const;

export type DocSection = (typeof DOC_SECTIONS)[number];
