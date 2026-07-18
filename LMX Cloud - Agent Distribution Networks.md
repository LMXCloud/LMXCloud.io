# LMX Cloud
### Agent Distribution Networks — Phase 1 Status

Updated 2026-07-14

---

## Why these three channels

Phase 1 is done when an autonomous agent — zero human in the loop, no prior relationship with LMX Cloud — can discover LMX Cloud, pay per call in stablecoin, and get routed DePIN compute back. Three channels were chosen in a deliberate order: the first is protocol-level and works for any agent using the x402 payment standard regardless of framework; the second is the widest possible net, reaching any MCP-compatible agent whether or not it is crypto-native; the third is framework-specific and highest-touch, positioned as a reference case study once the payment plumbing from the first two is already proven. A fourth category — Virtuals/ACP, Autonolas, Fetch.ai, Bittensor — was deliberately left out of Phase 1: each has a bespoke commerce layer that is meaningfully heavier to build against and not worth the lift until Phase 1 proves agents actually pay for this at all.

All three channels share one prerequisite that had to be built first: real per-call x402 payments. The original balance-funded flow (fund an account, draw it down over many requests) doesn't match how discovery layers like Bazaar, Agentic.Market, and the MCP registry expect payment — they expect an agent to receive an HTTP 402 response with a price, pay that specific call, and get the result. That per-call payment layer was built as an addition to the existing treasury wallet and credit infrastructure, not a replacement, so the dashboard/human flow was untouched.

## Summary

| Channel | Status | What it unlocks |
|---|---|---|
| Goal 1 — x402 Bazaar / Agentic.Market | Done — 2026-07-14 | Protocol-level discovery: any x402-paying agent finds LMX Cloud with zero signup. |
| Goal 2 — MCP Server / Registry | Done — 2026-07-14 | Widest net: any MCP-compatible agent (Claude, ChatGPT, LangChain) can call LMX as a tool. |
| Goal 3 — ElizaOS Plugin | In progress | Framework-specific proof-of-concept; npm package live, registry PR pending. |

---

## Goal 1 — x402 Bazaar + Agentic.Market

**Status: Done — 2026-07-14**

### What it is

Coinbase's CDP Bazaar is the discovery catalog built on top of the x402 payment protocol; Agentic.Market is Coinbase's own search interface over that same index, not a separate directory. Listing is not a manual submission process — a route that declares Bazaar discovery metadata gets indexed automatically the first time a real payment settles through the CDP Facilitator for that URL. No signup, no form, no separate registration.

### Why it matters

This is the protocol-level channel: any agent built to speak x402 — regardless of what framework built it — can find and pay for LMX Cloud's inference endpoint without ever having heard of LMX Cloud beforehand. Coinbase's Bazaar already carries real liquidity (165M+ cumulative x402 transactions, 480K+ agents, roughly $50M+ in volume as of April 2026), so listing here plugs LMX Cloud into an existing, active market rather than building distribution from zero.

### How it was built

- Bazaar discovery metadata added to `POST /v1/chat/completions`: the `@x402/extensions` package was installed, a `bazaarResourceServerExtension` registered on the resource server, and a `declareDiscoveryExtension()` attached with a realistic input/output example, a JSON schema, and a semantic description — all layered on top of the existing pricing, verify/settle hooks, and payment store without touching them.
- A real settlement was run against production to trigger indexing, and confirmed live via CDP's merchant lookup endpoint, which now lists the route.
- The Phase 1 success metric — the first real, un-prompted x402 payment from a wallet LMX Cloud had never seen before, settled and routed successfully — was hit through this exact listing.

### Obstacles overcome

- First settlement attempt was rejected by Bazaar with a validation error that looked like a schema bug ("resource must start with 'https://'"). The actual cause: the canary script was pointed at a temporary local dev server, and the x402 middleware derives the listed "resource" identity from the incoming request's own protocol and host. Pointing the test at the real deployed `api.lmxcloud.io` domain fixed it immediately with no code change — worth checking the target URL first if this class of error resurfaces.
- Legal attorney review and formal abuse/burst-load testing on the anonymous payment path were both deliberately deferred rather than blocking the listing — a conscious trade-off given real public catalog traffic is now live against production.

---

## Goal 2 — MCP Server + MCP Registry

**Status: Done — 2026-07-14**

### What it is

A hosted, Streamable HTTP Model Context Protocol server at `mcp.lmxcloud.io/mcp`, published to the official MCP Registry (`registry.modelcontextprotocol.io`) as `io.lmxcloud/mcp-server`. It exposes seven tools covering the full agent lifecycle: `get_status`, `list_models`, `get_pricing`, `quote_price`, `get_balance`, `get_usage`, and `chat_completion`.

### Why it matters

MCP is the widest possible net of the three channels — it's not crypto-specific. Any MCP-compatible agent (Claude, ChatGPT agents, custom LangChain agents, and anything else that speaks the protocol) can discover and call LMX Cloud as a standard tool, using the same registry ecosystem those clients already pull from. Because `chat_completion` supports both the existing balance-funded flow and x402 pay-per-call, it serves both prepaid dashboard users and zero-relationship autonomous agents through one endpoint.

### How it was built

