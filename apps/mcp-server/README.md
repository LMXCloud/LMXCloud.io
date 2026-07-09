# @lmxcloud/mcp-server

Lightweight MCP server scaffold for LMX Cloud.

## What it exposes

- `get_pricing`: calls `GET /v1/pricing`
- `list_models`: calls `GET /v1/models`
- `chat_completion`: calls `POST /v1/chat/completions` (OpenAI-compatible)
  - validates model IDs against live `GET /v1/models` before request dispatch

## Environment variables

- `LMX_API_BASE_URL` (default: `http://127.0.0.1:3000`)
- `LMX_API_KEY` (optional, but recommended for authenticated calls)
- `LMX_DEFAULT_MODEL` (default: `deepseek-v3.2`)
- `LMX_MCP_TRANSPORT` (`stdio` or `http`, default: `stdio`)
- `LMX_MCP_HOST` (HTTP mode only, default: `127.0.0.1`)
- `LMX_MCP_PORT` (HTTP mode only, default: `3334`)

## Local dev

From repo root:

```bash
pnpm install
pnpm dev:mcp
```

Or run package directly:

```bash
pnpm --filter @lmxcloud/mcp-server dev
```

## Run in hosted HTTP mode

```bash
pnpm --filter @lmxcloud/mcp-server dev:http
```

MCP endpoint: `http://127.0.0.1:3334/mcp`  
Health endpoint: `http://127.0.0.1:3334/healthz`

## Build

```bash
pnpm --filter @lmxcloud/mcp-server build
```

## Deploy as a standalone service (Railway)

Use a separate Railway service for MCP so API and MCP can scale independently.

1. Create a new Railway service from this repo.
2. In service settings:
   - **Root directory:** repo root
   - **Config file:** `apps/mcp-server/railway.toml`
3. Set environment variables:
   - `LMX_API_BASE_URL` -> your public API URL (for example `https://api.lmxcloud.io`)
   - `LMX_API_KEY` -> service key used by MCP tools
   - `LMX_DEFAULT_MODEL` -> `deepseek-v3.2`
   - `LMX_MCP_TRANSPORT` -> `http`
   - `LMX_MCP_HOST` -> `0.0.0.0`
   - `LMX_MCP_PORT` -> `3334` (Railway can map this automatically)
4. Generate a Railway domain and optionally map `mcp.lmxcloud.io`.
5. Verify:
   - `GET /healthz`
   - MCP endpoint at `https://<your-domain>/mcp`
