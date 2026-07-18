# LMX Cloud — OpenAI-Compatible Inference for Agents

OpenAI-compatible inference API that routes requests through decentralized compute (io.net, Akash) with automatic provider fallback. Built for developers **and** autonomous agents: wallet identity (SIWE), USDC funding on Base, x402 pay-per-call settlement, MCP tools, and verifiable routing logs.

**Live:** [lmxcloud.io](https://lmxcloud.io) · API `https://api.lmxcloud.io` · MCP `https://mcp.lmxcloud.io/mcp`

## Current capabilities

### Inference & routing
- Multi-provider routing with health-aware fallback and transparent `x-lmx-*` headers
- Streaming chat completions (SSE) with billing metadata
- Vision input on chat (OpenAI `image_url` content parts) for flagged models
- 30 model aliases mapped to healthy DePIN providers (`GET /v1/models`)
- Web search passthrough (`POST /v1/web/search`) via Brave Search — fixed per-call price

### Auth & funding
- Email sign-in (Clerk) or wallet sign-in (SIWE) with session tokens and API keys
- Internal credit balance per key; cost deducted after successful inference / search
- USDC deposits on Base credited after on-chain confirmations
- Dashboard at `apps/web` — keys, usage, billing, per-request logs, provider status

### x402 pay-per-call (no API key required)
- Dual path on `POST /v1/chat/completions`: Bearer key → balance, or anonymous USDC payment via x402 on Base
- `GET /v1/pricing` / quote for per-model list prices plus fixed `tools.web_search` price
- Coinbase CDP Facilitator verify + settle; payments persisted in `payment_events`
- Discoverable on **x402 Bazaar / Agentic.Market** via automatic catalog indexing after mainnet settlement

### Agent distribution
- **MCP server** (`apps/mcp-server`) — hosted at `https://mcp.lmxcloud.io/mcp`, published to the official MCP Registry as [`io.lmxcloud/mcp-server`](https://registry.modelcontextprotocol.io)
- Eight tools: `get_status`, `list_models`, `get_pricing`, `quote_price`, `get_balance`, `get_usage`, `chat_completion` (balance key **or** x402; optional vision images), `web_search` (balance key)
- **ElizaOS plugin** — [`@lmxcloud/plugin-lmxcloud`](https://www.npmjs.com/package/@lmxcloud/plugin-lmxcloud) (separate repo: [LMXCloud/plugin-lmxcloud](https://github.com/LMXCloud/plugin-lmxcloud)); x402-only, no API key — wallet pays USDC per call on Base

### Trust
- Per-request receipts and batched Merkle anchoring (verifiable proofs via `GET /v1/usage/logs/:id/proof`)

## Prerequisites

- Node.js 20+
- pnpm
- io.net API key from [ai.io.net](https://ai.io.net/ai/api-keys)
- Optional: [AkashML](https://akashml.com), [Nosana](https://deploy.nosana.com) (`NOSANA_API_KEY` + per-model `NOSANA_ENDPOINTS`), and [Together.ai](https://api.together.xyz) keys for fallback tiers
- Optional: [Brave Search API](https://brave.com/search/api/) key (`BRAVE_SEARCH_API_KEY`) to enable `web_search` / `POST /v1/web/search`

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — IONET_API_KEY and SESSION_SECRET required; DATABASE_URL recommended
pnpm dev
```

### Web3 environment variables

Wallet auth and USDC deposits are configured in `apps/api/src/config.ts`. Set these in `.env` when running wallet sign-in or on-chain funding locally:

| Variable | Purpose | Default |
|----------|---------|---------|
| `SIWE_DOMAIN` | EIP-4361 domain in SIWE messages | `localhost` |
| `SIWE_URI` | EIP-4361 URI (dashboard origin) | `http://localhost:5173` |
| `SIWE_CHAIN_ID` | Chain ID for SIWE and deposits | `8453` (Base mainnet); use `84532` for Base Sepolia |
| `BASE_RPC_URL` | JSON-RPC URL for deposit poller | — (required with treasury for deposits) |
| `TREASURY_ADDRESS` | Wallet that receives USDC deposits | — |
| `USDC_CONTRACT_ADDRESS` | ERC-20 USDC contract on the chain | Base mainnet or Sepolia USDC if unset |
| `DEPOSIT_CONFIRMATIONS` | Block confirmations before crediting | `10` |
| `DEPOSIT_POLL_INTERVAL_MS` | How often the poller scans blocks | `15000` |
| `DEPOSIT_LOOKBACK_BLOCKS` | Blocks scanned on first poll | `100` |
| `DEPOSIT_MAX_USDC` | Maximum single deposit amount | `10000` |
| `CREDITS_ALLOW_SELF_TOPUP` | Enable `POST /v1/credits/topup` (dev only) | `true` in `.env.example` |
| `CLERK_SECRET_KEY` | Verify Clerk session tokens from the dashboard | — |
| `SESSION_SECRET` | Sign dashboard/wallet session tokens | required at boot |
| `SESSION_TTL_MS` | Session token lifetime | 30 days |

Deposits activate only when `DATABASE_URL`, `BASE_RPC_URL`, and `TREASURY_ADDRESS` are all set. `CREDITS_ALLOW_SELF_TOPUP` must not be enabled in production.

For x402 pay-per-call locally, also set `X402_ENABLED=true`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and treasury/chain vars. See `docs/x402-pricing.md`, `docs/x402-verification.md`, and [DEPLOY.md](./DEPLOY.md).

For web search, set `BRAVE_SEARCH_API_KEY` (optional `WEB_SEARCH_PRICE_USDC`, default `$0.01`/call). See [docs/web-search.md](./docs/web-search.md).

## Wallet auth and USDC funding (local)

**Wallet sign-in (SIWE)** — alternative to Clerk email sign-in:

1. `POST /v1/auth/wallet/nonce` with `{ "address": "0x..." }` — returns nonce, `domain`, `uri`, and `chain_id`.
2. Sign an EIP-4361 message with statement `Sign in to LMX Cloud`.
3. `POST /v1/auth/wallet/verify` with `{ "message", "signature" }` — returns `session_token` and `api_key_id`.

Headless agent example (no browser):

```bash
WALLET_PRIVATE_KEY=0x... API_URL=http://localhost:3000 node scripts/wallet-auth.mjs
```

**USDC funding** — requires a wallet-linked account (SIWE sign-in) and deposit env vars above:

1. Authenticate with your `session_token` or API key.
2. `GET /v1/billing/deposit-info` — treasury address, USDC contract, limits, and your verified wallet.
3. Send USDC via ERC-20 `transfer` from that wallet to the treasury on Base.
4. `GET /v1/billing/deposits` — track `pending` → `credited` (or `unmatched` if sent from the wrong address).

For quick local testing without on-chain transfers, keep `CREDITS_ALLOW_SELF_TOPUP=true` and use `POST /v1/credits/topup` with `{ "amount": 10 }` — this bypasses the treasury entirely.

See [http://localhost:5173/docs](http://localhost:5173/docs) for full request/response shapes.

## x402 pay-per-call

Agents with a funded Base wallet can call inference **without** an LMX API key. Omit `Authorization`, receive `402 Payment Required`, sign and attach an x402 payment payload, then retry — CDP verifies, LMX routes, then settles in USDC.

```bash
# Unpaid probe (expect 402)
curl -i https://api.lmxcloud.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"hi"}]}'

# Paid E2E (local / mainnet canary harness)
pnpm --filter @lmxcloud/api test:x402 -- --pay
pnpm --filter @lmxcloud/api test:x402:mainnet-canary
```

Pricing: `GET /v1/pricing`. The same route is indexed on Coinbase’s x402 Bazaar (Agentic.Market is the search UI over that index) after a real mainnet settlement.

## Demo UI

Single-page "try it now" experience at `apps/demo` — generate a key, send inference, see which DePIN provider served the request.

```bash
# Terminal 1 — API (port 3000)
pnpm dev

# Terminal 2 — Demo UI (port 5174)
pnpm dev:demo
```

Open [http://localhost:5174](http://localhost:5174). Set `VITE_API_URL` in `apps/demo/.env` for production (e.g. `https://api.lmxcloud.io`).

## Dashboard (`apps/web`)

Account dashboard for managing multiple API keys, viewing usage charts, and topping up credits.

```bash
# Terminal 1 — API (port 3000)
pnpm dev

# Terminal 2 — Dashboard (port 5173)
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173) — redirects to sign in or sign up if you are not logged in.

**Deploy to production:** see [DEPLOY.md](./DEPLOY.md) for Railway + Vercel step-by-step.

## MCP server (`apps/mcp-server`)

LMX ships a hosted MCP server so agents can discover pricing, check balance, and run inference as tools — no hand-written REST calls.

**Production:** `https://mcp.lmxcloud.io/mcp` (health: `/healthz`)

**Registry:** [`io.lmxcloud/mcp-server`](https://registry.modelcontextprotocol.io) (streamable HTTP remote)

**Tools (8):** `get_status`, `list_models`, `get_pricing`, `quote_price`, `get_balance`, `get_usage`, `chat_completion`, `web_search`

`chat_completion` accepts an API key **or** x402 pay-per-call when no key is provided. Optional `image_url` / `images` enable vision on models such as `qwen-3.6-35b`, `qwen-3.5-35b`, and `llama-3.2-90b-vision`.

`web_search` requires a balance-funded API key (Brave passthrough; fixed per-call price from `GET /v1/pricing` → `tools.web_search`).

**Client config** (`.cursor/mcp.json` in any repo):

```json
{
  "mcpServers": {
    "lmxcloud": {
      "url": "https://mcp.lmxcloud.io/mcp",
      "headers": {
        "Authorization": "Bearer lmx_YOUR_KEY"
      }
    }
  }
}
```

Create a key at [lmxcloud.io/console/keys](https://lmxcloud.io/console/keys). Full docs: `/docs#mcp`.

```bash
# stdio (local dev)
pnpm dev:mcp

# hosted streamable HTTP (local)
pnpm dev:mcp:http
```

HTTP mode endpoints (local):

- `http://127.0.0.1:3334/mcp`
- `http://127.0.0.1:3334/healthz`

Production deploy instructions are in [DEPLOY.md](./DEPLOY.md) under the Railway MCP section.

## ElizaOS plugin

Separate package (not in this monorepo): [`@lmxcloud/plugin-lmxcloud`](https://www.npmjs.com/package/@lmxcloud/plugin-lmxcloud)

- Registers `TEXT_SMALL` / `TEXT_LARGE` model handlers against `https://api.lmxcloud.io/v1/chat/completions`
- Pays per call with x402 (`@x402/core` + `@x402/evm`) — one config value: an EVM private key funded with USDC on Base
- Source: [github.com/LMXCloud/plugin-lmxcloud](https://github.com/LMXCloud/plugin-lmxcloud)

## Test

**API docs:** [http://localhost:5173/docs](http://localhost:5173/docs) — overview, quickstart, MCP, ElizaOS plugin, wallet auth, USDC funding, x402, routing, streaming, and roadmap.

**Provider status:** [http://localhost:5173/status](http://localhost:5173/status) — live health from `GET /v1/status` (no auth).

Quick smoke test:

```bash
curl http://localhost:3000/v1/status
curl http://localhost:3000/v1/models
```

Generate an API key and send a chat completion:

```bash
KEY=$(curl -s -X POST http://localhost:3000/v1/auth/key \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}' | jq -r .api_key)

curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "x-lmx-prefer: cheapest" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"Hello from LMX Cloud"}]}'
```

Vision example (image URL or `data:image/...;base64,...`):

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"qwen-3.6-35b",
    "messages":[{
      "role":"user",
      "content":[
        {"type":"text","text":"What is in this image?"},
        {"type":"image_url","image_url":{"url":"https://example.com/photo.png"}}
      ]
    }]
  }'
```

Web search (requires `BRAVE_SEARCH_API_KEY` on the API):

```bash
curl http://localhost:3000/v1/web/search \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"DePIN GPU inference","max_results":5}'
```

Response headers: `x-lmx-provider`, `x-lmx-fallback`, `x-lmx-latency`, `x-lmx-cost`, `x-lmx-balance`.

Authenticated endpoints (usage, balance, keys) use the same `Authorization: Bearer lmx_...` header — see the docs page for full reference.

## Fallback chain

| Tier | Provider   | Type        | Required key     |
|------|------------|-------------|------------------|
| 1    | io.net     | DePIN       | `IONET_API_KEY`  |
| 2    | AkashML    | DePIN       | `AKASHML_API_KEY`|
| 3    | Nosana     | DePIN       | `NOSANA_API_KEY` + `NOSANA_ENDPOINTS` |
| 4    | Together   | Centralized | `TOGETHER_API_KEY`|

Providers without API keys are skipped. Nosana is **per-deployment** (no shared gateway): `NOSANA_ENDPOINTS` is a JSON map of LMX alias → `https://<job-id>.node.k8s.prd.nos.ci/v1` (optional `{ baseUrl, upstreamId }` when the served model name differs). When Tier 4 serves a request, `x-lmx-fallback` and `x-lmx-provider` reflect it — no silent centralization.

## Project structure

```
apps/api/         Inference API (Fastify)
apps/mcp-server/  Hosted MCP + x402 tools
apps/web/         Dashboard (Vite + React)
apps/demo/        Demo UI
apps/ops/         Internal ops dashboard
apps/cli/         CLI helpers
packages/shared/  OpenAI-compatible types + model catalog
packages/x402/    Shared CDP/x402 resource-server helpers
data/             Local API key store (gitignored)
```

Repos: [LMXCloud/LMXCloud.io](https://github.com/LMXCloud/LMXCloud.io) · [LMXCloud/plugin-lmxcloud](https://github.com/LMXCloud/plugin-lmxcloud)

## Supported models (aliases)

LMX exposes **30 short aliases** mapped to io.net, AkashML, and Nosana upstream IDs. The catalog lives in `packages/shared/src/models.ts` and is verified with live chat completions.

`GET /v1/models` returns aliases from **healthy** providers only. The router skips providers that do not support the requested alias.

| LMX alias | Upstream ID | io.net | AkashML | Nosana | Notes |
|-----------|-------------|:------:|:-------:|:------:|-------|
| `llama-3-70b` | `meta-llama/Llama-3.3-70B-Instruct` | ✓ | ✓ | ✓ | |
| `llama-3.3-70b` | same | ✓ | ✓ | ✓ | |
| `qwen-3.6-35b` | `Qwen/Qwen3.6-35B-A3B` | ✓ | ✓ | ✓ | vision |
| `deepseek-v4-flash` | `deepseek-ai/DeepSeek-V4-Flash` | ✓ | ✓ | | |
| `glm-5.2` | `zai-org/GLM-5.2` | ✓ | ✓ | | |
| `qwen-3.5-35b` | `Qwen/Qwen3.5-35B-A3B` | | ✓ | ✓ | vision |
| `llama-3.2-90b-vision` | `meta-llama/Llama-3.2-90B-Vision-Instruct` | ✓ | | | vision |
| `deepseek-r1` | `deepseek-ai/DeepSeek-R1-0528` | ✓ | | ✓ | |
| `gpt-oss-120b` | `openai/gpt-oss-120b` | ✓ | | ✓ | |

Plus other io.net / Nosana overlaps (`qwen-3.6-27b`, `glm-4.7-flash`, `gpt-oss-20b`, `gemma-4-26b`, …). See the [landing page models section](http://localhost:5173/#models) or `packages/shared/src/models.ts` for the full list. Vision-capable aliases accept OpenAI-style `image_url` content parts; text-only models reject image content with HTTP 400.
