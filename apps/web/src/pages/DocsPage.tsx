import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listUniqueModelAliases } from "@lmxcloud/shared";
import { API_BASE, fetchModels, type ModelsResponse } from "../api";
import { PublicLayout } from "../components/PublicLayout";
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
import { cn } from "../lib/cn";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "mcp", label: "MCP" },
  { id: "authentication", label: "Authentication" },
  { id: "wallet-auth", label: "Wallet authentication" },
  { id: "usdc-funding", label: "Funding with USDC" },
  { id: "chat", label: "Chat completions" },
  { id: "streaming", label: "Streaming" },
  { id: "routing", label: "Routing" },
  { id: "headers", label: "Response headers" },
  { id: "verifiable-logs", label: "Verifiable logs" },
  { id: "models", label: "Models" },
  { id: "roadmap", label: "Roadmap" },
  { id: "endpoints", label: "Public endpoints" },
] as const;

const EXAMPLE_BASE = API_BASE;

const CATALOG_MODELS = listUniqueModelAliases();

export function DocsPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    void fetchModels()
      .then(setModels)
      .catch((err) =>
        setModelsError(err instanceof Error ? err.message : "Failed to load models"),
      );
  }, []);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)] py-10 sm:py-14">
        <PageHeader
          eyebrow="Developers"
          title="API documentation"
          description="OpenAI-compatible inference routed through decentralized compute — evolving into Web3-native infrastructure for developers and autonomous agents."
          actions={
            <Button to="/sign-up" size="sm">
              Get API key
            </Button>
          }
        />

        <div className="mt-10 grid gap-10 lg:grid-cols-[200px_1fr]">
          <nav className="hidden lg:block">
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
                decentralized compute networks — primarily io.net and Akash — with automatic
                fallback when a provider is slow or unavailable. Drop in your existing SDK, change
                the base URL and API key, and you get the same chat completions interface you
                already use, backed by DePIN infrastructure instead of a single centralized vendor.
              </p>
              <p className="mt-4 text-body-md text-on-surface-muted">
                The longer-term direction is Web3-native infrastructure: wallet-based identity
                (Sign-In with Ethereum), on-chain stablecoin funding, and cryptographically
                verifiable routing logs. The goal is not just a DePIN-backed API proxy, but real
                infrastructure that both human developers and autonomous agents can authenticate to,
                fund, and audit without a traditional account stack.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Today you can sign in with email (Clerk) or a wallet, pay for inference with USDC
                on Base, route across multiple providers with transparent fallback, and independently
                verify usage receipts anchored on Base. The sections below are the technical reference;
                see{" "}
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
                LMX Cloud ships an MCP server package (
                <code className="text-mono-sm">@lmxcloud/mcp-server</code>) so agents can call
                inference as tools instead of hand-writing REST calls.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Current MCP tools:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  <code className="text-mono-sm">get_pricing</code> — fetches{" "}
                  <code className="text-mono-sm">GET /v1/pricing</code>
                </li>
                <li>
                  <code className="text-mono-sm">list_models</code> — fetches{" "}
                  <code className="text-mono-sm">GET /v1/models</code>
                </li>
                <li>
                  <code className="text-mono-sm">chat_completion</code> — calls{" "}
                  <code className="text-mono-sm">POST /v1/chat/completions</code> with model
                  pre-validation against live supported models
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Cursor config (outside repo demo)</h3>
              <p className="mt-2 text-body-sm text-on-surface-muted">
                In any other repository, add a{" "}
                <code className="text-mono-sm">.cursor/mcp.json</code> file that points back to your
                LMX Cloud repo:
              </p>
              <div className="mt-4">
                <CodeBlock title=".cursor/mcp.json">
                  {`{
  "mcpServers": {
    "lmxcloud-local": {
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
        "LMX_DEFAULT_MODEL": "deepseek-v3.2"
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
                  {`1) list_models
