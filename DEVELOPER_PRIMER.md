# LMX Cloud

**An OpenAI-compatible inference API, routed across decentralized GPU networks, built for humans and autonomous agents alike.**

## What it is

LMX Cloud is a drop-in replacement for your existing OpenAI-style API calls. Point your existing code at LMX Cloud instead of a single provider, and your requests get routed across decentralized compute networks — io.net and Akash today — with automatic failover if one is slow or down. Same request format, same response shape, no rewrite required.

Underneath that, LMX Cloud is becoming something a little more interesting: infrastructure that a piece of software — not just a person — can use entirely on its own. A wallet, not a login form, is enough to get started.

## Why this exists

Centralized GPU clouds are excellent if you're a company with a card on file and a human signing up for an account. That model breaks down for two kinds of builders that are becoming a lot more common:

- **Developers who want cheaper, more resilient inference** without betting everything on one provider's uptime or pricing.
- **Autonomous agents** — software that holds its own crypto wallet and needs to pay for compute without a human in the loop. An agent can't open an AWS account or get a corporate card. It can hold a wallet.

LMX Cloud is built to serve both, on the same infrastructure: an OpenAI-compatible API for the first group, wallet-native identity and funding for the second.

## How it works

**Routing.** Every request is sent to whichever configured provider is healthy and matches your preference — cheapest, fastest, DePIN-only, or a specific provider by name. If your first choice is down, LMX Cloud falls back automatically and tells you it did, via response headers (`x-lmx-provider`, `x-lmx-fallback`, `x-lmx-latency`, `x-lmx-cost`) — no silent surprises about who actually served your request.

**Sign in your way.** Use email sign-in if you're a person building an app. Use wallet sign-in (SIWE) if you'd rather not manage another password — or if you're wiring up an agent that needs to authenticate with nothing but a keypair, no browser involved.

**Fund your way.** Top up your balance, or — for wallet accounts — send USDC on Base directly to fund your account on-chain, no card required.

## Quickstart

Get an API key:

```bash
curl -s -X POST https://api.lmxcloud.io/v1/auth/key \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Send your first request:

```bash
curl https://api.lmxcloud.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "x-lmx-prefer: cheapest" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-70b",
    "messages": [{"role": "user", "content": "Hello from LMX Cloud"}]
  }'
```

That's it — same shape as any OpenAI-compatible client. Point your existing SDK's base URL at LMX Cloud and it works as-is. 30 model aliases are available across providers, from Llama and Qwen to DeepSeek and GLM — check `GET /v1/models` for what's live right now. Vision models accept OpenAI-style `image_url` content parts; `POST /v1/web/search` adds real-time web lookup behind the same API key balance.

## Building an agent, not an app?

If you're wiring up an autonomous agent rather than a human-facing app, skip email entirely:

1. `POST /v1/auth/wallet/nonce` with your agent's wallet address — get back a challenge.
2. Sign it with the agent's keypair — no browser, no extension, just a raw signature.
3. `POST /v1/auth/wallet/verify` — get back a session and an API key tied to that wallet.
4. Fund it by sending USDC on Base to the account's deposit address, or by checking balance via the API.

From that point on, the agent authenticates and spends exactly like any other API key — it just never needed a human to sign it up.

## What's coming

x402 pay-per-call, MCP (8 tools including vision-capable `chat_completion` and `web_search`), ElizaOS plugin, and verifiable Merkle-anchored logs are already live. Near-term work is reliability/ops polish, x402 on streaming and `web_search`, and embeddings/image generation once providers expose live SKUs.

## Get involved

- **Docs:** full request/response reference, vision, web search, streaming, wallet auth, and USDC funding details live on the docs page.
- **Status:** live provider health is public — check before you build, not after something breaks.
- **Feedback:** found a bug, have a feature request, or want to build something on top of LMX Cloud? Open an issue or reach out — early feedback shapes what gets built next.
