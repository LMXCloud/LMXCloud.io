import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { listUniqueModelAliases, listVisionModelAliases } from "@lmxcloud/shared";
import { API_BASE, fetchModels, type ModelsResponse } from "../api";
import { PublicLayout } from "../components/PublicLayout";
import { SeoHead } from "../components/SeoHead";
import { PageHeader } from "../components/console/PageHeader";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "../components/console/DataTable";
import { CodeBlock } from "../components/docs/CodeBlock";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { DOC_SECTIONS } from "../content/docs/sections";
import { cn } from "../lib/cn";
import {
  AGENT_TEMPLATE_DIR,
  AGENT_TEMPLATE_GITHUB,
  agentCloneCommand,
  agentRunCommand,
} from "../lib/snippets";

const SECTIONS = DOC_SECTIONS;

const EXAMPLE_BASE = API_BASE;
const MCP_HOSTED_BASE = "https://mcp.lmxcloud.io/mcp";

const CATALOG_MODELS = listUniqueModelAliases();
const VISION_ALIASES = listVisionModelAliases();

export function DocsPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    void fetchModels()
      .then(setModels)
      .catch((err) =>
        setModelsError(err instanceof Error ? err.message : "Failed to load models"),
      );
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const targetId = location.hash.slice(1);
    if (!targetId) return;

    // React Router hash navigation can miss in-app transitions; scroll explicitly.
    window.requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [location.hash]);

  return (
    <PublicLayout>
      <SeoHead
        title="API Docs — LMX Cloud OpenAI-compatible inference"
        description="Developer docs for LMX Cloud: OpenAI-compatible chat completions (vision), web search, x402 USDC payments, MCP, ElizaOS plugin, self-hosted Vault, agent template, wallet auth, DePIN routing, and verifiable logs."
        path="/docs"
      />
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)] py-10 sm:py-14">
        <PageHeader
          eyebrow="Developers"
          title="API documentation"
          description="OpenAI-compatible inference routed through decentralized compute — Web3-native rails for developers and autonomous agents."
          actions={
            <Button to="/sign-up" size="sm">
              Get API key
            </Button>
          }
        />

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <p className="text-label-sm text-on-surface-faint">On this page</p>
            <ul className="mt-3 space-y-1">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-md px-3 py-1.5 text-body-sm text-on-surface-muted transition-colors hover:bg-surface hover:text-on-surface"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-14">
            <DocSection id="overview" title="What is LMX Cloud?">
              <p className="text-body-md text-on-surface-muted">
                LMX Cloud is an OpenAI-compatible inference API that routes your requests through
                decentralized compute networks — io.net, AkashML, and Aethir Mesh — with automatic
                fallback when a provider is slow or unavailable. Drop in your existing SDK, change
                the base URL and API key, and you get the same chat completions interface you
                already use (including vision{" "}
                <code className="text-mono-sm">image_url</code> content on supported models),
                plus balance-billed{" "}
                <a href="#web-search" className="text-primary hover:text-primary-hover">
                  web search
                </a>
                , backed by DePIN infrastructure instead of a single centralized vendor.
              </p>
              <p className="mt-4 text-body-md text-on-surface-muted">
                It is also built for agents with no prior relationship: omit an API key on{" "}
                <code className="text-mono-sm">POST /v1/chat/completions</code>, pay per call in
                USDC on Base via{" "}
                <a
                  href="https://www.x402.org/"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  x402
                </a>
                , and get routed DePIN inference back. Discover the same surface through{" "}
                <a href="#mcp" className="text-primary hover:text-primary-hover">
                  MCP
                </a>
                , the{" "}
                <a href="#eliza" className="text-primary hover:text-primary-hover">
                  ElizaOS plugin
                </a>
                , or x402 Bazaar / Agentic.Market after a settled payment. Self-host agent memory
                with{" "}
                <a href="#vault" className="text-primary hover:text-primary-hover">
                  Vault
                </a>
                , or fork the{" "}
                <a href="#agent-template" className="text-primary hover:text-primary-hover">
                  agent template
                </a>{" "}
                to get Grid reasoning and a local Vault with zero configuration.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Developers can still sign in with email (Clerk) or a wallet, fund a balance with
                USDC on Base, and verify usage receipts anchored on-chain. The sections below are the
                technical reference; see{" "}
                <a href="#roadmap" className="text-primary hover:text-primary-hover">
                  Roadmap
                </a>{" "}
                for what is shipped versus what is next.
              </p>
            </DocSection>

            <DocSection id="quickstart" title="Quickstart">
              <p className="text-body-md text-on-surface-muted">
                LMX Cloud exposes the same endpoints as OpenAI. Base URL:
              </p>
              <Card className="mt-4 border-primary/30 bg-primary/5">
                <code className="text-mono-sm text-primary">{EXAMPLE_BASE}/v1</code>
              </Card>

              <h3 className="mt-8 text-title-md text-on-surface">1. Create an API key</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Sign up in the console, or create a throwaway key for testing:
              </p>
              <div className="mt-4">
                <CodeBlock title="curl">
                  {`curl -X POST ${EXAMPLE_BASE}/v1/auth/key \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com"}'`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">2. Send a chat completion</h3>
              <div className="mt-4 space-y-4">
                <CodeBlock title="curl">
                  {`curl ${EXAMPLE_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "llama-3-70b",
    "messages": [{"role": "user", "content": "Hello from LMX Cloud"}]
  }'`}
                </CodeBlock>

                <CodeBlock title="Python (OpenAI SDK)">
                  {`from openai import OpenAI

client = OpenAI(
    base_url="${EXAMPLE_BASE}/v1",
    api_key="lmx_YOUR_KEY",
)

response = client.chat.completions.create(
    model="llama-3-70b",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)`}
                </CodeBlock>

                <CodeBlock title="JavaScript (OpenAI SDK)">
                  {`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${EXAMPLE_BASE}/v1",
  apiKey: "lmx_YOUR_KEY",
});

const response = await client.chat.completions.create({
  model: "llama-3-70b",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);`}
                </CodeBlock>
              </div>
            </DocSection>

            <DocSection id="mcp" title="MCP (Model Context Protocol)">
              <p className="text-body-md text-on-surface-muted">
                LMX Cloud ships a hosted MCP server (
                <code className="text-mono-sm">@lmxcloud/mcp-server</code>) at{" "}
                <code className="text-mono-sm">{MCP_HOSTED_BASE}</code> so agents can call
                inference as tools instead of hand-writing REST calls. It is published to the
                official MCP Registry as{" "}
                <a
                  href="https://registry.modelcontextprotocol.io"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  <code className="text-mono-sm">io.lmxcloud/mcp-server</code>
                </a>
                .
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Current MCP tools:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  <code className="text-mono-sm">get_pricing</code> — full pricing catalog (
                  <code className="text-mono-sm">GET /v1/pricing</code>)
                </li>
                <li>
                  <code className="text-mono-sm">quote_price</code> — single-call USDC quote for a
                  model (
                  <code className="text-mono-sm">GET /v1/pricing?model=...</code>)
                </li>
                <li>
                  <code className="text-mono-sm">list_models</code> — supported model aliases (
                  <code className="text-mono-sm">GET /v1/models</code>)
                </li>
                <li>
                  <code className="text-mono-sm">get_status</code> — provider health and fallback
                  chain (<code className="text-mono-sm">GET /v1/status</code>)
                </li>
                <li>
                  <code className="text-mono-sm">get_balance</code> — caller credit balance (
                  <code className="text-mono-sm">GET /v1/balance</code>, key required)
                </li>
                <li>
                  <code className="text-mono-sm">get_usage</code> — caller usage totals (
                  <code className="text-mono-sm">GET /v1/usage</code>, key required)
                </li>
                <li>
                  <code className="text-mono-sm">chat_completion</code> — run inference (
                  <code className="text-mono-sm">POST /v1/chat/completions</code>; API key or x402
                  pay-per-call). Optional <code className="text-mono-sm">image_url</code> /{" "}
                  <code className="text-mono-sm">images</code> for vision models.
                </li>
                <li>
                  <code className="text-mono-sm">web_search</code> — real-time web search (
                  <code className="text-mono-sm">POST /v1/web/search</code>; API key required,
                  fixed per-call price)
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Two payment paths</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  Balance-funded — pass{" "}
                  <code className="text-mono-sm">Authorization: Bearer lmx_...</code> (or an{" "}
                  <code className="text-mono-sm">api_key</code> tool argument). Deducts from your
                  console balance. Required for <code className="text-mono-sm">web_search</code>.
                </li>
                <li>
                  x402 pay-per-call — omit the API key on{" "}
                  <code className="text-mono-sm">chat_completion</code> only. The MCP seller
                  wrapper returns payment requirements; your agent pays USDC on Base (same CDP
                  facilitator + <code className="text-mono-sm">upto</code> scheme as the HTTP
                  route). No LMX account required.
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Hosted config (production)</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Add this to <code className="text-mono-sm">.cursor/mcp.json</code> in any repository.
                Your API key is sent per user via the <code className="text-mono-sm">Authorization</code>{" "}
                header — each caller pays from their own balance. For x402-only agents, omit{" "}
                <code className="text-mono-sm">headers</code> and use a client that can settle x402
                tool payments.
              </p>
              <div className="mt-4">
                <CodeBlock title=".cursor/mcp.json">
                  {`{
  "mcpServers": {
    "lmxcloud": {
      "url": "${MCP_HOSTED_BASE}",
      "headers": {
        "Authorization": "Bearer lmx_YOUR_KEY"
      }
    }
  }
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Create a key in the{" "}
                <Link to="/console/keys" className="text-primary hover:text-primary-hover">
                  console
                </Link>
                , fund your balance, then call <code className="text-mono-sm">get_balance</code> and{" "}
                <code className="text-mono-sm">chat_completion</code>. Missing or invalid keys return
                clear MCP errors before inference is attempted (on the balance path).
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Local dev fallback</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Use this only when developing the MCP server from source in this repository.
              </p>
              <div className="mt-4">
                <CodeBlock title=".cursor/mcp.json (dev only)">
                  {`{
  "mcpServers": {
    "lmxcloud-local-dev": {
      "command": "pnpm",
      "args": [
        "--dir",
        "C:/Users/you/path/to/LMXCloud.io",
        "--filter",
        "@lmxcloud/mcp-server",
        "dev"
      ],
      "env": {
        "LMX_API_BASE_URL": "${EXAMPLE_BASE}",
        "LMX_API_KEY": "lmx_YOUR_KEY",
        "LMX_DEFAULT_MODEL": "llama-3-70b"
      }
    }
  }
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Smoke test</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                After reloading MCP servers in your agent client, call tools in this order:
              </p>
              <div className="mt-4">
                <CodeBlock title="Suggested test flow">
                  {`1) get_status
2) list_models
3) quote_price(model="llama-3-70b", max_tokens=512, prompt_tokens=200)
4) get_balance
5) chat_completion(prompt="Reply with exactly: MCP test passed.", model="llama-3-70b")
6) web_search(query="LMX Cloud DePIN inference", max_results=3)
7) get_usage`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                A passing balance-funded run confirms provider health, model discovery, quoting,
                balance checks, inference billing, web search, and usage accounting — all through
                MCP with your API key. For x402, skip balance/usage steps (or expect auth errors)
                and invoke <code className="text-mono-sm">chat_completion</code> with no key so
                payment settles per call. <code className="text-mono-sm">web_search</code> is
                balance-only today.
              </p>
            </DocSection>

            <DocSection id="eliza" title="ElizaOS plugin">
              <p className="text-body-md text-on-surface-muted">
                Autonomously funded ElizaOS agents can use LMX Cloud as their LLM provider via{" "}
                <a
                  href="https://www.npmjs.com/package/@lmxcloud/plugin-lmxcloud"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  <code className="text-mono-sm">@lmxcloud/plugin-lmxcloud</code>
                </a>
                . The plugin is x402-only: no LMX API key, no signup, and no pre-funded balance —
                one EVM wallet funded with USDC on Base pays per call.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Source:{" "}
                <a
                  href="https://github.com/LMXCloud/plugin-lmxcloud"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/LMXCloud/plugin-lmxcloud
                </a>
                . npm packages tagged <code className="text-mono-sm">elizaos</code> are
                auto-discoverable; a third-party registry listing is also in review at{" "}
                <a
                  href="https://github.com/elizaOS/eliza/pull/16397"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  elizaOS/eliza#16397
                </a>
                .
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Install</h3>
              <div className="mt-4">
                <CodeBlock title="npm / elizaos CLI">
                  {`npm install @lmxcloud/plugin-lmxcloud
# or
elizaos plugins add @lmxcloud/plugin-lmxcloud`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Required config</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Set <code className="text-mono-sm">LMXCLOUD_PRIVATE_KEY</code> to an EVM private key
                (<code className="text-mono-sm">0x…</code> or 64 hex chars) funded with USDC on Base
                plus a little ETH for gas. On first payment the plugin may submit a one-time Permit2
                USDC approval from that wallet.
              </p>
              <div className="mt-4">
                <CodeBlock title="Character secrets">
                  {`{
  "name": "MyAgent",
  "plugins": ["@lmxcloud/plugin-lmxcloud"],
  "settings": {
    "secrets": {
      "LMXCLOUD_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
    }
  }
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Optional settings</h3>
              <div className="mt-4">
                <DataTable minWidth={640}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Setting</DataTableTh>
                      <DataTableTh>Default</DataTableTh>
                      <DataTableTh>Description</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>LMXCLOUD_API_URL</DataTableCell>
                      <DataTableCell mono>https://api.lmxcloud.io</DataTableCell>
                      <DataTableCell>API base URL</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMXCLOUD_SMALL_MODEL</DataTableCell>
                      <DataTableCell mono>glm-4.7-flash</DataTableCell>
                      <DataTableCell>
                        Model for <code className="text-mono-sm">TEXT_SMALL</code>
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMXCLOUD_LARGE_MODEL</DataTableCell>
                      <DataTableCell mono>llama-3-70b</DataTableCell>
                      <DataTableCell>
                        Model for <code className="text-mono-sm">TEXT_LARGE</code>
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMXCLOUD_RPC_URL</DataTableCell>
                      <DataTableCell mono>https://mainnet.base.org</DataTableCell>
                      <DataTableCell>Base JSON-RPC for signing / Permit2</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMXCLOUD_CHAIN_ID</DataTableCell>
                      <DataTableCell mono>8453</DataTableCell>
                      <DataTableCell>
                        <code className="text-mono-sm">8453</code> Base mainnet ·{" "}
                        <code className="text-mono-sm">84532</code> Base Sepolia
                      </DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">How payment works</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  Plugin POSTs to{" "}
                  <code className="text-mono-sm">{EXAMPLE_BASE}/v1/chat/completions</code> with no
                  Bearer key.
                </li>
                <li>API returns HTTP 402 with x402 payment requirements (USDC on Base).</li>
                <li>
                  Plugin signs with <code className="text-mono-sm">@x402/core</code> +{" "}
                  <code className="text-mono-sm">@x402/evm</code> (
                  <code className="text-mono-sm">UptoEvmScheme</code>).
                </li>
                <li>Request is retried with the payment header; completion text is returned.</li>
              </ol>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Pricing is dynamic per request (x402 <code className="text-mono-sm">upto</code>{" "}
                scheme). See{" "}
                <a href="#pricing" className="text-primary hover:text-primary-hover">
                  Pricing
                </a>{" "}
                for the public quote endpoint.
              </p>
            </DocSection>

            <DocSection id="vault" title="Vault (lmx-tool-storage)">
              <p className="text-body-md text-on-surface-muted">
                Vault is self-hostable agent memory — one operator, one instance, one database. It
                is not an LMX-hosted service. Documents are namespaced markdown with YAML
                frontmatter. Storage, embeddings, structured query, and semantic search stay on the
                machine that runs it. The one exception is consolidation, which calls LMX Grid to
                resolve contradictions and write durable{" "}
                <code className="text-mono-sm">kind: reflection</code> notes.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Source:{" "}
                <a
                  href="https://github.com/LMXCloud/lmx-tool-storage"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/LMXCloud/lmx-tool-storage
                </a>
                . Default listen address is{" "}
                <code className="text-mono-sm">http://127.0.0.1:8788</code> (
                <code className="text-mono-sm">PORT</code> / <code className="text-mono-sm">HOST</code>{" "}
                overridable).
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Install</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Add it as a git dependency (not an npm-registry package), or clone the repo and run
                it as its own process. If{" "}
                <code className="text-mono-sm">DATABASE_URL</code> is unset, the server uses a local
                SQLite file at <code className="text-mono-sm">data/vault.db</code> (created
                automatically). Semantic search uses a local sentence-embedding model (
                <code className="text-mono-sm">Xenova/all-MiniLM-L6-v2</code>) with no API key —
                first boot may download ~23MB of weights into{" "}
                <code className="text-mono-sm">data/models/</code>; after that, inference is fully
                local.
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="pnpm (git dependency)">
                  {`pnpm add github:LMXCloud/lmx-tool-storage`}
                </CodeBlock>
                <CodeBlock title="package.json (pnpm v10+)">
                  {`{
  "pnpm": {
    "onlyBuiltDependencies": [
      "@lmxcloud/lmx-tool-storage",
      "esbuild",
      "onnxruntime-node",
      "protobufjs",
      "sharp"
    ]
  }
}`}
                </CodeBlock>
                <CodeBlock title="clone and run">
                  {`git clone https://github.com/LMXCloud/lmx-tool-storage.git
cd lmx-tool-storage
pnpm install
pnpm dev`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                pnpm v10+ ignores dependency build scripts by default — allow the package (so{" "}
                <code className="text-mono-sm">prepare</code> can compile{" "}
                <code className="text-mono-sm">dist/</code>) and the embedding runtime as shown
                above. When installed as a dependency, set{" "}
                <code className="text-mono-sm">LMX_STORAGE_DATA_DIR</code> so the SQLite file and
                embedding cache are not written inside{" "}
                <code className="text-mono-sm">node_modules</code>. Postgres is the production path
                (enables <code className="text-mono-sm">pgvector</code> on boot); SQLite is the
                zero-setup local default.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Import the Hono app, or start the server in-process:
              </p>
              <div className="mt-4">
                <CodeBlock title="TypeScript">
                  {`import { app } from "@lmxcloud/lmx-tool-storage/app";
import { start } from "@lmxcloud/lmx-tool-storage/server";

const server = await start({ host: "127.0.0.1", port: 8788 });
// server.host, server.port, await server.close()`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Routes</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                PUT/GET/query/search work with zero Grid config. Consolidation is the only route
                that calls out.
              </p>
              <div className="mt-4">
                <DataTable minWidth={640}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Method</DataTableTh>
                      <DataTableTh>Path</DataTableTh>
                      <DataTableTh>Body</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>GET</DataTableCell>
                      <DataTableCell mono>/health</DataTableCell>
                      <DataTableCell>—</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>PUT</DataTableCell>
                      <DataTableCell mono>/:namespace/:key</DataTableCell>
                      <DataTableCell>raw markdown (frontmatter + body)</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET</DataTableCell>
                      <DataTableCell mono>/:namespace/:key</DataTableCell>
                      <DataTableCell>stored markdown, byte-for-byte</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST</DataTableCell>
                      <DataTableCell mono>/:namespace/query</DataTableCell>
                      <DataTableCell>
                        <code className="text-mono-sm">{`{ "filter": { "field": value } }`}</code>
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST</DataTableCell>
                      <DataTableCell mono>/:namespace/search</DataTableCell>
                      <DataTableCell>
                        <code className="text-mono-sm">{`{ "query": "natural language", "top_k": 10 }`}</code>
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST</DataTableCell>
                      <DataTableCell mono>/:namespace/consolidate</DataTableCell>
                      <DataTableCell>no body</DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  <code className="text-mono-sm">POST /query</code> matches frontmatter by equality
                  or containment (including{" "}
                  <code className="text-mono-sm">{`{ "tags": "engagement" }`}</code> against{" "}
                  <code className="text-mono-sm">tags: [engagement, weekday]</code>). Empty{" "}
                  <code className="text-mono-sm">filter</code> returns the namespace, capped at 100.
                </li>
                <li>
                  <code className="text-mono-sm">POST /search</code> ranks documents by semantic
                  similarity of the query to each document body.{" "}
                  <code className="text-mono-sm">top_k</code> defaults to 10 and is capped at 100.
                  Each hit includes <code className="text-mono-sm">key</code>,{" "}
                  <code className="text-mono-sm">frontmatter</code>,{" "}
                  <code className="text-mono-sm">body</code>, and a cosine{" "}
                  <code className="text-mono-sm">score</code>. This sits beside{" "}
                  <code className="text-mono-sm">/query</code> — it does not replace it.
                </li>
                <li>
                  <code className="text-mono-sm">POST /consolidate</code> is a callable action, not
                  a background timer this service owns. Wire it from your own cron, a manual curl,
                  or an agent&apos;s scheduler. It pulls raw notes in the namespace that have not
                  yet been folded (
                  <code className="text-mono-sm">kind: reflection</code> notes and notes with{" "}
                  <code className="text-mono-sm">superseded_by</code> are skipped), clusters
                  near-duplicates with the local embedding model, sends the batch to Grid, writes
                  one new <code className="text-mono-sm">kind: reflection</code> note, and annotates
                  each folded original with <code className="text-mono-sm">superseded_by</code>.
                  Originals are never deleted. A second call on the same namespace is a no-op until
                  new raw notes arrive. Requires <code className="text-mono-sm">LMX_API_KEY</code>;
                  if unset, this route returns HTTP{" "}
                  <code className="text-mono-sm">503</code>.
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Round-trip</h3>
              <div className="mt-4 space-y-4">
                <CodeBlock title="PUT a document">
                  {`curl -sS -X PUT http://127.0.0.1:8788/lmx-social/post-1839 \\
  --data-binary @- <<'EOF'
---
post_id: "1839"
timestamp: "2026-08-20T14:00:00Z"
likes: 142
tags: [engagement, weekday]
---

Posts published 2-4pm on weekdays are outperforming the morning slot by ~30%.
EOF`}
                </CodeBlock>
                <CodeBlock title="GET it back — identical markdown">
                  {`curl -sS http://127.0.0.1:8788/lmx-social/post-1839`}
                </CodeBlock>
                <CodeBlock title="Query — exact-match / containment on frontmatter">
                  {`curl -sS -X POST http://127.0.0.1:8788/lmx-social/query \\
  -H "Content-Type: application/json" \\
  -d '{"filter":{"tags":"engagement"}}'`}
                </CodeBlock>
                <CodeBlock title="Semantic search — no shared keywords required">
                  {`curl -sS -X POST http://127.0.0.1:8788/lmx-social/search \\
  -H "Content-Type: application/json" \\
  -d '{"query":"when is the best time of day to publish?","top_k":3}'`}
                </CodeBlock>
                <CodeBlock title="Consolidate (needs LMX_API_KEY)">
                  {`curl -sS -X POST http://127.0.0.1:8788/demo-consolidate/consolidate`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Consolidation response includes the new reflection key and which originals it
                superseded. GET the reflection (
                <code className="text-mono-sm">kind: reflection</code>,{" "}
                <code className="text-mono-sm">supersedes: [...]</code>) or a superseded original
                — still stored, now annotated, never deleted.
              </p>
              <div className="mt-4">
                <CodeBlock title="Example consolidate response">
                  {`{
  "ok": true,
  "namespace": "demo-consolidate",
  "reflection": {
    "key": "reflection-2026-09-02T20-00-00-000Z",
    "frontmatter": {
      "kind": "reflection",
      "timestamp": "2026-09-02T20:00:00.000Z",
      "supersedes": ["post-1839", "post-1839-dup", "post-1901", "post-1841"]
    },
    "body": "..."
  },
  "superseded": [
    { "key": "post-1839", "superseded_by": "reflection-2026-09-02T20-00-00-000Z" }
  ],
  "clusters": [
    { "keys": ["post-1839", "post-1839-dup"], "near_duplicates": true }
  ]
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Env vars</h3>
              <div className="mt-4">
                <DataTable minWidth={640}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Variable</DataTableTh>
                      <DataTableTh>Default</DataTableTh>
                      <DataTableTh>Role</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>DATABASE_URL</DataTableCell>
                      <DataTableCell>unset → SQLite</DataTableCell>
                      <DataTableCell>Postgres connection</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMX_STORAGE_DATA_DIR</DataTableCell>
                      <DataTableCell mono>./data</DataTableCell>
                      <DataTableCell>
                        SQLite file + embedding model cache (set this when installed as a
                        dependency)
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>PORT / HOST</DataTableCell>
                      <DataTableCell mono>8788 / 0.0.0.0</DataTableCell>
                      <DataTableCell>Listen address</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMX_API_URL</DataTableCell>
                      <DataTableCell mono>https://api.lmxcloud.io</DataTableCell>
                      <DataTableCell>Grid — consolidation only</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMX_API_KEY</DataTableCell>
                      <DataTableCell>—</DataTableCell>
                      <DataTableCell>
                        Grid Bearer key — consolidation only. This service does not mint keys.
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>LMX_MODEL</DataTableCell>
                      <DataTableCell mono>mistral-nemo</DataTableCell>
                      <DataTableCell>Chat model for consolidation</DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>
            </DocSection>

            <DocSection id="agent-template" title="Agent template">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">lmx-agent-template</code> is an open-source, forkable
                starter kit for any <code className="text-mono-sm">lmx.*</code> agent. Clone it,
                rewrite one file (<code className="text-mono-sm">src/agent.ts</code>), and you have
                an agent that reasons via LMX Grid and remembers across runs via its own{" "}
                <a href="#vault" className="text-primary hover:text-primary-hover">
                  Vault
                </a>{" "}
                — with zero configuration for either.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Source:{" "}
                <a
                  href={AGENT_TEMPLATE_GITHUB}
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/LMXCloud/lmx-agent-template
                </a>
                . It is a public, forkable repo — not part of the LMXCloud.io deploy. Tool
                implementations never live here: the template holds URLs only, for Grid (
                <code className="text-mono-sm">LMX_API_URL</code>) and for this agent&apos;s own
                vault instance (<code className="text-mono-sm">LMX_STORAGE_URL</code>). Prefer the
                guided{" "}
                <Link to="/new-agent" className="text-primary hover:text-primary-hover">
                  New agent quickstart
                </Link>{" "}
                if you want copy-paste steps plus a live Connected check.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Zero-config quickstart</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Nothing else to start. Vault (<code className="text-mono-sm">lmx-tool-storage</code>
                ) is a dependency of the template and boots in-process on{" "}
                <code className="text-mono-sm">127.0.0.1:8788</code> with SQLite under{" "}
                <code className="text-mono-sm">./data</code>. One command, one terminal — no second
                process, no setup step. With no env vars set, the template auto-mints a free demo
                key via <code className="text-mono-sm">POST /v1/auth/key</code> and caches it to{" "}
                <code className="text-mono-sm">.lmx-identity.json</code> so a second run reuses the
                same identity (and therefore the same vault).
              </p>
              <div className="mt-4">
                <CodeBlock title="clone and run">
                  {`${agentCloneCommand()}
cd ${AGENT_TEMPLATE_DIR}
${agentRunCommand()}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                That should auto-generate a demo key and print it + starting balance, derive a vault
                namespace from that key, semantic-search its own namespace (empty on first run),
                call <code className="text-mono-sm">POST /v1/chat/completions</code>, print the
                answer and which provider served it, then PUT a note back to the vault.
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="Related follow-up — should recall the first note">
                  {`pnpm dev "What about for a job interview?"`}
                </CodeBlock>
                <CodeBlock title="Unrelated question — recall should be empty">
                  {`pnpm dev "How do I roast a chicken?"`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                The second run should show it recalled the first note (
                <code className="text-mono-sm">recall: 1 prior note(s)</code> with a similarity
                score). An unrelated third question should print{" "}
                <code className="text-mono-sm">recall: (none — no notes above similarity cutoff)</code>
                . Cutoff is <code className="text-mono-sm">RECALL_MIN_SCORE</code> in{" "}
                <code className="text-mono-sm">src/agent.ts</code> (default{" "}
                <code className="text-mono-sm">0.35</code>).
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Identity</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Resolved in priority order by <code className="text-mono-sm">src/identity.ts</code>:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  <code className="text-mono-sm">LMX_API_KEY</code> — Bearer auth with a pre-funded
                  key.
                </li>
                <li>
                  <code className="text-mono-sm">LMX_WALLET_PRIVATE_KEY</code> — wallet-identified
                  agent; x402 signing on Base via{" "}
                  <code className="text-mono-sm">@x402/core</code> +{" "}
                  <code className="text-mono-sm">@x402/evm</code> when Grid returns HTTP 402. Raw
                  keypair, no browser.
                </li>
                <li>
                  Neither set — mint a free demo key via{" "}
                  <code className="text-mono-sm">POST /v1/auth/key</code>, print the key + starting
                  balance.
                </li>
              </ol>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Whichever tier resolves, the vault namespace is derived from that same credential.
                The vault is addressable the instant identity exists — no separate namespace to
                configure. <code className="text-mono-sm">LMX_AGENT_NAMESPACE</code> can override
                it; it is not required.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">How to fork</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  Fork or clone the template into its own repo. Never copy it into a tools repo.
                </li>
                <li>
                  Register tool endpoints in <code className="text-mono-sm">src/tools.ts</code> as
                  URLs pointing at <code className="text-mono-sm">lmx-tool-*</code> services.
                </li>
                <li>
                  Rewrite <code className="text-mono-sm">src/agent.ts</code> — that is the one file
                  a fork is expected to own.
                </li>
                <li>
                  Keep identity, Grid client, vault client, settlement, and state unless you need to
                  extend them.
                </li>
              </ol>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Hard architectural rule: the template must contain zero tool implementation code.
                If you find yourself implementing storage, inference, PDF parsing, search, or any
                other capability inline instead of calling out to a URL, that logic belongs in a
                separate <code className="text-mono-sm">lmx-tool-*</code> service.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Local dashboard</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Same <code className="text-mono-sm">runAgent()</code> loop, second front door. The
                CLI (<code className="text-mono-sm">pnpm dev</code>) is unchanged. Storage still
                starts automatically unless <code className="text-mono-sm">LMX_STORAGE_URL</code>{" "}
                is set.
              </p>
              <div className="mt-4">
                <CodeBlock title="pnpm">
                  {`pnpm dev:ui`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Open <code className="text-mono-sm">http://127.0.0.1:3847</code>. The page binds
                localhost only — no auth, not for public exposure. Set{" "}
                <code className="text-mono-sm">LMX_STORAGE_URL</code> only if you want the agent to
                talk to a vault that is already running somewhere else (a Postgres-backed production
                instance, another host). When that variable is set, the template does not start
                storage itself.
              </p>
            </DocSection>

            <DocSection id="authentication" title="Authentication">
              <p className="text-body-md text-on-surface-muted">
                Inference endpoints require a bearer token. Keys use the format{" "}
                <code className="text-mono-sm text-on-surface">lmx_[32-char-hex]</code>.
              </p>
              <div className="mt-4">
                <CodeBlock title="Authorization header">
                  {`Authorization: Bearer lmx_YOUR_KEY`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Account-scoped endpoints (usage, balance, key management) accept your session token
                from the console or any valid API key tied to your account. Keys live under a
                project — existing accounts get an auto-created Default project. Create more
                projects in the console to separate keys and budgets per integration.
              </p>
            </DocSection>

            <DocSection id="wallet-auth" title="Wallet authentication">
              <p className="text-body-md text-on-surface-muted">
                Wallet sign-in is a first-class alternative to email/Clerk. Accounts are keyed by a
                verified Ethereum address via{" "}
                <a
                  href="https://eips.ethereum.org/EIPS/eip-4361"
                  className="text-primary hover:text-primary-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  Sign-In with Ethereum (SIWE)
                </a>
                . A successful verify returns a session token you use the same way as a Clerk
                session or API key on account endpoints.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">1. Request a nonce</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">POST /v1/auth/wallet/nonce</code> — rate-limited per
                IP (same limits as key generation).
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="Request body">
                  {`{
  "address": "0xYourWalletAddress"
}`}
                </CodeBlock>
                <CodeBlock title="Response">
                  {`{
  "object": "wallet_nonce",
  "address": "0xYourWalletAddress",
  "nonce": "a1b2c3d4e5f6...",
  "expires_at": "2026-07-06T20:30:00.000Z",
  "chain_id": 8453,
  "domain": "lmxcloud.io",
  "uri": "https://lmxcloud.io"
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">2. Sign and verify</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Build an EIP-4361 message using the returned{" "}
                <code className="text-mono-sm">domain</code>, <code className="text-mono-sm">uri</code>
                , <code className="text-mono-sm">chain_id</code>, and{" "}
                <code className="text-mono-sm">nonce</code>. The statement must be{" "}
                <code className="text-mono-sm">Sign in to LMX Cloud</code>. Sign with the wallet,
                then post the message and signature to{" "}
                <code className="text-mono-sm">POST /v1/auth/wallet/verify</code>.
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="Request body">
                  {`{
  "message": "<full EIP-4361 message string>",
  "signature": "0x..."
}`}
                </CodeBlock>
                <CodeBlock title="Response">
                  {`{
  "object": "session",
  "session_token": "eyJ...",
  "wallet": "0xYourWalletAddress",
  "api_key_id": "key_abc123",
  "created_account": true
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">created_account</code> is{" "}
                <code className="text-mono-sm">true</code> when this wallet had no prior account.
                New accounts receive the configured initial credit balance. Use the session token as{" "}
                <code className="text-mono-sm">Authorization: Bearer &lt;session_token&gt;</code> on
                account endpoints, or create additional API keys via{" "}
                <code className="text-mono-sm">POST /v1/auth/keys</code>.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Browser and script flows</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                The dashboard uses wagmi to connect a browser wallet, sign the SIWE message, and
                exchange it for a session. The same API works from a headless agent or script with a
                raw private key — no browser required. See{" "}
                <code className="text-mono-sm">scripts/wallet-auth.mjs</code> in the repository:
              </p>
              <div className="mt-4">
                <CodeBlock title="Agent / script sign-in">
                  {`WALLET_PRIVATE_KEY=0x... API_URL=${EXAMPLE_BASE} node scripts/wallet-auth.mjs`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Check whether a wallet already has an account with{" "}
                <code className="text-mono-sm">
                  GET /v1/auth/account?wallet=0xYourWalletAddress
                </code>{" "}
                — returns <code className="text-mono-sm">exists: true | false</code> for the given
                wallet.
              </p>
            </DocSection>

            <DocSection id="usdc-funding" title="Funding with USDC">
              <p className="text-body-md text-on-surface-muted">
                Wallet-linked accounts can fund inference by sending USDC on Base (or Base Sepolia in
                test configurations) to the LMX treasury. A background poller watches for ERC-20
                transfers and credits your account after enough on-chain confirmations. This is the
                production funding path — distinct from the dev-only self top-up endpoint.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Prerequisites</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  Have a verified <code className="text-mono-sm">wallet</code> on the account —
                  either sign in with a wallet via SIWE, or sign in with email and link a funding
                  wallet (
                  <code className="text-mono-sm">POST /v1/auth/wallet/link</code>) from Credits.
                </li>
                <li>
                  The API operator must configure{" "}
                  <code className="text-mono-sm">DATABASE_URL</code>,{" "}
                  <code className="text-mono-sm">BASE_RPC_URL</code>, and{" "}
                  <code className="text-mono-sm">TREASURY_ADDRESS</code> — deposit endpoints are
                  unavailable without all three.
                </li>
                <li>
                  Send USDC from the same address you verified. Transfers from other wallets are
                  recorded as <code className="text-mono-sm">unmatched</code> and are not credited
                  automatically.
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Link a funding wallet (email sessions)</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">POST /v1/auth/wallet/link</code> — requires an email
                (Clerk) session. Same SIWE message + signature as wallet sign-in. Attaches the
                verified address to all API keys on the email account so USDC deposits credit that
                balance. Rejects wallets already linked to a different account.
              </p>
              <div className="mt-4">
                <CodeBlock title="Request body">
                  {`{
  "message": "<EIP-4361 SIWE message>",
  "signature": "0x…"
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Get deposit instructions</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/billing/deposit-info</code> — requires
                authentication. Returns the treasury address, USDC contract, chain, and limits.
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="Response">
                  {`{
  "object": "deposit_info",
  "treasury_address": "0xTreasury...",
  "usdc_contract_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "chain": "base",
  "chain_id": 8453,
  "token": "USDC",
  "confirmations_required": 10,
  "min_deposit_usdc": 0.01,
  "max_deposit_usdc": 10000,
  "wallet": "0xYourVerifiedWallet",
  "note": "Send USDC on base from your verified wallet. Credits appear after confirmations."
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Transfer USDC to <code className="text-mono-sm">treasury_address</code> using a
                standard ERC-20 <code className="text-mono-sm">transfer</code> call. The dashboard
                Credits page can initiate this from a connected wallet; agents can send the transfer
                programmatically with viem, ethers, or any wallet library.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Confirmations and crediting</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                After your transaction is mined, the poller tracks block confirmations (default{" "}
                <code className="text-mono-sm">10</code>, configurable via{" "}
                <code className="text-mono-sm">DEPOSIT_CONFIRMATIONS</code>). Once the threshold is
                met and the sender matches a wallet-linked account, credits are added at 1 USDC = $1.00
                in inference balance. Deposits outside the min/max range are ignored.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Track status with{" "}
                <code className="text-mono-sm">GET /v1/billing/deposits</code> (wallet-linked
                accounts only). Each entry includes{" "}
                <code className="text-mono-sm">status</code> (
                <code className="text-mono-sm">pending</code>,{" "}
                <code className="text-mono-sm">credited</code>, or{" "}
                <code className="text-mono-sm">unmatched</code>), confirmation count, and{" "}
                <code className="text-mono-sm">credited_at</code> when complete.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Dev-only self top-up</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                For local development without on-chain transfers, set{" "}
                <code className="text-mono-sm">CREDITS_ALLOW_SELF_TOPUP=true</code> to enable{" "}
                <code className="text-mono-sm">POST /v1/credits/topup</code>. This instantly credits
                any authenticated account and is blocked in production. It does not require a
                wallet-linked account and does not touch the treasury.
              </p>
              <div className="mt-4">
                <CodeBlock title="Dev top-up (local only)">
                  {`curl -X POST ${EXAMPLE_BASE}/v1/credits/topup \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 10}'`}
                </CodeBlock>
              </div>
            </DocSection>

            <DocSection id="chat" title="Chat completions">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">POST /v1/chat/completions</code> accepts
                OpenAI-compatible request bodies. LMX routes to the best available provider and
                returns standard chat completion JSON. Message{" "}
                <code className="text-mono-sm">content</code> may be a plain string or an array of
                content parts (see Vision).
              </p>
              <div className="mt-4">
                <CodeBlock title="Request body">
                  {`{
  "model": "llama-3-70b",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Summarize DePIN inference."}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Optional routing preference via{" "}
                <code className="text-mono-sm">x-lmx-prefer</code> header — see Routing below.
              </p>
            </DocSection>

            <DocSection id="vision" title="Vision">
              <p className="text-body-md text-on-surface-muted">
                Vision-capable models accept OpenAI-style multimodal user messages:{" "}
                <code className="text-mono-sm">text</code> and{" "}
                <code className="text-mono-sm">image_url</code> parts. Image URLs may be public{" "}
                <code className="text-mono-sm">https://</code> links or{" "}
                <code className="text-mono-sm">data:image/...;base64,...</code> URIs.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Vision aliases today:{" "}
                {VISION_ALIASES.map((alias, i) => (
                  <span key={alias}>
                    {i > 0 ? ", " : ""}
                    <code className="text-mono-sm">{alias}</code>
                  </span>
                ))}
                . Sending image content to a text-only model returns HTTP 400 naming those aliases.
              </p>
              <div className="mt-4">
                <CodeBlock title="Vision request">
                  {`curl ${EXAMPLE_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-3.6-35b",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "https://example.com/photo.png"}}
      ]
    }]
  }'`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                On MCP, pass optional <code className="text-mono-sm">image_url</code> /{" "}
                <code className="text-mono-sm">images</code> to{" "}
                <code className="text-mono-sm">chat_completion</code> with a vision model. Vision
                traffic is still <code className="text-mono-sm">resource_type=chat</code> and is
                covered by existing reliability telemetry automatically.
              </p>
            </DocSection>

            <DocSection id="web-search" title="Web search">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">POST /v1/web/search</code> is a Brave Search
                passthrough behind LMX metering — not a DePIN{" "}
                <code className="text-mono-sm">ProviderAdapter</code> route. Requires a balance-funded
                API key. Fixed per-call price from{" "}
                <code className="text-mono-sm">GET /v1/pricing</code> →{" "}
                <code className="text-mono-sm">tools.web_search</code> (default $0.01 USDC).
              </p>
              <div className="mt-4">
                <CodeBlock title="Request">
                  {`curl ${EXAMPLE_BASE}/v1/web/search \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"DePIN GPU inference","max_results":5}'`}
                </CodeBlock>
              </div>
              <div className="mt-4">
                <CodeBlock title="Response shape">
                  {`{
  "object": "web.search",
  "query": "DePIN GPU inference",
  "provider": "brave",
  "results": [
    {"title": "...", "url": "https://...", "snippet": "..."}
  ]
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Operators set <code className="text-mono-sm">BRAVE_SEARCH_API_KEY</code> on the API
                service. Without it, the route returns 503. Usage is recorded as{" "}
                <code className="text-mono-sm">resource_type=web_search</code> (ops-filterable) but
                is not part of the DePIN multi-network reliability claim — see{" "}
                <code className="text-mono-sm">docs/web-search.md</code>.
              </p>
            </DocSection>

            <DocSection id="streaming" title="Streaming">
              <p className="text-body-md text-on-surface-muted">
                Set <code className="text-mono-sm">"stream": true</code> to receive Server-Sent
                Events (SSE). Token deltas follow the OpenAI streaming format. After the stream
                completes, LMX emits a final metadata event with billing details.
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="curl (streaming)">
                  {`curl -N ${EXAMPLE_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"Hi"}],"stream":true}'`}
                </CodeBlock>

                <CodeBlock title="Final SSE event (LMX metadata)">
                  {`event: lmx.meta
data: {
  "provider": "ionet",
  "fallback": false,
  "latencyMs": 842,
  "cost": 0.00001234,
  "balance": 0.99998766,
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 48,
    "total_tokens": 60
  }
}`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Stream responses also include{" "}
                <code className="text-mono-sm">x-lmx-provider</code>,{" "}
                <code className="text-mono-sm">x-lmx-fallback</code>, and{" "}
                <code className="text-mono-sm">x-lmx-latency</code> on the HTTP headers. Cost and
                balance arrive in the <code className="text-mono-sm">lmx.meta</code> event after
                usage is calculated.
              </p>
            </DocSection>

            <DocSection id="routing" title="Routing">
              <p className="text-body-md text-on-surface-muted">
                Control how requests are routed with the{" "}
                <code className="text-mono-sm">x-lmx-prefer</code> request header. When a provider
                fails, LMX automatically tries the next provider in the fallback chain.
              </p>
              <div className="mt-6">
                <DataTable minWidth={520}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Header value</DataTableTh>
                      <DataTableTh>Behavior</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>cheapest</DataTableCell>
                      <DataTableCell>Prefer lowest cost-per-token provider</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>fastest</DataTableCell>
                      <DataTableCell>Prefer lowest recent latency</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>depin-only</DataTableCell>
                      <DataTableCell>Only decentralized providers; no centralized fallback</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>provider:ionet</DataTableCell>
                      <DataTableCell>Try named provider first, then fallback chain</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>provider:aethir</DataTableCell>
                      <DataTableCell>Try Aethir Mesh first, then fallback chain</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>(omit)</DataTableCell>
                      <DataTableCell>Default tier order with health-aware prioritization</DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>
              <div className="mt-4">
                <CodeBlock title="Example with routing preference">
                  {`curl ${EXAMPLE_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer lmx_YOUR_KEY" \\
  -H "x-lmx-prefer: cheapest" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"Hello"}]}'`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                When a fallback provider serves the request,{" "}
                <code className="text-mono-sm">x-lmx-fallback: true</code> is set — no silent
                centralization.
              </p>
            </DocSection>

            <DocSection id="headers" title="Response headers">
              <p className="text-body-md text-on-surface-muted">
                Every successful chat completion includes LMX routing and billing metadata in
                response headers (non-streaming) or the final SSE event (streaming).
              </p>
              <div className="mt-6">
                <DataTable minWidth={640}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Header</DataTableTh>
                      <DataTableTh>Description</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>x-lmx-provider</DataTableCell>
                      <DataTableCell>Provider that served the request (e.g. ionet, akash, together)</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>x-lmx-fallback</DataTableCell>
                      <DataTableCell>
                        <code className="text-mono-sm">true</code> if a backup provider was used
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>x-lmx-latency</DataTableCell>
                      <DataTableCell>Upstream provider latency in milliseconds</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>x-lmx-cost</DataTableCell>
                      <DataTableCell>
                        Credits deducted for this request (USD). Non-streaming only.
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>x-lmx-balance</DataTableCell>
                      <DataTableCell>
                        Remaining credit balance after deduction. Non-streaming only.
                      </DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>
            </DocSection>

            <DocSection id="verifiable-logs" title="Verifiable logs">
              <p className="text-body-md text-on-surface-muted">
                Each inference writes a deterministic metadata receipt (provider, model, tokens,
                cost, latency, fallback flag, timestamp — never prompt or response content).
                Receipts use the <code className="text-mono-sm">lmx_receipt_v1</code> canonical
                format, hashed with keccak256 and stored on the usage log row. A background poller
                batches recent receipts into a Merkle tree and anchors the root on Base via the{" "}
                <code className="text-mono-sm">LmxLogAnchor</code> contract (
                <code className="text-mono-sm">anchor(bytes32 root)</code>). Anyone can verify a
                log was included in a published root without trusting the dashboard alone.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Only logs created after anchoring is enabled are verifiable — historical rows are not
                retroactively anchored.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Proof endpoint</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/usage/logs/:id/proof</code> — authenticated,
                same account scope as <code className="text-mono-sm">GET /v1/usage/logs</code>. Copy
                the log <code className="text-mono-sm">id</code> from your usage logs or the console
                logs page.
              </p>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                Returns <code className="text-mono-sm">status: pending</code> while the receipt
                waits in a batch, then <code className="text-mono-sm">status: anchored</code> with
                the canonical receipt, receipt hash, Merkle proof, root, and on-chain anchor metadata
                (chain, contract, tx hash, block).
              </p>
              <div className="mt-4 space-y-4">
                <CodeBlock title="Example (anchored)">
                  {`{
  "object": "usage_log_proof",
  "log_id": "451b75ae-0e38-42cc-8ffc-fc993bc36461",
  "status": "anchored",
  "receipt_version": "lmx_receipt_v1",
  "receipt": {
    "version": "lmx_receipt_v1",
    "id": "451b75ae-0e38-42cc-8ffc-fc993bc36461",
    "provider": "ionet",
    "model": "llama-3-70b",
    "prompt_tokens": 37,
    "completion_tokens": 8,
    "total_tokens": 45,
    "cost": "0.00000900",
    "latency_ms": 944,
    "fallback_used": false,
    "created_at": "2026-07-07T16:35:50.198Z"
  },
  "receipt_hash": "0x0369f2c4...",
  "leaf_index": 0,
  "merkle_proof": [],
  "merkle_root": "0x2b102516...",
  "anchor": {
    "chain_id": 84532,
    "contract_address": "0x51D2A68a5F43E44DfF6CbF1B5231270a6fb4ca03",
    "tx_hash": "0x40a651b9...",
    "block_number": "43836935",
    "anchored_at": "2026-07-07T16:35:58.346Z"
  }
}`}
                </CodeBlock>
              </div>

              <h3 className="mt-8 text-title-md text-on-surface">Public anchor status</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/status</code> includes an{" "}
                <code className="text-mono-sm">anchoring</code> object when configured:{" "}
                <code className="text-mono-sm">enabled</code>, <code className="text-mono-sm">chain_id</code>
                , <code className="text-mono-sm">contract_address</code>, and{" "}
                <code className="text-mono-sm">recent_roots</code> (Merkle root, tx hash, event
                count, timestamp). See the{" "}
                <Link to="/status" className="text-primary hover:text-primary-hover">
                  status page
                </Link>
                .
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Verify yourself</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                The repository includes a CLI that fetches the proof, recomputes the receipt hash,
                checks the Merkle proof, and reads <code className="text-mono-sm">anchoredAt</code>{" "}
                from the on-chain contract:
              </p>
              <div className="mt-4">
                <CodeBlock title="Verify from the CLI">
                  {`LOG_ID=<uuid-from-usage-logs> API_KEY=lmx_YOUR_KEY pnpm verify:receipt`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Self-hosters deploy the anchor contract with{" "}
                <code className="text-mono-sm">pnpm deploy:anchor</code> and set{" "}
                <code className="text-mono-sm">ANCHOR_CONTRACT_ADDRESS</code>,{" "}
                <code className="text-mono-sm">ANCHOR_PRIVATE_KEY</code>, and batch tuning via{" "}
                <code className="text-mono-sm">ANCHOR_BATCH_INTERVAL_MS</code> /{" "}
                <code className="text-mono-sm">ANCHOR_BATCH_MIN_EVENTS</code> (see{" "}
                <code className="text-mono-sm">.env.example</code>).
              </p>
            </DocSection>

            <DocSection id="pricing" title="Pricing (x402)">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/pricing</code> returns per-model list
                prices for x402 per-call payments, plus fixed tool prices under{" "}
                <code className="text-mono-sm">tools</code> (e.g.{" "}
                <code className="text-mono-sm">web_search</code>). Model prices use the cheapest
                healthy provider for each alias plus a 25% margin, with a $0.001 USDC minimum per
                call. No authentication required.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Add <code className="text-mono-sm">?model=llama-3-70b</code> for a single-model
                quote. Optional <code className="text-mono-sm">prompt_tokens</code>,{" "}
                <code className="text-mono-sm">max_tokens</code>, and{" "}
                <code className="text-mono-sm">max_completion_tokens</code> tune the ceiling
                estimate. Full pricing rules are in{" "}
                <code className="text-mono-sm">docs/x402-pricing.md</code>; web search details in{" "}
                <code className="text-mono-sm">docs/web-search.md</code>.
              </p>
              <div className="mt-4">
                <CodeBlock title="curl">
                  {`curl ${EXAMPLE_BASE}/v1/pricing?model=llama-3-70b&max_tokens=512`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Per-call x402 payment on{" "}
                <code className="text-mono-sm">POST /v1/chat/completions</code> is live on Base
                mainnet. Send a request without <code className="text-mono-sm">Authorization</code>{" "}
                to receive HTTP 402 with payment instructions, then retry with a{" "}
                <code className="text-mono-sm">PAYMENT-SIGNATURE</code> header (CDP facilitator
                verify + settle, <code className="text-mono-sm">upto</code> scheme). API-key
                balance billing continues to work unchanged. Streaming is not supported on the
                paid path yet (<code className="text-mono-sm">x402_stream_unsupported</code>).
              </p>
              <div className="mt-4">
                <CodeBlock title="curl (x402 probe)">
                  {`# Expect 402 with payment instructions\ncurl -i -X POST ${EXAMPLE_BASE}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"hi"}]}'`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                After a real mainnet settlement, the route is indexed on Coinbase&apos;s x402 Bazaar
                (Agentic.Market is the search UI over that index) — no separate signup form. The same
                dual path (balance key or x402) is available through{" "}
                <a href="#mcp" className="text-primary hover:text-primary-hover">
                  MCP
                </a>{" "}
                and the{" "}
                <a href="#eliza" className="text-primary hover:text-primary-hover">
                  ElizaOS plugin
                </a>
                .
              </p>
            </DocSection>

            <DocSection id="models" title="Models">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/models</code> returns aliases available from
                currently healthy providers. No authentication required. Vision-capable aliases:{" "}
                {VISION_ALIASES.map((alias, i) => (
                  <span key={alias}>
                    {i > 0 ? ", " : ""}
                    <code className="text-mono-sm">{alias}</code>
                  </span>
                ))}
                .
              </p>
              {modelsError && (
                <p className="mt-4 text-body-sm text-error">{modelsError}</p>
              )}
              <div className="mt-6">
                <DataTable title="Available models" minWidth={480}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Model ID</DataTableTh>
                      <DataTableTh>Primary provider</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {!models ? (
                      <DataTableEmpty colSpan={2}>Loading models…</DataTableEmpty>
                    ) : models.data.length === 0 ? (
                      <DataTableEmpty colSpan={2}>
                        No models available — all providers may be unhealthy. Check{" "}
                        <Link to="/status" className="text-primary hover:text-primary-hover">
                          status
                        </Link>
                        .
                      </DataTableEmpty>
                    ) : (
                      models.data.map((model) => (
                        <DataTableRow key={model.id}>
                          <DataTableCell mono>{model.id}</DataTableCell>
                          <DataTableCell>
                            <Chip tone="default">{model.owned_by}</Chip>
                          </DataTableCell>
                        </DataTableRow>
                      ))
                    )}
                  </DataTableBody>
                </DataTable>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Each provider maps aliases to its own upstream model ID. The router only tries
                providers that support the requested alias.
              </p>
              <div className="mt-6">
                <DataTable title="Alias → upstream model" minWidth={800}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>LMX alias</DataTableTh>
                      <DataTableTh>Upstream ID</DataTableTh>
                      <DataTableTh>io.net</DataTableTh>
                      <DataTableTh>AkashML</DataTableTh>
                      <DataTableTh>Aethir Mesh</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {CATALOG_MODELS.map((model) => (
                      <DataTableRow key={model.alias}>
                        <DataTableCell mono>{model.alias}</DataTableCell>
                        <DataTableCell mono>{model.upstreamId}</DataTableCell>
                        <DataTableCell>
                          {model.providers.includes("ionet") ? "✓" : "—"}
                        </DataTableCell>
                        <DataTableCell>
                          {model.providers.includes("akash") ? "✓" : "—"}
                        </DataTableCell>
                        <DataTableCell>
                          {model.providers.includes("aethir") ? "✓" : "—"}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Overlap varies by network: several aliases span io.net + AkashML + Aethir Mesh;
                others are single-network. Aethir Mesh activates when{" "}
                <code className="font-mono text-on-surface">AETHIR_API_KEY</code> is set (optional{" "}
                <code className="font-mono text-on-surface">AETHIR_BASE_URL</code>, default{" "}
                <code className="font-mono text-on-surface">https://mesh-api.aethir.com/v1</code>
                ). See the{" "}
                <Link to="/#models" className="text-primary hover:text-primary-hover">
                  landing page
                </Link>{" "}
                for labels grouped by family.
              </p>
            </DocSection>

            <DocSection id="roadmap" title="Roadmap">
              <p className="text-body-md text-on-surface-muted">
                LMX Cloud is Web3-native infrastructure for developers and autonomous agents. Here is
                what you can build on today and what is still in flight.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Shipped</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  OpenAI-compatible API — chat completions (including vision{" "}
                  <code className="text-mono-sm">image_url</code> content), models list, and
                  streaming with SSE metadata events.
                </li>
                <li>
                  Web search — <code className="text-mono-sm">POST /v1/web/search</code> and MCP{" "}
                  <code className="text-mono-sm">web_search</code> via Brave Search, fixed per-call
                  balance billing.
                </li>
                <li>
                  Multi-provider routing — io.net, AkashML, and Aethir Mesh with health-aware
                  fallback; routing preferences via{" "}
                  <code className="text-mono-sm">x-lmx-prefer</code>.
                </li>
                <li>
                  Transparent fallback — response headers and stream metadata show which provider
                  served the request and whether a backup was used.
                </li>
                <li>
                  Wallet authentication — SIWE sign-in for browser wallets and headless agents;
                  wallet-linked API keys and session tokens.
                </li>
                <li>
                  USDC funding on Base — on-chain deposits to treasury, automatic crediting after
                  confirmations, deposit history API.
                </li>
                <li>
                  x402 pay-per-call — dual path on{" "}
                  <code className="text-mono-sm">POST /v1/chat/completions</code> (Bearer balance
                  or anonymous USDC), pricing at <code className="text-mono-sm">GET /v1/pricing</code>
                  , and discovery on x402 Bazaar / Agentic.Market after mainnet settlement.
                </li>
                <li>
                  MCP server — hosted at <code className="text-mono-sm">https://mcp.lmxcloud.io/mcp</code>
                  , balance + x402 on <code className="text-mono-sm">chat_completion</code>, balance{" "}
                  <code className="text-mono-sm">web_search</code>, listed as{" "}
                  <code className="text-mono-sm">io.lmxcloud/mcp-server</code> in the official MCP
                  Registry.
                </li>
                <li>
                  ElizaOS plugin —{" "}
                  <code className="text-mono-sm">@lmxcloud/plugin-lmxcloud</code> on npm (wallet pays
                  USDC per call; no API key). Community registry PR open for curated catalog listing.
                </li>
                <li>
                  Verifiable routing logs — <code className="text-mono-sm">lmx_receipt_v1</code>{" "}
                  receipts, Merkle anchoring on Base via{" "}
                  <code className="text-mono-sm">LmxLogAnchor</code>, proof API, public anchor status,
                  and <code className="text-mono-sm">pnpm verify:receipt</code> CLI.
                </li>
                <li>
                  Developer dashboard — key management, usage charts, per-request logs, credits,
                  billing information, and provider status.
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Coming next</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  x402 on <code className="text-mono-sm">web_search</code> — balance path is live;
                  anonymous pay-per-call for search is deferred.
                </li>
                <li>
                  Embeddings and image generation — parked until a configured provider ships
                  embedding/image SKUs (io.net, AkashML, and Aethir Mesh are chat-only today).
                </li>
                <li>
                  x402 streaming — paid path currently returns{" "}
                  <code className="text-mono-sm">x402_stream_unsupported</code>; balance-funded
                  streaming remains available.
                </li>
                <li>
                  ElizaOS end-to-end agent walkthrough — npm package is live; formal agent soak +
                  registry merge still in progress.
                </li>
                <li>
                  Ops polish — public abuse/load hardening validation on anonymous x402, mainnet
                  log-anchor deploy, and optional push alerts for first-traffic-from-new-wallet
                  events.
                </li>
                <li>
                  Trust and legal —{" "}
                  <Link to="/legal/terms" className="text-primary hover:text-primary-hover">
                    Terms
                  </Link>
                  ,{" "}
                  <Link to="/legal/privacy" className="text-primary hover:text-primary-hover">
                    Privacy
                  </Link>
                  , and{" "}
                  <Link to="/legal/acceptable-use" className="text-primary hover:text-primary-hover">
                    Acceptable Use
                  </Link>{" "}
                  (beta drafts — attorney review still recommended for larger exposure).
                </li>
              </ul>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                If you are evaluating whether to build on LMX Cloud: inference (including vision),
                web search, routing, wallet identity, USDC funding, verifiable logs, x402
                pay-per-call, MCP (8 tools), and the ElizaOS plugin are live today. Phase 1
                distribution channels are findable; next work is reliability, trust, and traffic —
                not the payment plumbing itself.
              </p>
            </DocSection>

            <DocSection id="endpoints" title="Public endpoints">
              <p className="text-body-md text-on-surface-muted">
                These endpoints require no authentication:
              </p>
              <div className="mt-6">
                <DataTable minWidth={520}>
                  <DataTableHead>
                    <tr>
                      <DataTableTh>Endpoint</DataTableTh>
                      <DataTableTh>Description</DataTableTh>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/status</DataTableCell>
                      <DataTableCell>
                        Live provider health and fallback chain — see{" "}
                        <Link to="/status" className="text-primary hover:text-primary-hover">
                          status page
                        </Link>
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/pricing</DataTableCell>
                      <DataTableCell>
                        Per-model x402 list prices, optional quote, and fixed tool prices (e.g.{" "}
                        <code className="text-mono-sm">web_search</code>)
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/models</DataTableCell>
                      <DataTableCell>Models from healthy providers</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/auth/key</DataTableCell>
                      <DataTableCell>Create a throwaway API key (optional email). Wallet-linked accounts require SIWE.</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/auth/wallet/nonce</DataTableCell>
                      <DataTableCell>Issue a SIWE nonce for wallet sign-in</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/auth/wallet/verify</DataTableCell>
                      <DataTableCell>Verify a SIWE signature and return a session token</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/auth/wallet/link</DataTableCell>
                      <DataTableCell>
                        Link a SIWE-verified wallet to an email session for USDC funding
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/auth/account</DataTableCell>
                      <DataTableCell>Check if an email or wallet already has an account</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/auth/projects</DataTableCell>
                      <DataTableCell>
                        List projects for the signed-in account (creates Default if missing)
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/auth/projects</DataTableCell>
                      <DataTableCell>Create a named project to group API keys and budgets</DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/notifications</DataTableCell>
                      <DataTableCell>
                        Merged console feed: authored LMX Ops notices plus live account alerts
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>POST /v1/notifications/read</DataTableCell>
                      <DataTableCell>
                        Mark notification ids read for the signed-in account
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>GET /v1/auth/keys</DataTableCell>
                      <DataTableCell>
                        List account keys; optional <code className="text-mono-sm">?project_id=</code> filter
                      </DataTableCell>
                    </DataTableRow>
                    <DataTableRow>
                      <DataTableCell mono>DELETE /v1/auth/keys/:id</DataTableCell>
                      <DataTableCell>Revoke an API key so it stops working immediately</DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </div>
              <p className="mt-6 text-body-sm text-on-surface-muted">
                Authenticated (API key) surfaces include{" "}
                <code className="text-mono-sm">POST /v1/chat/completions</code> and{" "}
                <code className="text-mono-sm">POST /v1/web/search</code>. Chat also accepts
                anonymous x402 payment; web search is balance-path only today.
              </p>
            </DocSection>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-headline-md text-on-surface">{title}</h2>
      <div className={cn("mt-4")}>{children}</div>
    </section>
  );
}
