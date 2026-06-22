# LMX Cloud — DePIN Inference Router

OpenAI-compatible inference API that routes requests through decentralized compute networks.

## Phase 4 (current)

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
# Edit .env — IONET_API_KEY required; AKASHML and TOGETHER optional
pnpm dev
```

## Demo UI

Single-page "try it now" experience at `apps/demo` — generate a key, send inference, see which DePIN provider served the request.

```bash
# Terminal 1 — API (port 3000)
pnpm dev

# Terminal 2 — Demo UI (port 5173)
pnpm dev:demo
```

Open [http://localhost:5173](http://localhost:5173). Set `VITE_API_URL` in `apps/demo/.env` for production (e.g. `https://api.lmxcloud.io`).

**Deploy to production:** see [DEPLOY.md](./DEPLOY.md) for Railway + Vercel step-by-step.

## Test

Provider status (no auth):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/status"
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
packages/shared/  OpenAI-compatible TypeScript types
data/             Local API key store (gitignored)
```

## Supported models (aliases)

| LMX alias     | io.net model                          |
|---------------|---------------------------------------|
| `llama-3-70b` | `meta-llama/Llama-3.3-70B-Instruct`   |

Each provider maps aliases to its own upstream model ID.
