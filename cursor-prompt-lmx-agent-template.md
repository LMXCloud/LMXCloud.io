# Cursor Prompt — LMX Agent Template (Track A, standalone repo)

Paste this into a **fresh Cursor project in a new, empty folder** — not inside the LMXCloud.io repo. Same reasoning as the extraction agent's own standalone-repo prompt: this becomes a public, forkable repo, and tool/agent source must never share a repo (see context below).

## Context: what LMX Cloud is (you have no prior knowledge of it)

LMX Cloud is an inference/compute router with a settlement + proof layer on top (called "LMX Grid"). It exposes an OpenAI-compatible chat completions API:

- Base URL: `https://api.lmxcloud.io`
- Auth: `Authorization: Bearer lmx_...` header (API key), or a wallet signing x402 payments per-request (no account needed)
- Chat completions: `POST /v1/chat/completions`, OpenAI-compatible request/response shape, with extra response headers: `x-lmx-provider`, `x-lmx-fallback`, `x-lmx-latency`, `x-lmx-cost`, `x-lmx-balance`
- Demo key generation (zero-friction start): `POST /v1/auth/key`, optional `{ "email": "..." }` body, returns `{ api_key, balance }`
- Balance/usage: `GET /v1/balance`, `GET /v1/usage`

**All LLM calls in anything built here must go through this API** — not OpenAI, not Anthropic, not any other provider directly.

## Goal

Build `lmx-agent-template`: the reusable starter kit for any `lmx.*` open-source agent (examples: a research agent, a tutoring agent, a coding assistant — the exact agent doesn't matter for this build, this is the scaffold, not any one agent). A developer forks this repo, implements one file, and has a working wallet-identified agent that calls LMX's own inference API and pays for its own usage.

## Hard architectural rule — read this before writing anything

This repo must contain **zero tool implementation code, ever**. It holds tool *URLs* only — never PDF parsing, web scraping, or any other capability's actual logic. That logic lives in separate `lmx-tool-*` services this agent calls over HTTP. If you find yourself implementing a capability inline instead of calling out to a URL, stop — that capability belongs in a different repo, not this one. This is a security boundary, not a style preference: an open-source agent repo with tool logic baked in gives that logic away for free to anyone who forks it.

## Required structure

```
lmx-agent-template/
  src/
    identity.ts     — resolves the agent's LMX credential, in this priority order:
                       1. LMX_API_KEY env var if set
                       2. LMX_WALLET_PRIVATE_KEY env var if set — sign in as a wallet
                          (raw keypair, no browser flow needed — this is what makes the
                          agent "wallet-identified out of the box")
                       3. neither set — auto-generate a free demo key via POST /v1/auth/key
                          so the agent can run with zero setup, and print the key + balance
                          so the developer can save it for next time
    lmx-client.ts   — typed wrapper over the LMX API: sendChatCompletion(), fetchBalance(),
                       fetchUsage(). Read the x-lmx-* response headers into a typed object
                       (provider, fallback, latencyMs, cost, balance) — callers should be able
                       to see which provider actually served a given call.
    settlement.ts   — x402 payment signing for any call this agent makes that requires it
                       (i.e. when using a wallet identity, not an API key). Use the standard
                       @x402/core + @x402/evm client packages (Base network) — don't hand-roll
                       payment signing.
    tools.ts        — a typed registry: an array/map of { name, url, description } for
                       whatever tools this agent calls. Ship this empty or with one placeholder
                       entry — the point is the shape, not populating it with real tools.
    state.ts        — a minimal interface: put(namespace, key, value), get(namespace, key),
                       query(namespace, filter). Implement it on a local JSON file for now
                       (this repo has no database) — the interface is what matters, so a
                       future swap to a hosted store doesn't require changing callers.
    agent.ts        — the orchestration loop: receive input → (optionally call tools from the
                       registry) → call lmx-client for the actual reasoning/generation step →
                       act on the result → persist state. This is the one file a fork is
                       expected to actually rewrite — leave it as a working minimal example
                       (e.g. "answer a question passed as a CLI arg"), not empty.
    index.ts        — CLI entrypoint: read an argument or prompt for one, call agent.ts, print
                       the result. Keep this simple — webhook/scheduled-trigger entrypoints are
                       a fork's problem to add, not this template's.
  .env.example      — LMX_API_KEY, LMX_WALLET_PRIVATE_KEY, LMX_API_URL (default
                       https://api.lmxcloud.io), commented to explain the three-tier identity
                       resolution above
  package.json, tsconfig.json — Node/TypeScript, your call on runtime (tsx for dev is fine,
                       matches the pattern used elsewhere in the LMX ecosystem)
  README.md         — explain: what this is, how to fork it to build a new agent, the hard
                       architectural rule above (no tool code, ever), and how to run the
                       example end-to-end with zero setup (the auto-demo-key path)
```

## What "working end-to-end" means for this build

`pnpm install && pnpm dev "some question"` with no env vars set should: auto-generate a demo key, print it and the starting balance, call `POST /v1/chat/completions` with the question, print the answer plus which provider served it (from the `x-lmx-provider` header). That's the whole proof — one real Grid call, wallet-identity path stubbed but not required to run.

## Explicit constraints for this build

- No tool implementation code — see the hard rule above. `tools.ts` holds URLs, nothing else.
- No database — `state.ts`'s local-file backend is fine, don't reach for Postgres/Redis/etc.
- Wallet path (`identity.ts` tier 2 + `settlement.ts`) should be structurally present and correctly wired, but doesn't need to be exercised by the default `pnpm dev` run — the demo-key path is what has to work with zero setup.
- Don't build any specific `lmx.*` agent's actual behavior here (no voice, no research, no trading logic) — `agent.ts`'s example should be generic enough that it's obviously a starting point, not a finished product.

## Reference

Full architecture and reasoning: `LMX_AGENT_TEMPLATE_ARCHITECTURE.md` (LMXCloud.io repo root). Existing patterns to match, not reinvent: `apps/cli/src/api.ts` and `apps/cli/src/auth.ts` (the identity/API-client shape), `apps/mcp-server/src/lmx-client.ts` (another working LMX-API-caller reference), `apps/tools/_template` (the equivalent copy-paste skeleton on the tool side, for structural comparison only — this repo does not import from it).
