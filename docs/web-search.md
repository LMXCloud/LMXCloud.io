# Web Search (Goal 0b)

Decision record for `web_search` — passthrough search behind LMX metering (2026-07-18).

## Vendor choice: Brave Search (not Tavily)

| | Brave Search | Tavily |
|--|--------------|--------|
| Wholesale | **$5 / 1k requests** (~$0.005/call), flat | $0.008/credit PAYGO; basic=1 credit, advanced=2 |
| Rate limit | **50 req/s** | 100–1000 RPM (key tier) |
| Metering fit | 1 HTTP call = 1 billable unit | Credit multipliers complicate per-call quotes |
| Free tier | $5 monthly credits | 1,000 credits/month |

Brave’s flat per-request Search plan maps cleanly onto LMX fixed per-call pricing and has more burst headroom for agents.

## Product surface

| Surface | Detail |
|---------|--------|
| HTTP | `POST /v1/web/search` |
| MCP | `web_search` |
| Auth (v1) | Bearer `lmx_…` balance path |
| Price | `WEB_SEARCH_PRICE_USDC` (default **$0.01**/call) |
| Upstream | `GET https://api.search.brave.com/res/v1/web/search` |

Body: `{ "query": string, "max_results"?: 1–20 }` (default 5).

Env: `BRAVE_SEARCH_API_KEY` (required to enable), optional `BRAVE_SEARCH_BASE_URL`, `WEB_SEARCH_PRICE_USDC`, rate-limit overrides.

## Reliability telemetry

**Not automatic via InferenceRouter** (unlike vision-on-chat).

| | Decision |
|--|----------|
| Record? | **Yes** — `resource_type: "web_search"` on success (`recordProviderSuccess`) and failure (`recordProviderFailure`) in the route |
| DePIN reliability claim? | **No** — Brave is a single centralized dependency, not an independent DePIN compute network. Ops can still filter `/v1/ops/reliability?resource_type=web_search`; the public status “Reliability” narrative stays chat/DePIN-scoped |

Implementation notes live in `apps/api/src/telemetry/types.ts` (`RESOURCE_TYPE_WEB_SEARCH`).

## Out of scope (v1)

- x402 pay-per-call on web_search (balance path only for now; same receipt/usage pattern as chat when x402 is added later)
- ProviderAdapter / DePIN routing of search