- v1 shipped 2026-07-09: balance-funded server with per-user `Authorization: Bearer` key passthrough, rate limits, and structured caller logging, validated end-to-end against an external demo agent running a six-step smoke suite.
- x402 pay-per-call wrapping shipped 2026-07-14: `chat_completion` became dual-path — the existing Bearer/balance flow is unchanged, and x402 payment kicks in automatically when no `api_key` is supplied. Built with `createPaymentWrapper` from `@x402/mcp` plus the same `declareDiscoveryExtension()` and CDP facilitator used on the HTTP route, so the pricing and settlement logic isn't duplicated.
- A new shared package, `@lmxcloud/x402`, centralizes facilitator setup for both the API and MCP server, deliberately kept out of the main shared package so the web dashboard doesn't pick up crypto payment dependencies it doesn't need.
- Published to the official MCP Registry via a `server.json` manifest, authenticated by an Ed25519 DNS TXT record on the `lmxcloud.io` root — registering the `io.lmxcloud/*` namespace as LMX Cloud's own.

### Obstacles overcome

- `mcp.lmxcloud.io` had no working public URL going into this goal, for two independent reasons: Railway's trial plan capped custom domains at one (already used by `api.lmxcloud.io`), and the server's own origin-lock code deliberately does not exempt the `/mcp` route from the Cloudflare-origin check, so even the raw Railway domain was returning 403 to direct traffic.
- Resolved by upgrading to Railway's paid Hobby tier (~$5/mo) and adding `mcp.lmxcloud.io` as a proper custom domain — which required both updating the proxied DNS record and adding a separate, subdomain-specific Railway verification TXT record (a leftover verification record from the `api.lmxcloud.io` setup looked similar and caused early confusion before it became clear these records are per-subdomain, not project-wide).
- Verified end-to-end after the fix: the public MCP endpoint returns a healthy x402-enabled status, while the raw Railway domain correctly returns 403 — confirming the origin lock is doing its job on both routes.

---

## Goal 3 — ElizaOS Plugin

**Status: In progress**

### What it is

A model-provider plugin for the ElizaOS agent framework, published to npm as `@lmxcloud/plugin-lmxcloud`. It registers `TEXT_SMALL` and `TEXT_LARGE` model handlers that call LMX Cloud's chat completions endpoint directly, paying with an EVM private key funded in USDC on Base — no API key, no signup step, true to a wallet-native pitch.

### Why it matters

This is the most framework-specific and highest-touch of the three channels, deliberately sequenced last so it could serve as a reference case study once the payment plumbing from Goals 1 and 2 was already proven working. An ElizaOS developer installs the plugin, points it at a funded wallet, and their agent's inference is funded and routed through LMX Cloud with no manual account creation anywhere in the flow.

### How it was built

- Scope was revised mid-build: the original plan assumed wiring in wallet-based key minting (reusing the SIWE flow from the balance-funded system). After confirming ElizaOS's model-handler interface could support an inline pay-and-retry flow — with real precedent in other ElizaOS plugins doing the same thing — the plugin went x402-only. One config value (a funded EVM private key), no dual-auth complexity, and zero changes required to the main LMX Cloud codebase.
- Built as a standalone repository outside the main monorepo, using the same `@x402/core` and `@x402/evm` client packages already proven in the API's own payment test scripts — not a new or third-party payment SDK.
- Model defaults were verified live against LMX Cloud's production model catalog rather than hardcoded from assumption.
- Real logo and banner artwork were generated and color-matched to the dashboard's existing brand theme.
- Published to npm on 2026-07-14 with the `elizaos` keyword in its package metadata — per ElizaOS's own documentation, the runtime auto-discovers any npm package carrying that keyword, so the plugin is likely already functionally usable independent of the formal registry listing below.

### Obstacles overcome

- The CLI's registry-submission path (`elizaos-plugins/registry`) turned out to be archived and deprecated, not just a stale target — the real process requires forking `elizaOS/eliza` and adding a manifest entry file directly, then opening a community-reviewed pull request. This was discovered only after the plugin was otherwise ready to submit.
- npm publishing was blocked for a period by two-factor authentication: the account uses a WebAuthn security key rather than a TOTP app, so the standard one-time-code flow didn't apply. Resolved with a granular access token and bypass-2FA setting.
- A near-miss during debugging: `npm publish` was briefly run from the main LMXCloud.io monorepo root instead of the plugin's own directory, which would have published the entire private repository — legal drafts, full source, temporary debug files — to public npm. It was caught harmlessly by the monorepo's own `"private": true` package flag. Lesson carried forward: confirm the working directory before any publish command.

### Remaining work

- Fork `elizaOS/eliza`, add the plugin's registry entry file, run the repo's validate and generate scripts, and open the community-reviewed pull request.
- Run an end-to-end test with a live ElizaOS agent instance.

---

## Bottom line

Two of the three Phase 1 distribution channels are fully live: LMX Cloud is listed and has settled a real payment on Coinbase's Bazaar/Agentic.Market index, and it is published and reachable through the official MCP Registry with both balance-funded and pay-per-call support. The ElizaOS plugin is published to npm and likely already discoverable through ElizaOS's own keyword-based auto-discovery; the one remaining step is the community-reviewed registry pull request against `elizaOS/eliza`, which is a process step rather than an engineering blocker.