2) get_pricing
3) chat_completion(prompt="Reply with exactly: MCP test passed.", model="deepseek-v3.2")`}
                </CodeBlock>
              </div>
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
                from the console or any valid API key tied to your account.
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
                  <code className="text-mono-sm">POST /v1/auth/wallet/link</code>) from Billing.
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
                billing page can initiate this from a connected wallet; agents can send the transfer
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
                returns standard chat completion JSON.
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
                prices for x402 per-call payments. Prices are based on the cheapest healthy
                provider for each alias plus a 25% margin, with a $0.001 USDC minimum per call.
                No authentication required.
              </p>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Add <code className="text-mono-sm">?model=llama-3-70b</code> for a single-model
                quote. Optional <code className="text-mono-sm">prompt_tokens</code>,{" "}
                <code className="text-mono-sm">max_tokens</code>, and{" "}
                <code className="text-mono-sm">max_completion_tokens</code> tune the ceiling
                estimate. Full pricing rules are in{" "}
                <code className="text-mono-sm">docs/x402-pricing.md</code>.
              </p>
              <div className="mt-4">
                <CodeBlock title="curl">
                  {`curl ${EXAMPLE_BASE}/v1/pricing?model=llama-3-70b&max_tokens=512`}
                </CodeBlock>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Per-call x402 payment on <code className="text-mono-sm">POST /v1/chat/completions</code>{" "}
                is live when <code className="text-mono-sm">X402_ENABLED=true</code>. Send a request
                without <code className="text-mono-sm">Authorization</code> to receive HTTP 402 with
                payment instructions, then retry with a <code className="text-mono-sm">PAYMENT-SIGNATURE</code>{" "}
                header. API-key balance billing continues to work unchanged.
              </p>
              <div className="mt-4">
                <CodeBlock title="curl (x402 probe)">
                  {`# Expect 402 with payment instructions\ncurl -i -X POST ${EXAMPLE_BASE}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"hi"}]}'`}
                </CodeBlock>
              </div>
            </DocSection>

            <DocSection id="models" title="Models">
              <p className="text-body-md text-on-surface-muted">
                <code className="text-mono-sm">GET /v1/models</code> returns aliases available from
                currently healthy providers. No authentication required.
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
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                Five models are on both io.net and AkashML; the rest route through io.net when
                configured. See the{" "}
                <Link to="/#models" className="text-primary hover:text-primary-hover">
                  landing page
                </Link>{" "}
                for labels grouped by family.
              </p>
            </DocSection>

            <DocSection id="roadmap" title="Roadmap">
              <p className="text-body-md text-on-surface-muted">
                LMX Cloud is actively evolving from a DePIN inference router into Web3-native
                infrastructure. Here is what you can build on today and what is coming next.
              </p>

              <h3 className="mt-8 text-title-md text-on-surface">Shipped</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  OpenAI-compatible API — chat completions, models list, and streaming with SSE
                  metadata events.
                </li>
                <li>
                  Multi-provider routing — io.net and Akash with health-aware fallback; routing
                  preferences via <code className="text-mono-sm">x-lmx-prefer</code>.
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
                  Verifiable routing logs — <code className="text-mono-sm">lmx_receipt_v1</code>{" "}
                  receipts, Merkle anchoring on Base via <code className="text-mono-sm">LmxLogAnchor</code>
                  , proof API, public anchor status, and <code className="text-mono-sm">pnpm verify:receipt</code>{" "}
                  CLI.
                </li>
                <li>
                  Developer dashboard — key management, usage charts, per-request logs, billing, and
                  provider status.
                </li>
              </ul>

              <h3 className="mt-8 text-title-md text-on-surface">Coming next</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-on-surface-muted">
                <li>
                  Agent-native payments (x402) — per-request USDC payment on{" "}
                  <code className="text-mono-sm">POST /v1/chat/completions</code> when{" "}
                  <code className="text-mono-sm">X402_ENABLED=true</code>; pricing catalog at{" "}
                  <code className="text-mono-sm">GET /v1/pricing</code>.
                </li>
                <li>
                  Distribution — x402 Bazaar and Agentic.Market listing, MCP server, and ElizaOS
                  plugin so agents can find LMX Cloud through standard discovery channels.
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
                  (beta drafts — attorney review before public listings).
                </li>
              </ul>
              <p className="mt-4 text-body-sm text-on-surface-muted">
                If you are evaluating whether to build on LMX Cloud: inference, routing, wallet
                identity, USDC funding, and verifiable logs are live today on Base. Agent-native
                per-call payments are the next layer for autonomous discovery and consumption.
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
                        Per-model x402 list prices and optional quote for a single model
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
                  </DataTableBody>
                </DataTable>
              </div>
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
