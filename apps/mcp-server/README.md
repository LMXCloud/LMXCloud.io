# @lmxcloud/mcp-server

Lightweight MCP server for LMX Cloud.

## What it exposes

| Tool | API | Auth |
|------|-----|------|
| `get_pricing` | `GET /v1/pricing` | Public |
| `quote_price` | `GET /v1/pricing?model=...` | Public |
| `list_models` | `GET /v1/models` | Public |
| `get_status` | `GET /v1/status` | Public |
| `get_balance` | `GET /v1/balance` | API key required |
| `get_usage` | `GET /v1/usage` | API key required |
| `chat_completion` | `POST /v1/chat/completions` | API key **or** x402 pay-per-call |
| `web_search` | `POST /v1/web/search` | API key required |

Suggested agent flow: `get_status` → `list_models` → `quote_price` → `get_balance` → `chat_completion` / `web_search` → `get_usage`.

### `chat_completion`

- `prompt` (required), optional `model`, `max_tokens`, `temperature`, `api_key`
- Optional vision: `image_url` and/or `images` (https URL or `data:image/...;base64,...`)
- Use a vision-capable model such as `qwen-3.6-35b`, `qwen-3.5-35b`, or `llama-3.2-90b-vision`

### `web_search`

- `query` (required), optional `max_results` (1–20, default 5), `api_key`
- Fixed per-call price from `GET /v1/pricing` → `tools.web_search` (default `$0.01`)
- Requires `BRAVE_SEARCH_API_KEY` on the API service; see [docs/web-search.md](../../docs/web-search.md)

## Per-user API key passthrough

Each caller can bring their own `lmx_...` key. Resolution order:

1. `api_key` tool argument (optional override per call)
2. `Authorization: Bearer lmx_...` header (hosted MCP / Cursor)
3. `LMX_API_KEY` in MCP client env (local stdio only)

`chat_completion` and `web_search` validate the key against `GET /v1/usage` before calling the API and return clear errors for missing/invalid keys.

Server-side `LMX_ADMIN_API_KEY` / `LMX_X402_FULFILLMENT_API_KEY` are **not** treated as the caller's balance key for `chat_completion` or `web_search` (they are used only to fulfill x402-paid chat calls against the API).

## x402 pay-per-call (when API key omitted)

When `X402_ENABLED=true` and CDP/treasury env are set, `chat_completion` without an API key uses seller-side `@x402/mcp` `createPaymentWrapper` (same CDP facilitator + `upto` scheme as the HTTP route). Agents pay USDC per call; the MCP server then fulfills via `LMX_X402_FULFILLMENT_API_KEY` (or `LMX_ADMIN_API_KEY`).

`web_search` is balance-path only in v1 (no x402 wrapper yet).

## Environment variables

Server:

- `LMX_API_BASE_URL` (default: `http://127.0.0.1:3000`)
- `LMX_ADMIN_API_KEY` (optional; smoke tests + x402 fulfillment fallback)
- `LMX_OPS_API_KEY` (optional; forwards tool events to API `/v1/ops/mcp-events` for the ops dashboard)
- `LMX_X402_FULFILLMENT_API_KEY` (preferred funded key for fulfilling x402 MCP calls)
- `LMX_DEFAULT_MODEL` (default: `llama-3-70b`)
- `LMX_MCP_TRANSPORT` (`stdio` or `http`, default: `stdio`)
- `LMX_MCP_HOST` (HTTP mode only, default: `0.0.0.0`)
- `LMX_MCP_PORT` (HTTP mode only, default: `3334`)
- `MCP_RATE_LIMIT_MAX` (default: `60`)
- `MCP_RATE_LIMIT_WINDOW_MS` (default: `60000`)

x402 (optional — enable pay-per-call without a user API key):

- `X402_ENABLED=true`
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`
- `TREASURY_ADDRESS` (payTo)
- `SIWE_CHAIN_ID` or `X402_CHAIN_ID` (`8453` Base mainnet, `84532` Base Sepolia)
- `LMX_X402_FULFILLMENT_API_KEY` or `LMX_ADMIN_API_KEY` (funded `lmx_...` key used after settlement)

Client (Cursor `.cursor/mcp.json`):

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

## Local dev

```bash
pnpm --filter @lmxcloud/mcp-server dev
```

## Hosted HTTP mode

```bash
pnpm --filter @lmxcloud/mcp-server dev:http
```

- MCP: `http://127.0.0.1:3334/mcp`
- Health: `http://127.0.0.1:3334/healthz`

## Deploy (Railway)

1. Service config: `apps/mcp-server/railway.toml`
2. Set `LMX_API_BASE_URL`, `LMX_MCP_TRANSPORT=http`, `LMX_MCP_HOST=0.0.0.0`
3. For balance path: users authenticate with their own key via MCP client `Authorization` header
4. For x402 path: set the x402 env vars listed above (same CDP/treasury values as the API service), plus a funded fulfillment key
5. For `web_search`: set `BRAVE_SEARCH_API_KEY` on the **API** service (not the MCP service)
