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

## Per-model rates (since pricing version 2026-11-17.1)

Every model has its own published input, cached-input and output rate in USD per 1M tokens. The same rates apply to balance (API key) and x402 callers, and the price does not change with which provider serves the request.

```
published_rate = highest verified provider cost for the model x (1 + margin), rounded up to 4 dp
margin         = 25% (X402_PRICING_MARGIN_PCT, applies to both billing paths)
```

Provider costs are copied from each provider's own published rates, with the date read, in `apps/api/src/pricing/rate-card.ts`:

| Provider | Source | Read |
|----------|--------|------|
| io.net   | `GET https://api.intelligence.io.solutions/api/v1/models` (`input_token_price`, `output_token_price`, `cache_read_token_price`) | 2026-11-17 |
| AkashML  | https://akashml.com/pricing | 2026-11-17 |

A provider or model with no verified rate is not routed (Nosana bills per GPU-hour, Aethir and Together have no rate on file). Changing any rate, the margin or a billing rule means bumping `PRICING_VERSION`; every ledger row records the version it was charged under.

Implementation: `apps/api/src/pricing/rate-card.ts` (rates, billing rules), `catalog.ts` (published catalog).

## Metered cost (balance callers, and lmx.usage for everyone)

```
cost = ((prompt_tokens - cached_prompt_tokens) x input_per_1m
        + cached_prompt_tokens x cached_input_per_1m
        + completion_tokens x output_per_1m) / 1,000,000      rounded half-up to 8 dp
```

- Reasoning tokens are inside `completion_tokens` and bill once, at the output rate.
- Cache writes have no separate rate at any current provider and bill as ordinary input.
- A total with no prompt/completion split bills at the output rate (`cost_basis: total_tokens_at_output_rate`); no counts at all bills 0 (`cost_basis: unavailable`).
- Every response carries `lmx.usage.cost` (amount, pricing version, rates applied, tokens billed at each rate) and `x-lmx-pricing-version`, so the charge can be recomputed from the response alone. `pnpm --filter @lmxcloud/api test:pricing` does that against production and the usage ledger.

## Quote formula (x402)

```
quoted_amount = max((prompt_estimate x input_per_1m + max_completion_tokens x output_per_1m) / 1M, MIN_CALL_USDC)
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

Both paths share the same provider routing and the same published per-model rates. x402 is **additive** — balance-funded users are unaffected.

## Public pricing API

`GET /v1/pricing` — every priced model with its rates, `available_on` (healthy providers), the pricing version, effective date, billing rules and rate sources, plus fixed tool prices:

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

Model `qwen-3.6-35b` ($0.1625 input / $1.235 output per 1M), 2000 prompt + 1000 max completion tokens:

```
raw_quote     = (2000 x 0.1625 + 1000 x 1.235) / 1M = $0.00156
quoted_amount = $0.00156
```

Same model, 200 prompt + 256 max completion tokens:

```
raw_quote     = (200 x 0.1625 + 256 x 1.235) / 1M = $0.000349
quoted_amount = $0.001 (minimum floor applies)
```
