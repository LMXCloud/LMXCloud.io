# LMX Cloud — DePIN Inference Router

OpenAI-compatible inference API that routes requests through decentralized compute networks.

## Phase 7 (current)

- Full dashboard at `apps/web` — overview, key management, usage charts, billing
- `GET /v1/usage/history` for daily usage charts
- Enriched `GET /v1/auth/keys` with balance and usage per key

## Phase 6

- Internal credit balance per API key (USD)
- Cost deducted per inference from provider token rates
- `GET /v1/balance`, optional `POST /v1/credits/topup` (dev)
- Demo UI shows balance, cost, and low-balance warnings

## Phase 5

- Neon Postgres storage for API keys + usage (`DATABASE_URL`)
- Key management — `GET /v1/auth/keys`, `DELETE /v1/auth/key`
- Chat rate limiting per API key
- `GET /v1/models` — models from healthy providers

## Phase 4

- Usage tracking per API key — `GET /v1/usage`
- Demo UI shows cumulative key usage after inference

## Phase 3

- Multi-provider routing: io.net, AkashML (optional), Together.ai (optional)
- Health monitor — polls providers every 30s
- Routing strategies via `x-lmx-prefer`: `cheapest`, `fastest`, `depin-only`, `provider:ionet`
- Automatic fallback chain on provider failure
- `GET /v1/status` — live provider health and fallback chain

## Phase 2

- API key auth (`lmx_[32-char-hex]`) on inference endpoints
- `POST /v1/auth/key` — generate a new API key

## Phase 1

- Fastify API server with `POST /v1/chat/completions`
- io.net Intelligence provider adapter
- OpenAI-compatible request/response format

## Prerequisites

- Node.js 20+
- pnpm
- io.net API key from [ai.io.net](https://ai.io.net/ai/api-keys)
- Optional: [AkashML](https://akashml.com) and [Together.ai](https://api.together.xyz) keys for fallback tiers

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — IONET_API_KEY required; DATABASE_URL recommended for Postgres storage
pnpm dev
```

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

## Test

Provider status (no auth):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/status"
Invoke-RestMethod -Uri "http://localhost:3000/v1/models"
```

Generate an API key:

```powershell
$key = (Invoke-RestMethod -Uri "http://localhost:3000/v1/auth/key" -Method POST -ContentType "application/json" -Body '{"email":"you@example.com"}').api_key
```

Chat with routing preference:

```powershell
$headers = @{
  Authorization = "Bearer $key"
  "x-lmx-prefer" = "cheapest"
}
Invoke-RestMethod -Uri "http://localhost:3000/v1/chat/completions" -Method POST -ContentType "application/json" -Headers $headers -Body '{"model":"llama-3-70b","messages":[{"role":"user","content":"Hello from LMX Cloud"}]}'
```

Response headers: `x-lmx-provider`, `x-lmx-fallback`, `x-lmx-latency`.

Usage for your key:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/usage" -Headers @{ Authorization = "Bearer $key" }
```

Credit balance:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/balance" -Headers @{ Authorization = "Bearer $key" }
```

List keys (same email/wallet, or current key only):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/auth/keys" -Headers @{ Authorization = "Bearer $key" }
```

Revoke current key:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/auth/key" -Method DELETE -Headers @{ Authorization = "Bearer $key" }
```

## Fallback chain

| Tier | Provider   | Type        | Required key     |
|------|------------|-------------|------------------|
| 1    | io.net     | DePIN       | `IONET_API_KEY`  |
| 2    | AkashML    | DePIN       | `AKASHML_API_KEY`|
| 4    | Together   | Centralized | `TOGETHER_API_KEY`|

Providers without API keys are skipped. When Tier 4 serves a request, `x-lmx-fallback` and `x-lmx-provider` reflect it — no silent centralization.

## Project structure

```
apps/api/src/     API server
apps/demo/        Demo UI (Vite + React)
apps/web/         Dashboard (Vite + React)
packages/shared/  OpenAI-compatible TypeScript types
data/             Local API key store (gitignored)
```

## Supported models (aliases)

| LMX alias     | io.net model                          |
|---------------|---------------------------------------|
| `llama-3-70b` | `meta-llama/Llama-3.3-70B-Instruct`   |

Each provider maps aliases to its own upstream model ID.
