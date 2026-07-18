# x402 Per-Call Pricing

Decision record for Distribution Sprint 1 (2026-07-07).

## Summary

LMX Cloud quotes an **upfront ceiling price** per inference call in USDC on Base. The quote is based on estimated token usage; Sprint 2 settles the actual cost after inference and refunds any overpayment.

## Currency and network

| Field | Value |
|-------|-------|
| Currency | USDC (1 USDC = $1.00) |
| Network | Base (`eip155:8453` mainnet, `eip155:84532` Sepolia for testnet) |
| Chain config | Follows `SIWE_CHAIN_ID` |

## List price formula

```
list_price_per_1k = cheapest_routed_provider_cost_per_1k × (1 + margin)
margin            = 25% (configurable via X402_PRICING_MARGIN_PCT)
```

Provider floors today:

| Provider | Cost / 1k tokens | List / 1k (25% margin) |
|----------|------------------|--------------------------|
| AkashML  | $0.0001          | $0.000125                |
| Nosana   | $0.00015         | $0.0001875               |
| io.net   | $0.0002          | $0.000250                |

For each model alias, the catalog picks the **cheapest configured provider** that supports the alias (same rule as `GET /v1/models`).

Implementation: `apps/api/src/pricing/catalog.ts`

## Quote formula

```
estimated_tokens = prompt_tokens + max_completion_tokens
raw_quote        = (estimated_tokens / 1000) × list_price_per_1k
quoted_amount    = max(raw_quote, MIN_CALL_USDC)
```

| Constant | Default | Env override |
|----------|---------|--------------|
| `MIN_CALL_USDC` | $0.001 | `X402_MIN_CALL_USDC` |
| Default max completion tokens | 1024 | `X402_DEFAULT_MAX_COMPLETION_TOKENS` |

When the caller omits `max_tokens` / `max_completion_tokens`, the quote assumes 1024 completion tokens.

**Prompt token estimate (pre-call):** rough heuristic of ~4 characters per token from message content. Sprint 2 may refine this; the quote is a ceiling, not a metered bill.

## Dual billing paths

| Path | Auth | Billing |
|------|------|---------|
| Dashboard / API key | Bearer `lmx_…` or session | Post-inference deduct from `credit_balance` (unchanged) |
| x402 agent | `PAYMENT-SIGNATURE` header | Pre-verify payment, route inference, settle (Sprint 2) |

Both paths share the same provider routing and cost floors. x402 is **additive** — balance-funded users are unaffected.

## Public pricing API

`GET /v1/pricing` — full catalog from healthy providers, plus fixed tool prices:

```json
{
  "tools": {
    "web_search": {
      "provider": "brave",
      "price_usdc": "0.010000",
      "pricing": "per_call",
      "configured": true,
      "route": "/v1/web/search"
    }
  }
}
```

`GET /v1/pricing?model=llama-3-70b&max_tokens=512&prompt_tokens=200` — single-model quote.

This endpoint is the source of truth for docs, Bazaar listing metadata, and Sprint 2 `PAYMENT-REQUIRED` payloads. Web search is balance-billed at the fixed `WEB_SEARCH_PRICE_USDC` (see [web-search.md](./web-search.md)); x402 on `web_search` is not enabled yet.

## Streaming

Streaming calls use the same upfront ceiling quote. After the stream completes, Sprint 2 compares actual token usage to the quoted amount and refunds the delta if actual cost is lower.

## Example quotes

Model `llama-3-70b` (Akash list price $0.000125/1k), 200 prompt + 1024 max completion tokens:

```
estimated_tokens = 1224
raw_quote        = 1224/1000 × 0.000125 = $0.000153
quoted_amount    = $0.001 (minimum floor applies)
```

Model `llama-3-70b`, 8000 prompt + 4096 max completion tokens:

```
estimated_tokens = 12096
raw_quote        = 12096/1000 × 0.000125 = $0.001512
quoted_amount    = $0.001512
```
