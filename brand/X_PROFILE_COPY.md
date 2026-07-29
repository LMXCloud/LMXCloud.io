# LMX Cloud — X (Twitter) profile copy

Grounded only in what's actually shipped per `ROADMAP.md` (2026-07-28) — no
ElizaOS or Aethir mentions yet since those aren't live/verified end-to-end.
Update this once they are.

## Display name
`LMX Cloud`

## Handle
`@lmxcloud` (check availability — fall back to `@lmx_cloud` or `@lmxcloudio` if taken)

## Bio (160 char limit)
Pick one:

1. "DePIN inference infrastructure for autonomous AI agents. OpenAI-compatible API, wallet-native, pay-per-call in USDC via x402." (128 chars)
2. "AWS for Web3 — routed inference across decentralized compute, built for agents that pay their own way." (105 chars)
3. "OpenAI-compatible inference, routed across DePIN. Wallet auth, USDC funding, x402 pay-per-call, verifiable on-chain receipts." (128 chars)

## Location
`Decentralized` (on-brand, or leave blank — your call)

## Website link
`https://www.lmxcloud.io`

## Profile photo / header
- Photo: `x-avatar-400.png`
- Header: `x-banner-illustrated-v3.png` (or the cleaned-up version once the seam artifact's fixed)

## Pinned post draft
Post this first, then pin it — it's the "what is this" anchor everything else links back to:

> LMX Cloud is live: an OpenAI-compatible inference API routed across decentralized compute (DePIN), built for autonomous agents.
>
> — Wallet-native auth, fund with USDC
> — Pay per call in USDC via x402, no account needed
> — Verifiable on-chain receipts for every request
>
> https://www.lmxcloud.io

(279 chars — fits with room to spare. Swap the last line for a docs/quickstart link if you'd rather send traffic there first.)

## First few post ideas (once the account's live)
- A short thread walking through the x402 pay-per-call flow — no API key, no signup, just a wallet and a request. This is the most differentiated thing you have; lead with it.
- The hosted MCP server going live in the official registry (`io.lmxcloud/mcp-server`) — plug LMX into Claude Code / any MCP client in one line.
- Verifiable receipts — every request gets a Merkle-anchored proof on Base. Screenshot the `/v1/status` proof endpoint or a `pnpm verify:receipt` run.
- The reliability angle once Goal 0's provider comparison exists (`GET /v1/ops/reliability`) — this is flagged in the roadmap as strong demand-gen material once it's published.

## Do not post yet
- Anything implying the ElizaOS plugin is live/usable — PR #16397 is still waiting on maintainer re-review, and the live-agent E2E test hasn't run. Wait until both close.
- Aethir Mesh as a live provider — only io.net and AkashML are actually in production right now (the website's own copy already overstates this in one spot; worth a separate fix, not a reason to repeat it here).
