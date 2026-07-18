# LMX Cloud — Roadmap

Original goal: go from working proof-of-concept (Phase 1-7) to something you can hand to strangers — developers trying it for free — without it breaking, leaking data, or embarrassing you. That base layer is done. The roadmap has since grown a second, bigger goal on top of it: reposition as Web3-native infrastructure and become "findable and payable" by autonomous agents (Phase 1 distribution, below). Both tracks are tracked in this one file — free-beta hardening didn't stop mattering, it's just no longer the only thing happening.

## CURRENT STATE SNAPSHOT (2026-07-08, late evening) — read this first

Everything below is verified directly against the code and local test runs, not assumed from memory or from what Cursor's own summaries claimed. This section supersedes the blow-by-blow notes further down for a quick read; the detailed sections below stay as the record of *why* each decision was made.

### Built so far

- **Core inference router** — multi-provider routing (io.net + Akash both active on Railway; Together deliberately not configured), health-aware fallback, streaming chat completions (real SSE), 30 model aliases. Credits deduct *after* successful inference, not before.
- **Security/ops baseline** — old account-takeover login route deleted, `SESSION_SECRET` required at boot in production, rate limits (5 keys/hour per IP, 30 chat/min per key), Sentry fully wired (init + global error handler). CORS decision documented: keep `origin: true` for OpenAI-compatible public API; Bearer token is the security boundary.
- **Full dashboard** (`apps/web`) — overview, keys, usage, per-request logs, public status page, billing, docs page.
- **Web3-1: wallet identity + USDC funding on Base — shipped, hardened, verified end-to-end.** SIWE sign-in (browser or raw keypair script), Clerk as alternate auth, USDC deposits auto-crediting via confirmation-gated poller, in-console "Add Credits" flow, adaptive billing refresh, wrong-network detection, unmatched-deposit guidance. Railway confirmed on Base mainnet config (`SIWE_CHAIN_ID`, `BASE_RPC_URL`).
- **Web3-2: verifiable on-chain logs — shipped, verified end-to-end on Base Sepolia (2026-07-07).** Per-request `lmx_receipt_v1` receipts, batched Merkle anchoring via `LmxLogAnchor` + background poller, `GET /v1/usage/logs/:id/proof`, anchoring on `GET /v1/status` and `StatusPage.tsx`, `pnpm verify:receipt` CLI, unit tests for receipt/Merkle/proof. Historical logs before enablement are not retroactively verifiable.
- **x402 Sprint 1 — shipped (2026-07-07).** Per-call pricing catalog (`apps/api/src/pricing/`), `GET /v1/pricing`, `payment_events` migration + Postgres store, ADRs in `docs/x402-pricing.md` and `docs/x402-verification.md` (CDP Facilitator chosen).
- **x402 Sprint 2 — verified end-to-end on Base Sepolia (2026-07-08).** `@x402/fastify` middleware on `POST /v1/chat/completions`, dual path (Bearer → balance; no key → x402), CDP verify/settle hooks, `setSettlementOverrides` for actual cost. Unpaid probe (`pnpm test:x402` → 402 in ~30ms) and paid E2E (`pnpm test:x402 -- --pay`) both green: verify → inference → settle with `payment_events` persistence. Paid soak (`--repeat 10`) also green on dedicated Sepolia RPC.
- **x402 Sprint 3 — partially shipped (2026-07-08, in progress).** Sepolia RPC reliability close-out done (`DEPOSIT_MAX_LOG_BLOCK_RANGE` env + one-time smaller-chunk retry on provider range-limit errors). x402 abuse hardening (partial): replay rejection for consumed payment payloads (`x402_payment_replay`), wallet-aware anonymous rate-limit keys, `X402_ANON_RATE_LIMIT_*` env support. Reliability harness: `test:x402:soak` with `--repeat` / `--delay-ms`. Mainnet profile wired: `.env.mainnet`, `dev:mainnet`, `test:x402:mainnet-canary`, `check:mainnet-balance`; unpaid 402 on `eip155:8453` verified. **Paid mainnet canary not yet green** — see blockers below.
- **Documentation refresh** — `README.md` and `DocsPage.tsx` describe Web3 direction, wallet auth, USDC funding, verifiable logs, x402 pricing endpoint, and public roadmap section.

### Known gaps / needs hardening (verified 2026-07-08)

**Security — fix before more money flows:**
- ~~**Wallet squat on `POST /v1/auth/key` (HIGH).**~~ **Fixed 2026-07-07.** Unauthenticated key mint no longer accepts a `wallet` field; wallet-linked keys require SIWE (`/v1/auth/wallet/verify`) or authenticated `POST /v1/auth/keys`.

**x402 — resolved blockers (Sprint 2 close-out, verified 2026-07-08):**

| Blocker | Status |
|---------|--------|
| Paid E2E hang on Sepolia | **Resolved.** Early body replay hook survives verify gap; `pnpm test:x402 -- --pay` returns 200 and settles. |
| Neon DB unreachable locally | **Resolved in current dev env.** `payment_events` writes succeeding; fire-and-forget + 5s PG connect timeout in place. |
| Flaky public Sepolia RPC | **Resolved.** Dedicated Base Sepolia Alchemy endpoint; paid soak 10/10 green. |
| Deposit poller block-range errors | **Resolved.** `DEPOSIT_MAX_LOG_BLOCK_RANGE` configurable; one-time fallback retry on range-limit responses. |

**x402 Sprint 3 — active blockers:**

| Blocker | Symptom | Likely cause | Fix direction |
|---------|---------|--------------|---------------|
| ~~**Mainnet paid canary — RPC throughput**~~ | **Resolved 2026-07-13.** Was: `pnpm test:x402:mainnet-canary` failing with Alchemy `429` during Permit2 approval / balance reads. | Free/low-tier Alchemy mainnet app rate-limited under burst RPC load. | Swapped `BASE_RPC_URL` in `.env.mainnet` from Alchemy to Coinbase CDP Node (`https://api.developer.coinbase.com/rpc/v1/base/...`) — same CDP account already used for the x402 facilitator. 429s cleared. |
| ~~**Mainnet paid canary — not yet settled**~~ | **Resolved 2026-07-13.** `payment_events` row confirmed: `chain_id: 8453`, HTTP 200, settlement `success`, tx `0x95cf4bdf4990bca4a57136b2162e9830d6e3b68484cd670d8acedcc3442eabe8`. One-time Permit2 USDC approval also completed (`0x5758fbe9…`). | — | — |
| **CDP verify latency** | Every paid call waits 1–2+ min at facilitator | External CDP `/verify` + on-chain simulation | Expected for beta; document in ops; consider async UX / status for agents later |
| **Dev env hygiene** | `EADDRINUSE :3000`, tests hit stale servers | Multiple `pnpm dev` instances | One API process on 3000 when testing x402 |

**Hard blockers for Phase 1:**
- **Week 3 legal** — ToS, privacy policy, acceptable use, feedback channel. **Drafts in `legal/` and `/legal/*` (2026-07-08).** Attorney review still required before Bazaar listing.
- ~~**x402 paid path verified on testnet**~~ — **Done 2026-07-08.** Sprint 2 closed on Base Sepolia.
- ~~**Mainnet x402 flip not yet verified**~~ — **Done 2026-07-13.** Paid mainnet canary green on Coinbase CDP Node RPC (see table above); mainnet x402 pay-per-call flow fully verified end-to-end.
- **Payment failure reconciliation** — partial: x402 middleware cancels verified payment on handler 4xx/5xx; no explicit refund tx or user-visible credit-back when provider fails after balance deduct.

**Ops / scale (fine for single-instance beta, harden before scaling):**
- Rate limiter and SIWE nonce store are in-memory — reset on deploy, ineffective across multiple Railway instances. **Partial mitigation available:** Cloudflare edge rate limiting (see new section below) adds a layer that survives redeploys/multi-instance regardless of app-level state; app-level Redis-backed limiter is still the real fix, not replaced.
- Uptime monitor (UptimeRobot/Better Stack) — can't verify from code; confirm externally.
- Streaming edge case: if stream completes but final `deduct` fails, client already received tokens with no recovery.
- x402 streaming not supported yet (`x402_stream_unsupported` on paid path).
- **New (2026-07-11): edge hardening not yet in place.** `api.lmxcloud.io` and `mcp.lmxcloud.io` are about to take traffic from strangers' autonomous agents (Bazaar/Agentic.Market listing, Distribution Sprint 4) with no origin-level DDoS/WAF protection today — see "Cloudflare edge hardening" section below.

**Polish (non-blocking):**
- Anchor contract on Base mainnet (Sepolia verified; Railway needs `ANCHOR_*` + deploy).
- LogsPage "Proof" link UI (API + CLI exist; no per-row link in dashboard).
- Post-login wallet/network change not reconciled (low severity — confusing UI, not a session security hole).
- Stranger walkthrough (signup → key → first request) not explicitly verified end-to-end.

### Where we're going

Positioning: **"AWS for Web3"** — Web3-native infrastructure for autonomous AI agents. Phase 1 end state: an agent with zero prior relationship discovers LMX Cloud (x402 Bazaar/Agentic.Market, MCP, or ElizaOS plugin), pays per call in stablecoin, gets routed DePIN compute back. The underlying bet: hyperscalers and centralized neoclouds (CoreWeave, Lambda, etc.) have no margin incentive to ever route to decentralized supply, and DAOs/autonomous agents structurally can't use hyperscaler billing (no legal entity, no corporate card) — that combination is the wedge, not "decentralization" as a general pitch.

### What's left to build, roughly in order

0. ~~**Wallet squat fix on `POST /v1/auth/key`**~~ — **done 2026-07-07.**
1. **Week 3 legal** (Track B) — drafts published at `/legal/*`; **remaining:** attorney review. Hard gate before public listing. Can run in parallel with Sprint 3 — no engineering dependency.
2. ~~**x402 Sprint 1**~~ — **done 2026-07-07** (`docs/x402-*.md`, `GET /v1/pricing`, `payment_events` store).
3. ~~**x402 Sprint 2 close-out**~~ — **done 2026-07-08.** Paid Sepolia E2E + 10-run soak green; `payment_events` persistence confirmed.
4. **x402 Sprint 3 (current focus)** — **mostly done.** Remaining:
   - ~~**Mainnet paid canary**~~ — **done 2026-07-13.** Swapped to Coinbase CDP Node RPC; `test:x402:mainnet-canary` green, `payment_events` row confirmed on `chain_id: 8453`.
   - **Abuse/load hardening** — replay protection landed; still need burst/load validation on anonymous x402 path.
   - ~~**Payer visibility decision**~~ — **done 2026-07-16.** Id-based receipt lookup shipped (no auth needed); see Distribution Sprint 3 for detail.
5. **Phase 1 Goal 1** — Bazaar + Agentic.Market listing (mainnet canary green; still gated on legal review + remaining Cloudflare/abuse-hardening items).
6. ~~**Phase 1 Goal 2** — MCP server~~ — **done 2026-07-14.** v1 shipped 2026-07-09 (balance-funded, hosted HTTP, 7 tools, E2E agent-tested); x402 pay-per-call added and published to the official MCP Registry (`io.lmxcloud/mcp-server`) 2026-07-14.
7. **Phase 1 Goal 3** — ElizaOS plugin. Only remaining Phase 1 distribution goal.
8. **Week 4 outreach prep** — depends on Web2-vs-Web3 sequencing decision.
9. **Polish** — mainnet anchor deploy, LogsPage proof link, distributed rate limiting if scaling past one instance.

### How to make the system better (engineering priorities)

1. ~~**Green mainnet canary**~~ — **done 2026-07-13** (Coinbase CDP Node RPC swap).
2. **Cloudflare edge hardening** (new, 2026-07-11) — DNS migration + proxy `api.lmxcloud.io`/`mcp.lmxcloud.io`, WAF, edge rate limiting, origin-lock code change. See dedicated section above. Gates Sprint 4 listing alongside legal.
3. **Finish Sprint 3 hardening** — load-test anonymous x402 path; decide payer visibility model.
4. **Legal before listing** — attorney review of Week 3 drafts unblocks Bazaar/MCP without unmanaged liability.
5. **Reliability ops** — uptime monitor confirmed; keep dedicated RPC on both Sepolia (dev) and mainnet (prod).
6. **Scale when needed** — Redis-backed rate limits + nonce store before second Railway instance.
7. **Trust signals** — mainnet anchor deploy, LogsPage proof links, public status page already strong from Web3-2.

### Explicitly not being built right now

Native token (legal counsel first), Virtuals/ACP + Autonolas + Fetch.ai + Bittensor (long tail), Stripe billing, SDKs beyond raw HTTP, multi-region infra, mobile/non-extension wallets.

## POM — priorities before marketing (decided 2026-07-16)

**The goal POM is built around:** the real benchmark for showing LMX Cloud to a prospective developer or seed capital isn't more features — it's proof that someone outside the builder found this and paid for it unprompted. That only happens once real marketing/outreach runs through the three Phase 1 distribution channels (x402 Bazaar/Agentic.Market, MCP, ElizaOS). Each channel has a specific bar to clear before it's responsible to actively drive traffic to it, rather than let it sit passively listed. POM is that list, in priority order.

**Cross-cutting gate — legal attorney review.** Deferred three times already (Distribution Sprint 3, Sprint 4, and again in the 2026-07-15 housekeeping pass), each time flagged as "worth revisiting" and then not revisited. Drafts (ToS, privacy, acceptable-use, feedback channel) have been live and linked from signup since 2026-07-08 — only the actual attorney review is outstanding. This is the cheapest gate to clear (zero engineering, pure scheduling) and the one that's been avoided longest. Blocks responsibly marketing all three channels: marketing means deliberately inviting more strangers' agents to transact real stablecoin with zero prior relationship, which is exactly the exposure Week 3 legal was originally scoped for and then flagged as insufficient once real payment traffic went live.

- [ ] Get Week 3 legal drafts (`/legal/*`) in front of an attorney for real review.

**x402 Bazaar — closest to ready.** Listing is live and verified (Sprint 4, 2026-07-14), payment-replay race condition closed (2026-07-16, see Distribution Sprint 3). Remaining:

- [x] **Uptime monitor — done 2026-07-16.** UptimeRobot set up (free tier), three monitors: `LMX.API` (`https://api.lmxcloud.io/health`), `LMX.MCP` (`https://mcp.lmxcloud.io/healthz`), `lmxcloud.io` (dashboard) — all on 5-minute checks with email alerts to John. Open since Distribution Sprint 1; closes the reliability-signal gap flagged for Bazaar's discovery ranking.
- [x] **Burst/load test — done 2026-07-16, validated on Base Sepolia.** New `apps/api/scripts/test-x402-burst.ts` (`pnpm test:x402:burst`), pointed to from the original sequential script since that one was never concurrent. Three scenarios, all passing locally: **replay** — one signed payload, N concurrent POSTs (`Promise.all`); expected 1×200 + rest rejected, got 1×200 + 7×409. **Rate-limit** — many distinct same-wallet payments fired in a genuine burst (not spaced sequential timing); expected `X402_ANON_RATE_LIMIT_MAX` allowed + rest 429, got 10×200 + 15×429. **Malformed** — garbage `PAYMENT-SIGNATURE` burst; expected all 4xx no 5xx/hangs, got 40×4xx. Replay concurrency deliberately capped at the rate-limit max so its failures are claim races, not 429 noise. `pnpm --filter @lmxcloud/api typecheck` clean.
- [x] **Live HTTP double-pay validation — closed by the replay scenario above.** The atomic claim fix (`tryClaimForFulfillment`) was previously only proven at the store level (40 parallel claims direct against the store); the burst test's replay scenario now proves the same guarantee end-to-end over real HTTP concurrency with a real signed payload — exactly one claim wins, the rest get rejected. **Not yet done:** the same validation against mainnet — Sepolia only so far, deliberately (this is adversarial/load testing, run against testnet first per plan).

**MCP — near ready.** Server, seven tools, dual-path payments, and the official registry listing are all shipped. Remaining:

- [x] **One real stranger walkthrough — done 2026-07-16, and it surfaced two real production bugs the builder's own testing never caught.** A test user connected via Claude Code and successfully pulled tools and ran calls — first genuine non-builder confirmation the MCP quickstart works. Getting there exposed:
  1. **`/mcp` returning 500 on every request, for hours, silently.** `apps/mcp-server/src/index.ts` was reusing a single `StreamableHTTPServerTransport` instance across every request instead of creating one per request (a known anti-pattern for this SDK in stateless mode) — once it broke, it stayed broken until restart, and there was no error logging around the failure so Railway's logs showed nothing but startup lines the whole time. Fixed: fresh `McpServer`/transport per `/mcp` request, `try/catch` with structured error logging (message, stack, latency, caller address), clean 500 fallback, `finally`-block cleanup.
  2. **Railway's GitHub connection for `mcp-server` was still pointed at `johnny-lineen/LMXCloud.io`** (the old personal account) after the 2026-07-15 org migration to `LMXCloud/LMXCloud.io` — so the fix above couldn't even auto-deploy; Railway showed "GitHub Repo not found." Reconnected to the org repo.
  3. **After deploying the transport fix, every MCP tool call — including ones that don't require an API key — failed with a `403 Forbidden` matching origin-lock's exact rejection body.** Root cause: `LMX_API_BASE_URL` on the `mcp-server` service was set to the raw Railway domain (`lmxcloudapi-production.up.railway.app`), which bypasses Cloudflare and never receives the injected `X-Origin-Secret` header — so `apps/api/src/origin-lock.ts` rejected every server-to-server call from MCP to the API. Fixed by pointing `LMX_API_BASE_URL` at `https://api.lmxcloud.io` instead, so MCP's outbound calls route through Cloudflare like any other legitimate caller.
  
  **Why this matters beyond the immediate fixes:** none of this showed up in the builder's own prior validation (the 2026-07-09 demo repo run, the 2026-07-14 x402 wrapping check) — both bugs were latent until a genuinely independent connection attempt exercised the real path. This is direct evidence for why the "real stranger walkthrough" bar mattered as its own POM item, not just a formality on top of already-shipped functionality.

**ElizaOS — furthest behind.** Plugin published to npm (`@lmxcloud/plugin-lmxcloud@0.1.0`), registry PR ([elizaOS/eliza#16397](https://github.com/elizaOS/eliza/pull/16397)) open awaiting community review. Remaining:

- [ ] The actual end-to-end test with a live ElizaOS agent instance — paused 2026-07-15, not started. Real unfinished engineering/testing, not just ops verification. Deliberately positioned as the last channel to push per the original Phase 1 sequencing (case study once Goals 1-2 prove the payment plumbing works) — nothing here is out of order, ElizaOS was always meant to trail the other two.

**Net read:** legal is the fastest to clear and the longest deferred — worth confronting that pattern directly rather than deferring a fourth time. Bazaar and MCP are each one or two verification/ops tasks from done, no new engineering required. ElizaOS is a real step behind the other two and needs actual testing work, not just scheduling.

## Week 1 — Deploy for real, close the security gap (DONE)

- ~~Delete `POST /v1/auth/login`~~ — done, verified in code.
- ~~Rotate `SESSION_SECRET`~~ — done, now required at boot.
- ~~Deploy API to Railway, dashboard + demo to Vercel~~ — done.
- ~~Add error monitoring + uptime check~~ — Sentry dependency present; confirm uptime monitor is actually configured (external, can't verify from code).
- ~~Re-check rate limits~~ — done, tightened defaults in place.
- ~~**CORS is currently `origin: true`**~~ — **decided 2026-07-06:** keep `origin: true`. Documented in snapshot; no code change needed.

## Week 2 — Make it usable by someone who isn't you (DONE)

- ~~API docs page~~ — `DocsPage.tsx` exists.
- ~~Streaming support~~ — implemented in `chat.ts`.
- **Expand model coverage** — partially done; confirm `together.ts` parity and that all aliased models actually work end-to-end.
- **Polish the signup → key → first request flow** — not explicitly verified; walk through it as a stranger would.
- ~~Public status page~~ — `StatusPage.tsx` exists.
- ~~Per-request logs~~ — `LogsPage.tsx` exists.

## Next sprint (updated 2026-07-08): x402 Sprint 3 close-out + attorney review in parallel

**Immediate next tasks, both parallel:** (1) **Mainnet paid canary** — upgrade Base mainnet RPC in `.env.mainnet` (current Alchemy free tier hits 429 under burst load), rerun `pnpm --filter @lmxcloud/api dev:mainnet` + `test:x402:mainnet-canary`, confirm `payment_events` row with `chain_id: 8453`. Payer wallet is funded; RPC throughput is the only remaining blocker. (2) **Attorney review** of Week 3 legal drafts at `/legal/*` — hard gate before Sprint 4 listing, zero engineering dependency.

**Sprint 3 progress so far (2026-07-08):** Sepolia RPC reliability done (dedicated endpoint, soak 10/10, configurable deposit log chunking). Partial abuse hardening (replay rejection, wallet-aware anon rate limits). Mainnet profile wired (`.env.mainnet`, `dev:mainnet`, `test:x402:mainnet-canary`, `check:mainnet-balance`); unpaid 402 on `eip155:8453` verified. Paid mainnet canary not yet green.

Web3-2 is done. **x402 Sprint 2 is done.** **Track A (x402)** is in Sprint 3 close-out. **Track B (legal)** is attorney review — last non-engineering gate before Sprint 4 (Bazaar/Agentic.Market listing). Remaining Web3-2 ops (mainnet anchor deploy, optional LogsPage proof UI) are non-blocking polish.

**Sequencing (2026-07-06): close the two small loose ends first, ToS/Privacy content after.**

**CORS decision, made:** keep `origin: true`. This isn't an oversight — for a public, OpenAI-compatible developer API, the security boundary is the Bearer API key, not same-origin policy. Third-party developers need to call this directly from their own browser-based apps, and you can't whitelist every origin that'll ever want to use LMX Cloud as a backend (same reason OpenAI/Anthropic's own APIs don't restrict CORS on key-authenticated endpoints). The one unauthenticated route, `POST /v1/auth/key`, is already IP-rate-limited (5/hour), which is the right mitigation for that specific route, not CORS. Documenting this closes the loose end — no code change needed.

**Together model parity — CORRECTION (2026-07-06): not actually a live issue.** `apps/api/src/config.ts`'s `optionalProvider("TOGETHER")` only activates the Together tier if `TOGETHER_API_KEY` is set — John confirmed Together isn't configured (costs money, deliberately not hooked up). So Together isn't in the live fallback chain at all right now; its model-map gap is inert, not a real reliability hole. Withdrawing this as a priority fix — flagged it twice without checking activation status first, that was a miss. **Resolved (2026-07-06): Akash is active.** `AKASHML_API_KEY`/`AKASHML_BASE_URL` confirmed set on Railway — real 2-tier fallback (io.net + Akash) in production, not a single point of failure. Together correctly absent, as expected.

**Confirmed (2026-07-06): Railway's `SIWE_CHAIN_ID`/`BASE_RPC_URL` are correctly set to Base mainnet values**, not the Sepolia testnet values used during local testing. Web3-1 is genuinely production-ready — all loose ends from the audit are now closed except Week 3 legal content, which is still outstanding.

## Week 3 — Trust and support basics

- [x] **Terms of Service + Privacy Policy** — beta drafts in `legal/` and web routes `/legal/terms`, `/legal/privacy` (2026-07-08). **Attorney review still required** before production launch.
- [x] **Acceptable use / abuse policy** — `legal/acceptable-use.md`, `/legal/acceptable-use`, linked from signup.
- [x] **Feedback channel** — `support@lmxcloud.io` (`/legal/contact`). Replace with Discord or ticketing when ready.
- [x] **Pricing FAQ one-liner** — on `/legal/contact` and `legal/README.md`.

## Week 4 — Outreach prep

- **Refresh landing copy** around the DePIN value prop specifically: cheaper/more resilient inference via decentralized compute, OpenAI-compatible so it's a drop-in swap. Lead with "get an API key in 30 seconds," link the live demo.
- **Line up first channels**: r/LocalLLaMA, Indie Hackers, AI-dev Discord/Twitter circles, and io.net/Akash community channels (they have an interest in a router that showcases their networks).
- **Run a private dry run first.** Get 2-3 friendly technical testers on the deployed version before the public post — this is where the login flow, rate limits, and error states get caught cheaply instead of publicly.
- **Basic funnel visibility.** You don't need an analytics platform yet — a couple of SQL queries against the Postgres store (signups → first key → first successful request → repeat usage) tells you if outreach is converting.

## Web3 positioning — "AWS for Web3" (decided 2026-07-06)

Direction: reposition LMX Cloud as Web3-native infrastructure, not a DePIN-backed dev tool with web2 UX. Audited the existing auth/credit code to find what these features actually build on:

- ~~`wallet` is never verified~~ — **fixed 2026-07-07:** unauthenticated `POST /v1/auth/key` no longer accepts `wallet`; SIWE and authenticated `POST /v1/auth/keys` are the only wallet-linking paths.
- `CreditStore.credit(apiKeyId, amount)` in `apps/api/src/credits/postgres-store.ts` is already the exact function a stablecoin deposit listener would call — no schema change needed, just a new caller instead of the manual `CREDITS_ALLOW_SELF_TOPUP` dev route in `routes/balance.ts`.
- An API key can already be minted with just a `wallet` string and no email (`POST /v1/auth/key`) — meaning agent self-sovereign key minting is nearly free once wallet claims are actually verified.
- ~~Nothing on-chain exists anywhere in the codebase~~ — **updated 2026-07-08:** Web3-1 added SIWE + USDC deposit polling; Web3-2 added `LmxLogAnchor` contract, Merkle batch anchoring, and proof API. x402 per-call payments are **verified end-to-end on Base Sepolia** (paid flow settles on-chain, `payment_events` persists as `completed`) — Sprint 2 done, Sprint 3 (mainnet + hardening) is next.

### Sprint Web3-1 — Wallet identity + stablecoin rails (foundational, do together)

**Chain: Base.** Decided 2026-07-06. x402 (the machine-payment standard Web3-3 will align to for agent payments) settles 85% of its ~167M transactions on Base, and the x402 Foundation includes Coinbase, Cloudflare, Google, Visa, AWS, Circle, Anthropic, and Vercel — building Web3-1 on Base means Web3-3 plugs in later with no bridging or second wallet stack. Also the more mature tooling path (SIWE, viem, Alchemy/Coinbase CDP) for a small team on a timeline. Trade-off named and accepted: this doesn't lean into io.net's Solana-community ties architecturally, but that angle can still be pursued in outreach/marketing without the payment rail living on Solana.

**Deposit model: shared treasury address.** One treasury wallet on Base receives USDC; incoming transfers are matched to an account by verified sender wallet address, not a per-user generated address. Simpler custody story for a beta — revisit a per-user address scheme only if volume demands the cleaner attribution.

**Identity linking: deferred.** A wallet-only account is a separate account from an email/Clerk account for this sprint — no "link your wallet to your existing account" flow yet. `listForRecord` in `apps/api/src/auth/store.ts` already branches on email-or-wallet, so this falls out naturally; unifying the two is real scope for later, not now.

**What Web3-1 actually builds:**

1. SIWE (EIP-4361) signature verification — two new endpoints, `POST /v1/auth/wallet/nonce` (issue a challenge tied to an address) and `POST /v1/auth/wallet/verify` (verify the signed message, find-or-create the `ApiKeyRecord` by wallet, issue a session token) — mirrors the existing `POST /v1/auth/clerk` exchange pattern in `apps/api/src/routes/auth.ts`.
2. Both endpoints must be callable by a script holding a raw keypair, not just a browser wallet extension — this is what makes a key agent-mintable, not just human-wallet-mintable, and is the on-ramp for Web3-3.
3. Frontend: a "Connect Wallet" option next to Clerk on `SignInPage.tsx`/`SignUpPage.tsx` using standard EVM wallet-connect tooling (wagmi/viem + RainbowKit or ConnectKit).
4. A treasury USDC deposit address on Base, plus an on-chain listener (webhook or polling job against an RPC/indexer) that matches confirmed incoming transfers to a verified wallet's account and calls the existing `CreditStore.credit()` in `apps/api/src/credits/postgres-store.ts` — this function needs no changes, just a new caller replacing the dev-only `CREDITS_ALLOW_SELF_TOPUP` route in `routes/balance.ts` as the real funding mechanism.
5. A sensible confirmation-count threshold before crediting, to avoid crediting a balance that a chain reorg later reverses.

**Definition of done:** a wallet (human via browser extension, or agent via raw keypair script) can sign a challenge, receive a session/API key with no email involved, send USDC on Base to the treasury address, and see its credit balance update automatically without any manual top-up step.

**Status: VERIFIED END-TO-END ON BASE SEPOLIA (2026-07-06).** SIWE wallet sign-in (no email/Clerk involved) and the USDC deposit → auto-credit flow both confirmed working against testnet by hand. Config defaults to Base mainnet (`SIWE_CHAIN_ID=8453`, mainnet USDC contract) — this was overridden to Sepolia values for testing and needs to be flipped back to mainnet values before real production use.

### Web3-1 hardening pass — smoother UX (decided 2026-07-06)

**Status: DONE, verified in code 2026-07-06.** Checked `WalletConnectButton.tsx`, the new `useWalletSignIn.ts` hook, and `BillingPage.tsx` directly:
- ~~No live refresh~~ — done. `BillingPage` now has adaptive-interval polling (starts at 5s, backs off to 30s) while any deposit is pending, plus a visibility-change listener that refreshes immediately when the tab regains focus. Shows a "Watching for confirmations" banner while active.
- ~~No wrong-network handling~~ — done. `useWalletSignIn` exposes `wrongNetwork`/`switchToTargetChain`, with distinct button states for connecting/switching/signing (`walletSignInButtonLabel`).
- ~~Connecting vs. signing aren't distinguished~~ — done, same hook: phases are `idle → connecting → switching → signing`, each with its own button label ("Connecting…", "Switching network…", "Confirm in wallet…").
- ~~"Unmatched" deposits have no resolution path~~ — done. `BillingPage` shows a clear banner: sign in with the sending wallet if it was a mistake, or contact support with the tx hash for manual crediting.
- **Partially open:** wallet-side account/network changes *after* a session is already established aren't actively reconciled — `useWalletSignIn`'s reactive wagmi state handles this well pre-login (switching networks before signing in), but nothing forces re-authentication if the connected wallet changes *after* `sessionReady` is already true. Low-severity (worst case is a confusing UI state, not a security issue, since the session token itself was already validated), but not fully closed.
- Mobile/non-extension wallets: still not supported, as expected (deferred by design).

### In-console "Add Credits" (decided 2026-07-06)

**Status: DONE, verified in code.** `AddCreditsCard` component exists and is wired into `BillingPage.tsx` for wallet accounts only, feeding into the same polling/confirmation system above via `onDepositSubmitted`. Also found `deposits/limits.ts` with a `MIN_DEPOSIT_USDC`/max deposit guard that wasn't explicitly requested — Cursor added sensible dust/ceiling limits on its own.

## Documentation refresh (decided 2026-07-06, before Web3-2)

Paused Web3-2 to fix a real gap found while reviewing `DocsPage.tsx` and `README.md`: neither mentions *any* Web3 functionality. README is actually more current than expected on the model/API side (documents 30 model aliases, streaming, the docs/status pages), but both docs surfaces still describe LMX Cloud purely as a "DePIN Inference Router" with zero mention of wallet auth (SIWE), USDC deposits, or the agent-mintable key path — all of which are live in production. Also missing: any conceptual explanation of the broader vision, and a public-facing roadmap. Scope: update `DocsPage.tsx` with a conceptual overview section, a wallet-authentication section, a USDC-funding section, and a curated public roadmap section (not a copy-paste of this internal file's audit trail — written for outside readers). Refresh `README.md`'s positioning and document the currently-undocumented Web3-1 env vars.

### Sprint Web3-2 — Verifiable on-chain logs (DONE 2026-07-07)

**Goal:** make LMX Cloud's routing/latency/cost claims independently verifiable, not just numbers displayed in a dashboard you control. Right now a skeptical developer has to trust `LogsPage.tsx`; Web3-2 lets them cryptographically check that a log entry hasn't been altered after the fact.

**Two pieces:**
1. **Per-request receipt.** Hash the deterministic metadata fields of each `usage_events` row (provider, model, tokens, cost, latency, timestamp — NOT prompt/response content, metadata only, for privacy) into a receipt hash, stored alongside the row.
2. **Batched Merkle anchoring.** Periodically (time- or count-based batch, same pattern as the deposit poller's interval config) build a Merkle tree from recent receipt hashes and anchor just the root on Base.

**Real decision, made:** anchor via a minimal purpose-built smart contract (`anchor(bytes32 root)` + event), not a plain transaction with calldata. Barely more engineering with viem already in place, and dramatically more credible to an outside auditor — "here's our contract on Basescan, here's every root we've published" is a real trust signal; an obscure transaction's calldata is not.

**Scope for this sprint:** on-chain anchoring, a `GET /v1/usage/logs/:id/proof` endpoint returning the Merkle proof for a given log entry, and surfacing the contract address + recent anchored roots on the already-public `StatusPage.tsx`. A polished "verify this receipt yourself" UI is a nice-to-have, not required — Cursor's call on how far to take it. Historical log rows from before this ships won't be retroactively verifiable, only new ones going forward.

**Status: SHIPPED AND VERIFIED END-TO-END ON BASE SEPOLIA (2026-07-07).** Implemented in three PRs: (1) `lmx_receipt_v1` canonical receipt + `receipt_hash` on `usage_events`; (2) `contracts/LmxLogAnchor.sol`, anchor poller/store/merkle, `pnpm deploy:anchor`; (3) proof API, status `anchoring` object, `StatusPage.tsx` card, `pnpm verify:receipt`. Confirmed locally: chat completion → batch claimed → on-chain tx → proof `status: anchored` → CLI verification passes (receipt hash, Merkle proof, `anchoredAt` on contract). Production mainnet anchor deploy not yet done — Railway needs `ANCHOR_*` env vars + mainnet contract when ready.

## Phase 1 distribution goal (decided 2026-07-06): "findable and payable" by autonomous agents

This replaces the old vague "Web3-3" stub. Phase 1 is done when an autonomous agent — zero human in the loop, no prior relationship with LMX Cloud — can discover LMX Cloud through at least one of three specific channels, pay per call in stablecoin, and get routed DePIN compute back. Everything before this point is infrastructure; this is the first point real, un-prompted revenue can show up.

**Why these three channels, in this order:** the first is protocol-level (works for any agent using the x402 payment standard, regardless of what framework built it), the second is the widest possible net (any MCP-compatible agent — Claude, ChatGPT agents, custom LangChain agents — not just crypto-native ones), the third is framework-specific and highest-touch, best used as a proof-of-concept case study once the payment plumbing from the first two is already working. Virtuals (ACP) is deliberately not in this list — its commerce layer is bespoke (on-chain jobs/escrow, not confirmed to run over x402), meaningfully heavier to build against, and not worth the lift until Phase 1 proves agents actually pay for this at all.

**Prerequisite that blocks all three goals: real x402 per-call payments.** Today's Web3-1 flow is deposit-then-spend-a-balance (fund an account, draw it down over many requests). x402 and the discovery layers built on it (Bazaar, Agentic.Market, MCP) expect pay-per-request: an agent gets an HTTP 402 response with a price, pays that specific call, gets the result. This is additive, not a replacement — the existing balance-funded flow stays for dashboard/human users. The new piece is a 402 response + payment-verification step on the paid inference routes, reusing the existing treasury wallet and `CreditStore` plumbing from Web3-1 rather than building new payment infrastructure from scratch.

### Goal 1 — x402 Bazaar + Agentic.Market listing

Build per-call x402 payment support on the inference endpoints (starting with `chat.ts`'s completions route), verify payment before routing to io.net/Akash as already built, then submit the resulting endpoint to Coinbase's Bazaar discovery catalog and to the Agentic.Market directory.

**Definition of done:** an agent with zero prior relationship to LMX Cloud finds it by searching Bazaar or Agentic.Market for inference/compute, pays for a single call in stablecoin, and gets a routed response back — no signup, no API key, no pre-funded balance.

### Goal 2 — MCP server

**Shipped (v1, 2026-07-09):** hosted Streamable HTTP MCP at `https://mcp.lmxcloud.io/mcp` with per-user `Authorization: Bearer lmx_...` passthrough, rate limits, and structured caller logging. Seven tools cover the full agent lifecycle on the existing balance-funded API:

| Tool | Purpose |
|------|---------|
| `get_status` | Provider health + fallback chain |
| `list_models` | Live model catalog |
| `get_pricing` | Full pricing catalog |
| `quote_price` | Single-call USDC estimate |
| `get_balance` | Caller credit balance |
| `get_usage` | Caller usage totals |
| `chat_completion` | Run inference (bills caller's key) |

**E2E validated:** external demo repo agent ran the full 6-step smoke suite (status → models → quote → balance → completion → usage) through MCP.

**Still open for Goal 2 "done":**
- Wrap the x402 per-call endpoint from Goal 1 (today MCP uses pre-funded API key balance, not pay-per-request stablecoin).
- Publish/discover in the MCP registry ecosystem (Bazaar listing gate still applies).

**Definition of done (full Goal 2):** any MCP-compatible agent can discover LMX Cloud through the MCP registry ecosystem and call it as a paid tool, using the same per-call payment flow as Goal 1.

### Goal 3 — ElizaOS plugin

Build a model-provider plugin against the existing OpenAI-compatible endpoint, with wallet-based key minting wired into plugin setup (reusing the raw-keypair mint flow already shipped in Web3-1 — no new auth work needed). Submit it to the `elizaos-plugins/registry` (an `index.json` entry via PR).

**Definition of done:** an ElizaOS developer installs the plugin, points it at a wallet or keypair, and their agent's inference is funded and routed through LMX Cloud with no manual signup step. Deliberately last — most framework-specific, best positioned as a reference case study once Goals 1-2 prove the underlying payment flow actually works.

**Explicitly out of scope for Phase 1:** Virtuals/ACP, Autonolas, Fetch.ai, Bittensor. Longer tail, bespoke integrations each — revisit only once Goals 1-3 show real traffic.

**Hard blocker, elevated again: Week 3 legal.** Going live on public discovery catalogs means strangers' autonomous agents transacting real stablecoin against LMX Cloud with zero signup and zero prior relationship — a materially bigger exposure than the free-beta dev signup Week 3 was originally scoped for. ToS, privacy policy, and acceptable-use content must close before or in parallel with Goal 1 shipping, not after.

**Success metric for Phase 1:** the first real, un-prompted x402 payment from a wallet LMX Cloud has never seen before, routed successfully to io.net or Akash and settled. That single event is the proof-of-life signal that distribution works — everything upstream of it is plumbing, not revenue.

**Native token — still deferred by design**, unchanged from before, after Phase 1 once there's real usage/treasury data. "Governance + economic rights" token language is securities-law surface area (Howey-test territory) — legal counsel before any public token language, not an engineering task.

**Open question, still unresolved:** does Phase 1 replace the current dev-first free-beta plan (Weeks 3-4 above), or run as a parallel track? Web2 (Clerk) and Web3 (wallet) users can coexist under Web3-1's design, but Week 4 outreach copy/channel choice should reflect whichever way this leans.

## Phase 1 sprint plan (added 2026-07-06): execution breakdown

The Phase 1 section above is the *what and why*. This is the *when* — six sprints from here to "listed on a distribution network and actually collecting money," with measurable done-criteria per sprint. Named "Distribution Sprint" to avoid clashing with the existing Week 1-4 labels above, which are a separate (mostly already-done) track. Three tracks run across these sprints: **Track A** (payment plumbing → the three distribution goals, sequential, blocking), **Track B** (legal, parallel, must close before Sprint 4's public listing), **Track C** (Web3-2 verifiable logs — **done 2026-07-07**, was a trust/conversion booster ahead of Sprint 4 listing).

### Distribution Sprint 1 — Decisions + foundations

- [x] **Security:** remove unverified `wallet` from unauthenticated `POST /v1/auth/key` (wallet keys via SIWE only). Done 2026-07-07.
- [x] Decide per-call pricing (dollar amount per model/token, documented in one place both docs and the eventual Bazaar listing will pull from). See `docs/x402-pricing.md` and `GET /v1/pricing`.
- [x] Decide payment verification approach: self-verify the on-chain transaction vs. use Coinbase's CDP facilitator — document the trade-off actually made, not just the options. See `docs/x402-verification.md` (CDP Facilitator chosen).
- [x] DB migration: add a per-call payment-event record distinct from the existing balance-credit rows, so a payment can be reconciled against the specific inference call it paid for. `payment_events` table + `usage_events.payment_event_id`.
- [ ] Confirm the uptime monitor (UptimeRobot/Better Stack) is actually configured — long-open item, now matters more since Bazaar's discovery ranking factors reliability.
- [x] (Track B, parallel) ToS / privacy / acceptable-use drafts — `legal/` + `/legal/*` (2026-07-08).
- [x] ~~(Track C) Web3-2 receipt hashing~~ — done (`lmx_receipt_v1`, `usage_events.receipt_hash`).

### Distribution Sprint 2 — x402 per-call payments (Track A)

- [x] Implement 402 Payment Required response + payment verification on the paid inference routes (`chat.ts` first), per Sprint 1's decision. `@x402/fastify` middleware + `upto` scheme; dual path with Bearer auth for balance users.
- [x] Reconciliation logic: auto-refund or credit-back when payment succeeds but the downstream io.net/Akash call fails — payment cancellation on handler 4xx/5xx via x402 middleware; partial settlement via `setSettlementOverrides` for actual token cost.
- [x] **End-to-end test on Base Sepolia (2026-07-08).** Unpaid probe green (`pnpm test:x402` → 402 in ~30ms) and paid path (`pnpm test:x402 -- --pay`) verified end-to-end: verify → inference → settle with a `payment_events` row written.
- [x] (Track B) Legal draft ready for review — published at `/legal/*`; counsel review pending.
- [x] ~~(Track C) Web3-2: batched Merkle anchoring live on testnet~~ — done (Sepolia verified 2026-07-07).

### Distribution Sprint 3 — Production hardening

- [x] **RPC reliability close-out on Sepolia (2026-07-08).** Dedicated Base Sepolia RPC configured; paid soak (`pnpm test:x402 -- --pay --repeat 10 --delay-ms 1000`) green; deposit poller no longer throws provider block-range errors after `DEPOSIT_MAX_LOG_BLOCK_RANGE` env + one-time fallback retry.
- [x] **x402 abuse hardening (partial, 2026-07-08).** Replay rejection for consumed payment payloads (`409` / `x402_payment_replay`); wallet-aware anonymous rate-limit keys; `X402_ANON_RATE_LIMIT_*` env support. Soak test harness (`test:x402:soak`, `--repeat`, `--delay-ms`).
- [x] **Mainnet profile wired (2026-07-08).** `.env.mainnet` + `LMX_ENV=mainnet` loading; `dev:mainnet`, `test:x402:mainnet-canary`, `check:mainnet-balance` scripts; unpaid 402 on `eip155:8453` with mainnet USDC asset verified; payer wallet funded on Base mainnet.
- [x] **Mainnet paid canary green.** **Done 2026-07-13.** Was blocked on Alchemy RPC 429 (compute-units/sec limit) during Permit2 approval / balance reads — resolved by swapping `BASE_RPC_URL` in `.env.mainnet` to Coinbase CDP Node (same CDP account as the x402 facilitator). Confirmed: HTTP 200, `chain_id: 8453`, settlement `success`, tx `0x95cf4bdf4990bca4a57136b2162e9830d6e3b68484cd670d8acedcc3442eabe8`; one-time Permit2 USDC approval also completed.
- [x] **x402 payment-replay race condition — found and closed 2026-07-16.** Investigating the burst/load-test task (below) surfaced a real bug before any load test was written: `rejectReplayedX402Payment`'s check (was a plain `SELECT` + status comparison, not a claim) ran before the provider call as intended, but wasn't atomic — two concurrent requests carrying the identical signed payment payload could both pass the check before either wrote anything back, both proceed to call io.net/Akash for real (double provider cost), and the old unconditional `linkUsageEvent` write let the second silently overwrite the first's `usage_event_id` with no rejection. Fixed with a proper atomic claim: `tryClaimForFulfillment(payloadHash)` transitions `quoted|verified → fulfilling` guarded on `usage_event_id IS NULL` — exactly one concurrent caller wins, the rest get `null` back. `claimX402PaymentOrReject` (chat.ts, runs immediately before `router.route()`) claims or returns 409 before any inference spend happens, not after. The unconditional `linkUsageEvent` was removed entirely; the handler now calls `markCompleted` (requires `fulfilling|settled|verified` + `usage_event_id IS NULL`) so a second linker can no longer clobber the first. Confirmed the settle-hook's `markCompleted` call in `x402-server.ts` (looked like dead weight at first glance) is actually load-bearing — it covers the case where settle recording wins the race, or redelivery with usage already linked but status still `settled`; normal order is verify → claim → inference → `markCompleted` (in handler) → settle → `markSettled`. Validated: `pnpm --filter @lmxcloud/api typecheck` passes; new `scripts/test-payment-claim-race.ts` fires 40 parallel claims against the same payload — 1 winner, 39 losers, confirmed. **Not yet validated:** a live HTTP double-pay test (needs a signed payload + funded wallet against a running server) — the store-level race test exercises the same atomic gate the HTTP path uses, but hasn't been proven end-to-end over real HTTP concurrency.
- [ ] **Burst/load test, next.** With the replay race closed, write the actual concurrency test (extend/fork `test-x402-chat.ts`, which today is strictly sequential and would never have caught the bug above): (a) same payment payload fired N times simultaneously — should now yield exactly one success; (b) many distinct payloads from one wallet rapid-fire — confirm `X402_ANON_RATE_LIMIT_MAX` (default 10/60s, wallet-keyed) holds under real concurrency, not just sequential timing; (c) a burst of malformed/garbage payment headers — confirm clean rejection without resource exhaustion.
- [x] **Payer visibility — decided and shipped 2026-07-16.** Chose id-based receipt lookup over wallet-queryable history or staying internal-only: anonymous x402 payers (no session, no account) can now self-verify a specific call without any auth. `chat.ts` returns a new `x-lmx-usage-id` response header (exposed via CORS in `server.ts`) on non-streaming completions whenever `usageEventId` is recorded. `GET /v1/usage/logs/:id/proof` and `GET /v1/billing/payments/:id` both dropped their `authenticate` requirement and now serve by exact id only — possessing the id (which only the original caller ever receives) is the capability, no ownership check needed. `GET /v1/billing/payments` (the full list view) is intentionally untouched and still requires a session — this only closes the single-call lookup gap, not full spend-history visibility. Not yet covered: streaming completions don't get the header (non-blocking — x402 doesn't support streaming yet anyway).
- [x] (Track B) Legal published and linked from signup + docs — **counsel review still required before Sprint 4 listing gate.**
- [x] ~~(Track C) Web3-2: `GET /v1/usage/logs/:id/proof` endpoint live, contract address + recent roots surfaced on `StatusPage.tsx`~~ — done.
- [ ] (Track C, optional) Deploy anchor contract on Base mainnet + set `ANCHOR_*` on Railway; optional LogsPage proof link.

### Cloudflare edge hardening (decided 2026-07-11, gates Sprint 4 listing)

**Why now:** Sprint 4 puts `api.lmxcloud.io` and `mcp.lmxcloud.io` in front of strangers' autonomous agents with zero prior relationship — public discovery catalog traffic, no signup gate. Today both are bare Railway domains with no edge protection: no DDoS absorption, no WAF, no rate limiting that survives a redeploy. Cloudflare closes this before listing, not after.

**Scope, decided:** Cloudflare sits in front of the API + MCP server only (`api.lmxcloud.io`, `mcp.lmxcloud.io` on Railway). The dashboard (`apps/web` on Vercel) already has Vercel's own edge network and is lower-risk (human/browser traffic, Clerk-gated) — not in scope for this pass.

**Plan:**
1. ~~**DNS migration.**~~ **Done 2026-07-12.** `lmxcloud.io` purchased directly through Cloudflare Registrar — zone is active on Cloudflare from day one, no nameserver migration needed.
2. **Proxy the Railway custom domains through Cloudflare.** `api.lmxcloud.io` and `mcp.lmxcloud.io` become Cloudflare-proxied (orange-cloud) CNAMEs pointing at the existing Railway-generated domains (DEPLOY.md already documents these as "optional custom domain" — this makes them non-optional). SSL/TLS mode: Full (Strict), since Railway terminates TLS on its own domain already.
3. **WAF.** Enable Cloudflare Managed Rules (OWASP core ruleset) on both subdomains.
4. **Edge rate limiting.** Add Cloudflare rate-limiting rules as a second layer on top of the existing app-level limits (`KEY_GEN_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_MAX`) — edge rules survive Railway redeploys and multi-instance scaling, which the in-memory app limiter doesn't. Particularly worth tightening on `POST /v1/auth/key` (the one unauthenticated route).
5. **Bot management — use carefully.** Cloudflare's Bot Fight Mode / Super Bot Fight Mode is designed to block the exact traffic pattern LMX Cloud is about to court on purpose (autonomous agents, no browser, no human). Do not enable aggressive bot-blocking on `api.lmxcloud.io`/`mcp.lmxcloud.io` without allowlisting for legitimate non-browser clients — this is a real footgun for Sprint 4's actual goal. DDoS protection and WAF are unconditionally safe to enable; bot scoring is not.
6. **Origin lock (code dependency — see Cursor prompt).** Once Cloudflare is in front, the raw Railway domains (`*.up.railway.app`) still resolve directly and bypass all of the above. Needs an origin-side check so the API/MCP server reject traffic that didn't come through Cloudflare.

**Status: in progress (updated 2026-07-14).** Step 1 (domain + zone) done. DNS records added in Cloudflare: apex + `www` → Vercel (DNS only), `api`/`mcp` → Railway (proxied). `api.lmxcloud.io` and `www.lmxcloud.io`/`lmxcloud.io` **verified live end-to-end** (Vercel shows Valid Configuration on both, dashboard serves correctly, `GET https://api.lmxcloud.io/health` returns 200). `VITE_API_URL`, `SIWE_DOMAIN`, `SIWE_URI` confirmed correctly set to production values in Vercel (2026-07-14). Edge rate limiting **done**: `auth-key-limit` rule deployed (10 req/hour per IP on `/v1/auth/key`, block 1hr). **WAF managed rules deferred** — OWASP Managed Ruleset requires Cloudflare Pro ($20/mo), John chose to skip for now (confirmed again 2026-07-14); relying on automatic DDoS protection + the rate-limit rule instead. Revisit before Sprint 4 listing if budget allows. **Railway Hobby upgrade also deferred by choice (2026-07-14)** — no spend right now. **Resolved (2026-07-14): not a contradiction, confirmed still blocked.** Cloudflare has a proxied CNAME for `mcp.lmxcloud.io` → `lmxcloudio-production.up.railway.app`, but checked Railway → mcp-server → Settings → Networking directly: only the raw generated domain is registered there, no custom domain entry. The DNS record alone doesn't make it live — Railway doesn't know to route that hostname to this service until the custom domain is added on Railway's side, which is still blocked by the trial-plan 1-custom-domain cap (used by `api.lmxcloud.io`). `mcp.lmxcloud.io` is very likely non-functional right now. Unchanged: deferred until John upgrades to Railway Hobby (~$5/mo, no spend for now per 2026-07-14 decision). **Bot Fight Mode confirmed OFF (2026-07-14)** — verified in Cloudflare Security → Bots → Detection tools; "Block AI bots" also confirmed set to "Allow (do not block)". Both are correctly configured for agent traffic, no action needed.

**Clerk production domain — done 2026-07-14.** Clerk's own Frontend API/account-portal/email DNS setup was a separate, previously-undiscovered gap: production domain showed 0/5 DNS records verified (`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey` subdomains). All 5 CNAMEs added in Cloudflare as **DNS only** (not proxied — Cloudflare proxying breaks Clerk's DNS verification check per their docs). All 5 now verified, primary domain shows Verified, SSL certificates Issued. Clerk's subdomain allowlist also enabled with only `www.lmxcloud.io` added (the allowlist was already toggled on with an empty list, which was blocking all subdomains including `www` until this fix — confirmed working after the add). **GitHub SSO — fixed 2026-07-16.** Was enabled in Clerk production with no Client ID/Secret configured (leftover from cloning dev-instance settings) — would have errored on click. Decision: keep GitHub sign-in enabled (wanted as a no-wallet login path), not disable it. Registered a real GitHub OAuth App (`LMXCloud`, homepage `https://lmxcloud.io`, callback `https://clerk.lmxcloud.io/v1/oauth_callback` from Clerk's custom-credentials screen), added the Client ID/Secret to Clerk's GitHub connection. Clerk now shows GitHub as "Used for sign-in" (vs. Google's "Setup required," untouched). Verified live end-to-end: incognito sign-in via "Continue with GitHub" on production works.

**Step 6 (origin lock) DONE and verified live (2026-07-12).** `apps/api/src/origin-lock.ts` + `apps/mcp-server/src/origin-lock.ts`, secret passed via `X-Origin-Secret` request header (Cloudflare reserves the `Cf-` prefix — first attempt at `Cf-Origin-Secret` was rejected by the Transform Rule UI, renamed). Env var is `LMX_ORIGIN_SECRET` (renamed from `CF_ORIGIN_SECRET` mid-debug, keep this name going forward). Cloudflare Request Header Transform Rule injects the header for `api.lmxcloud.io`/`mcp.lmxcloud.io` only. `/health` and `/healthz` stay exempt so Railway's own healthchecks keep working. **Root cause of a long debugging loop:** the code was implemented and looked correct locally the whole time, but was never committed/pushed to GitHub — Railway kept redeploying stale old code regardless of what env vars were changed, so nothing we tried could have worked until `git push origin main` actually happened. Verified post-push: raw `*.up.railway.app` domain now blocked on non-health routes, `api.lmxcloud.io` (through Cloudflare) unaffected. **MCP side verified 2026-07-14** — see Distribution Sprint 5 / Goal 2 section below for the full resolution (Railway upgrade, new custom domain, origin-lock confirmed with a 403 on the raw domain). **Open risk:** the git working tree had every file in the repo showing as modified/uncommitted before this push (not just origin-lock files) — flagged but not fully diffed for unrelated changes before committing; worth a closer look before the next big push.

### Distribution Sprint 4 — Goal 1: x402 Bazaar + Agentic.Market listing — DONE 2026-07-14

**Correction to the plan above:** there is no manual "submit to Bazaar" or "submit to Agentic.Market" step — Agentic.Market is Coinbase's own search UI over the same Bazaar index, not a separate directory. Cataloging is fully automatic: a route that declares Bazaar discovery metadata gets indexed the first time a real payment **settles** through the CDP Facilitator for that URL. No signup, no form, no separate registration.

- [x] **Bazaar discovery metadata added** to `POST /v1/chat/completions` (`apps/api/src/payments/x402-server.ts`): installed `@x402/extensions`, registered `bazaarResourceServerExtension` on the resource server, attached `declareDiscoveryExtension()` with a realistic input/output example, JSON schema, and a semantic description. Pricing, verify/settle hooks, and the payment store untouched.
- [x] **One real settlement completed against production** — `test:x402:mainnet-canary` run with `API_URL=https://api.lmxcloud.io` (not a local dev server — see debugging note below), settled `0xcca9a38a…`.
- [x] **Confirmed live and searchable** — CDP's merchant lookup (`GET /v2/x402/discovery/merchant?payTo=<TREASURY_ADDRESS>`) lists the route; Railway settle logs show `{"bazaar":{"status":"processing"}}`, no more rejection.
- [x] **Success metric hit:** real settled mainnet payment (`0xcca9a38a…`) through the Bazaar-cataloged route — the proof-of-life signal Phase 1 was watching for, per the definition in the Phase 1 section above.

**Debugging note, worth remembering:** the first settle attempt was rejected by Bazaar (`discovery request validation failed: resource must start with 'https://'`) — not a code bug. The canary was pointed at a temporary local dev server (`http://localhost:3002` via `dev:mainnet`), and the x402 middleware derives the "resource" identity from the incoming request's own protocol/host. Pointing `API_URL` at the real deployed `https://api.lmxcloud.io` instead fixed it immediately — no code change needed. If this resurfaces, check what `API_URL` the test script is pointed at before assuming it's a schema/validation bug.

**Not done, deliberately deferred:** legal attorney review (parked by choice — real public catalog traffic is now live against production without it, worth revisiting), x402 abuse/burst-load testing on the anonymous payment path (still open, see engineering priorities above).

### Distribution Sprint 5 — Goal 2: MCP server

- [x] Build MCP server — balance-funded v1 at `apps/mcp-server`, hosted HTTP on Railway, originally 7 tools (`get_status`, `list_models`, `get_pricing`, `quote_price`, `get_balance`, `get_usage`, `chat_completion`); extended 2026-07-18 with vision on `chat_completion` and `web_search` (8 tools).
- [x] Per-user API key passthrough via `Authorization` header (server `LMX_ADMIN_API_KEY` fallback only).
- [x] Tested end-to-end with a real MCP client agent (6-step smoke suite passed in external demo repo).
- [x] Docs + console keys page MCP onboarding (`/docs#mcp`, Keys "Use with MCP" config copy).
- [x] **Wrap x402 per-call payment endpoint — done 2026-07-14.** `chat_completion` now dual-path: existing Bearer/balance flow unchanged, x402 pay-per-call when `api_key` is omitted. Seller-side via `createPaymentWrapper` (`@x402/mcp`) + Bazaar `declareDiscoveryExtension()` (`toolName`/`transport: "streamable-http"`), same CDP facilitator + `upto` scheme as the HTTP route. New shared package `@lmxcloud/x402` (`createLmxX402ResourceServer`) used by both `apps/api` and `apps/mcp-server` so facilitator setup isn't duplicated — deliberately kept out of `@lmxcloud/shared` so the web app doesn't pick up x402 deps. After MCP settles payment, fulfillment calls the API with a dedicated `LMX_X402_FULFILLMENT_API_KEY` (admin/fulfillment keys are explicitly not treated as the caller's balance key). Verified live: `GET https://mcp.lmxcloud.io/healthz` returns `"x402": true`.
- [x] **Published to the official MCP Registry — done 2026-07-14.** `server.json` at `apps/mcp-server/server.json` (`remotes`: streamable-http → `https://mcp.lmxcloud.io/mcp`). Authenticated via DNS (Ed25519 TXT record on `lmxcloud.io` root, namespace `io.lmxcloud/*`), published as `io.lmxcloud/mcp-server` v0.1.0 to `registry.modelcontextprotocol.io`. **Goal 2 is now fully done** — balance-funded and x402 pay-per-call both work, and the server is discoverable through the same registry ecosystem Claude/other MCP clients pull from.

**Reachability blocker, resolved 2026-07-14.** `mcp.lmxcloud.io` had no working public URL: Railway's trial plan capped custom domains at 1 (used by `api.lmxcloud.io`), and separately `apps/mcp-server/src/origin-lock.ts` explicitly does **not** exempt `/mcp` from the Cloudflare-origin check (only `/healthz` is exempt) — so even the raw Railway domain was already returning 403 to direct traffic. Both blocked the MCP Registry's hard requirement that `remotes[].url` be publicly accessible. Fixed by upgrading to Railway Hobby (~$5/mo, John chose to pay this time since it was now blocking actual distribution, not just Cloudflare hygiene) and adding `mcp.lmxcloud.io` as a custom domain — new Railway-generated target `eseft9zl.up.railway.app`, required updating the existing proxied CNAME plus a **separate** `_railway-verify.mcp` TXT record (a leftover `_railway-verify.api` record from the original api.lmxcloud.io verification looked similar and caused early confusion — Railway verification TXT records are per-subdomain, not project-wide). Verified end-to-end post-fix: `https://mcp.lmxcloud.io/healthz` returns 200 with `"x402": true`; raw `https://lmxcloudio-production.up.railway.app/mcp` returns `403 Forbidden` — origin-lock confirmed working on the MCP side, closing the gap flagged back on 2026-07-12.

### Distribution Sprint 6 — Goal 3: ElizaOS plugin

**Scope revised 2026-07-14: x402-only, not balance-key.** Original plan assumed wiring in wallet-based key minting from Web3-1 (SIWE nonce/verify) to mint a balance-funded key on plugin init. Revised after checking whether ElizaOS's model-handler interface could support an inline 402→sign→retry flow — confirmed yes (real precedent: other ElizaOS plugins already do exactly this, e.g. Dexter-SDK-based integrations). Since `POST /v1/chat/completions` already handles x402 pay-per-call end-to-end with zero server-side changes needed, the plugin went x402-only: one config value (an EVM private key funded with USDC on Base), no dual-auth complexity, true to the wallet-native pitch. **Zero changes made to the LMXCloud.io repo for this goal.**

- [x] **Plugin built** — standalone repo (deliberately outside the LMXCloud.io monorepo, own npm package `@lmxcloud/plugin-lmxcloud`), at `github.com/LMXCloud/plugin-lmxcloud`. Registers `ModelType.TEXT_SMALL` / `TEXT_LARGE` handlers calling `https://api.lmxcloud.io/v1/chat/completions`, paying via `@x402/core/client` + `@x402/evm` (`UptoEvmScheme`) — same client packages already proven in `apps/api/scripts/test-x402-chat.ts`'s `--pay` flow, not a new/third-party payment SDK. Defaults verified live against `GET /v1/models`: `TEXT_SMALL` → `glm-4.7-flash`, `TEXT_LARGE` → `llama-3-70b`, both confirmed real (not hallucinated) against the production model catalog.
- [x] Repo created and pushed to GitHub (`LMXCloud/plugin-lmxcloud` — under the LMXCloud org with the main monorepo).
- [x] `elizaos publish --dry-run` succeeded (the CLI has no separate `plugins submit` command — `publish --dry-run` is the actual dry-run path). Registry metadata generated correctly; `repository`/`bugs.url` fields fixed post-dry-run to point at the real repo instead of a placeholder `lmxcloud` org that doesn't exist. Em-dash console-output artifact confirmed cosmetic only (files are valid UTF-8, real U+2014, no corruption). `packageType`/`platform` fields are injected automatically by the real `publish` command before submission — safe that they aren't pre-committed.
- [x] Real logo (400×400) and banner (1280×640) images generated (ChatGPT-prompted, brand colors matched to `apps/web/src/lib/clerk.ts` theme) and added to `images/`; dry-run confirmed no missing-image warnings.
- [x] **`@lmxcloud/plugin-lmxcloud@0.1.0` published to npm — done 2026-07-14.** `npm view` confirms it's live, with `elizaos` in `keywords` — per elizaOS's own registry docs, the runtime auto-discovers any npm package with that keyword, so **the plugin is likely already functionally discoverable/usable**, independent of the registry PR below. Publish was blocked for a while on npm 2FA (account uses a WebAuthn security key, not a TOTP app — `--otp=<code>` doesn't apply to that method at all; fixed with a granular access token, "bypass 2FA" enabled, via `npm config set //registry.npmjs.org/:_authToken <token>`). One real scare mid-debugging: a `npm publish` was accidentally run from the LMXCloud.io monorepo root instead of the plugin directory — would have published the entire private repo (legal drafts, full source, tmp debug files) to public npm. Caught harmlessly by the root `package.json`'s `"private": true` field. **Lesson: always confirm `pwd` before `npm publish`.**
- [x] **Correction, found 2026-07-14: `elizaos-plugins/registry` is archived/deprecated**, not just a stale CLI target. Real process: fork `elizaOS/eliza`, add one entry file, PR against upstream (community-reviewed, not instant).
- [x] **Registry PR opened — 2026-07-15.** Forked `johnny-lineen/eliza` from upstream `develop` (personal account, not the `LMXCloud` org — one-off contribution, not a hosted product repo). Added `packages/registry/entries/third-party/lmxcloud__plugin-lmxcloud.json` matching peer-entry shape (`package`, `repository: github:LMXCloud/plugin-lmxcloud`, `kind: "plugin"`, description, homepage, version, tags). `bun run --cwd packages/registry validate` passed (24 entries OK); `generate` updated `generated-registry.json`. Pushed and opened **[elizaOS/eliza#16397](https://github.com/elizaOS/eliza/pull/16397)**. **Status: awaiting community review, not yet merged.**
- [ ] **Tested end-to-end with a real ElizaOS agent instance — paused 2026-07-15, not started.** Plan when resumed: scaffold a minimal ElizaOS agent, install the plugin, generate a fresh throwaway EVM key (not the production treasury/facilitator wallet) as the model-provider config, fund it with a small amount of USDC on Base mainnet, then confirm the full loop — x402 payment settles (new `payment_events` row or on-chain transfer to treasury) and the agent actually uses a real model response. Not blocking anything else; PR #16397 review can proceed independently.

## Housekeeping (added 2026-07-15)

**Why now:** with all three Phase 1 distribution goals done or one step from done, the next real gap wasn't engineering — it was that nothing aggregates cross-channel activity into one view, and the public-facing GitHub presence didn't match what's actually built. This sprint is operational/presentation polish sitting between closing out Phase 1 and starting the traffic/marketing push (see the per-channel traffic plans and "First Marketing Sprint" — not yet written into this file as their own section).

**GitHub — DONE 2026-07-15.**
- [x] Created the `LMXCloud` GitHub org.
- [x] Transferred both public repos into it: `LMXCloud/LMXCloud.io` (main monorepo) and `LMXCloud/plugin-lmxcloud` (ElizaOS plugin). Both were already public under the personal account (`johnny-lineen`) — the move was about branding/ownership, not visibility.
- [x] Local git remotes updated to the new org URLs on both repos.
- [x] **README.md rewritten** — replaced the old Phase 1-7 changelog framing with current end-to-end capabilities: x402 dual-path pay-per-call + Bazaar/Agentic.Market discovery, MCP hosted server + official registry listing (`io.lmxcloud/mcp-server`), the ElizaOS plugin (`@lmxcloud/plugin-lmxcloud`), and verifiable receipts, alongside the still-accurate routing/auth/USDC-deposit sections (setup, wallet/USDC funding, demo, dashboard, MCP quickstart, fallback chain, models tables kept and lightly extended).
- [x] **All `johnny-lineen` GitHub path references updated to `LMXCloud`** — repo link in `DEPLOY.md`, plugin repo references in this file, `repository`/`bugs` fields in `plugin-lmxcloud/package.json`. Confirmed `apps/mcp-server/server.json` and monorepo `package.json` files had no GitHub owner field to begin with (nothing to change there); grep for `johnny-lineen` across `LMXCloud.io` is now clean.
- **Why this mattered for sequencing:** the ElizaOS registry PR (Distribution Sprint 6, still open — see above) hasn't been submitted yet, so it can now reference the `LMXCloud` org path directly instead of the old personal one, avoiding a later edit/resubmit.

**Ops dashboard — built, local only.** Standalone app at `apps/ops` (Vite/React, not a page inside `apps/web`), backed by a new `GET /v1/ops/overview` route (`apps/api/src/routes/ops.ts`, `requireOpsAuth`/`LMX_OPS_API_KEY` Bearer auth). Aggregates provider health, usage summary/history, x402 payment status counts + recent payments, a "stuck payments" check (quoted/verified >15 min old), and MCP tool call events (`apps/ops/src/App.tsx`, `apps/api/src/ops/`), plus a threshold-based "needs attention" irregularity panel across health/payments/usage/MCP/config. Polls every 15s. **Status (2026-07-15): running locally only, not deployed.** A `vercel.json` already exists in `apps/ops` (build via `pnpm --filter @lmxcloud/ops build`, `dist` output) — deploying is likely a short step whenever ready, same pattern as the existing Vercel-hosted `apps/web`.

**Notifications — deferred, separate follow-up.** The dashboard's in-app "needs attention" panel covers threshold-based visibility, but there's still no push (Slack/Discord/email) on settled payments — in particular no way to get pinged the moment the first-ever transaction from a new channel or unseen wallet lands without having the dashboard open. Still the next real gap once the dashboard itself is deployed.

**Observability — decided 2026-07-15: not adopting Datadog right now.**
- Evaluated Datadog for infra/log aggregation, usage/payment visibility, and API uptime. Estimated real cost for the current footprint (2 Railway hosts, low beta traffic): ~$30-60/mo for Infrastructure Monitoring + log indexing alone; ~$100-130/mo once APM is added, which is the piece that actually does cross-service request tracing (the "find where the problem is" capability) rather than just host-level graphs.
- **Why deferred:** directly conflicts with the no-new-spend stance already applied twice this week to Cloudflare WAF ($20/mo) and Railway Hobby ($5/mo) — a Datadog tier that does real tracing costs more than both combined. Most of the underlying need is already covered at $0 incremental cost: Sentry is already wired for errors, and the local-only `apps/ops` dashboard (built in this same Housekeeping pass, see above) already aggregates provider health, usage, x402 payment status, and MCP tool calls — deploying it likely closes more of this gap than Datadog would.
- **Revisit when:** running enough services/instances that correlating logs and traces by hand across them gets genuinely painful — i.e. past the "harden before scaling" line already flagged elsewhere in this doc, not before.

**Next steps, not yet started:**
- [ ] Confirm an uptime monitor actually exists — UptimeRobot or Better Stack (free tier), checks on `api.lmxcloud.io`, `mcp.lmxcloud.io`, and the dashboard. Open since Distribution Sprint 1, still unconfirmed.
- [ ] Confirm Sentry is live in production, not just initialized — trigger a test error and verify it lands.
- [ ] Deploy `apps/ops` (Vercel config already exists in the app) so the ops dashboard is the actual first place to look when something breaks, not a local-only tool.
- [ ] Saved SQL queries against `payment_events`/`usage_events` for common failure modes (stuck/pending payments, error-rate spikes per provider) as a lighter-weight complement to the dashboard.

## Phase 2 — settlement + proof layer for the agent economy (revised 2026-07-11)

**What LMX Cloud is, directionally — the operating thesis this section builds from:** LMX Cloud is the settlement and proof layer for the agent economy — infrastructure that lets an autonomous agent with no human, no legal entity, and no corporate card discover a resource, pay for it per-call in stablecoin, and cryptographically prove it was delivered. Two layers, different competitive position each:

- **Execution layer** (the "AWS" surface) — resource-agnostic routing via the `ProviderAdapter` pattern (`apps/api/src/providers/`): compute (io.net/Akash, done), storage (Filecoin/Arweave, Goal 1 below), and eventually third-party/agent-authored functions (Goal 2 below).
- **Trust layer** (what's actually defensible) — settlement (x402 per-call payment) + proof (Merkle-anchored delivery receipts, Web3-2). Payment alone is not a moat — Coinbase's CDP Facilitator already owns that and LMX builds on top of it (`docs/x402-verification.md`). Discovery alone is not a moat — Coinbase's real CDP Bazaar already has the liquidity (165M+ cumulative x402 transactions, 480K+ agents, ~$50M+ volume as of April 2026, per Chainalysis / x402 Inc. reporting). **Proof of delivery is the wedge** — cryptographic evidence a specific call was fulfilled as specified, independently checkable. Nobody else surveyed in this space has built that layer.

**Correction for the record (2026-07-11):** `x402bazaar.org` is *not* Coinbase's product — it's an independent, single-operator clone (GitHub user "Wintyx57") built on the open x402 protocol, near-zero traction observed (0 txns on its SKALE listing). Don't confuse it with the real CDP Bazaar discovery layer LMX lists on in Sprint 4. Its existence is still a useful data point: a bare directory + payment wrapper is trivially cloneable by one person in a weekend, which confirms neither layer alone is a moat and reinforces that verified delivery is the differentiated one.

**Explicit non-goals, restated so this doesn't drift again:** LMX does not compete with Bazaar as a directory. LMX does not compete with CDP Facilitator on payment verification. LMX does not claim to verify the *correctness* or quality of a third party's function output — only that the call happened and the response matched what was declared, hashed and timestamped, anchored on-chain. That precision matters for Week 3 legal: "verified delivery" is a defensible claim; "verified correct" is liability exposure for someone else's function that LMX shouldn't take on.

**Sequencing note, reaffirmed:** Phase 2 doesn't start until Phase 1's payment flow is fully live (Sprint 3 mainnet flip + Sprint 4 Bazaar listing). AWS's own history backs extra caution specifically on datasets — AWS Marketplace shipped in 2012, Lambda in 2014, but AWS Data Exchange (a dataset marketplace) didn't ship until 2019, thirteen years after launch, once the trust/billing/identity layer was completely proven out. Datasets stay explicitly out of scope for the same reason: no verification/anti-redistribution model exists yet for "prove a dataset was delivered without also enabling it to be copied and resold."

### Phase 2 Goal 0 — Compute-layer reliability depth (sequenced first, decided 2026-07-17)

**Why this goes before storage/marketplace, reversing the original 2026-07-11 sequencing:** the trust-layer thesis above ("proof of delivery is the wedge") is only as credible as the data behind it, and right now there is none — receipts prove a call happened, not that LMX's routing is actually more reliable than going direct to a single DePIN network. Widening into storage and a third-party marketplace multiplies surface area before that core claim is proven. This goal proves it, on the one resource type (compute) where LMX already has real payment volume and two live providers (io.net, Akash), before spending effort elsewhere. Agent-first distribution (Phase 1) stays the near-term focus — this is about deepening the compute layer under that same agent-facing product, not pivoting to enterprise.

**Competitive framing:** io.net's own IO Intelligence product is a free, single-network inference API — same shape as LMX's compute layer, minus the aggregation. LMX's differentiation isn't "decentralized compute" (io.net already owns that claim at scale — 30,000+ GPUs). It's being the neutral, multi-network router no single-network provider can credibly claim to be, proven with measured reliability data, not asserted.

**Scope:**
1. **Add 2-4 more DePIN compute networks** beyond io.net/Akash (candidates to evaluate: Aethir, Render, Nosana, Golem) via the existing `ProviderAdapter` pattern (`apps/api/src/providers/`) — deliberately cheap, no new architecture needed, same pattern already proven twice.
2. **Per-network telemetry, built generically (decided 2026-07-17).** Uptime, latency, and price tracked per provider per model over time, not just point-in-time health checks. Extends the existing `usage_events`/receipt infrastructure rather than replacing it. **Must be built resource-type-agnostic, not hardcoded to compute** — the whole point of doing this before Goal 0b (resource breadth, below) is that embeddings/vision/image-gen inherit the same measurement automatically when they land, instead of needing telemetry retrofitted onto each one after the fact.
   - **Status: DONE, shipped 2026-07-18.** Wired through the existing `usage_events` path, not a parallel system — new columns `resource_type`, `success`, `error_code`, `unit_price`. `InferenceRouter` auto-records every failed provider attempt (latency, price, error code) with no extra wiring per adapter; routes call `recordProviderSuccess()` once final tokens/cost are known (streaming-safe). Confirmed resource-type-agnostic: adding a new resource type later is just routing through a router that records failures the same way and calling `recordProviderSuccess(..., { resourceType: "embeddings" })` — no schema changes. Read paths live: `GET /v1/ops/reliability?days=7&resource_type=chat` (full series + per-provider aggregates), included on `GET /v1/ops/overview`, and a compact snapshot on `GET /v1/status` feeding a new Reliability record card on `StatusPage.tsx`. Typecheck clean across api/web/ops; migrations run on next API boot.
3. **Failure-independence measurement** — confirm networks actually fail independently (different chains, different node-operator bases) before claiming aggregation improves reliability. If failures turn out correlated, that's a real finding, not a reason to hide the data. **Blocked on item 1** — telemetry is live but still only measuring io.net + Akash; not enough independent networks yet to say anything about correlation.
4. **Publish a reliability record** — turn the Merkle-anchored receipts from a payment-audit trail into a public, provable reliability claim (e.g. "99.9% effective uptime across N networks vs. X% for any single network, measured over Y months"), surfaced on `StatusPage.tsx` alongside the existing anchoring data. **Plumbing done, claim not provable yet** — the Reliability record card is live on `StatusPage.tsx` from item 2's ship, but with only 2 providers and no real time-series depth yet, there's nothing worth publishing as a comparison claim until item 1 (more networks) lands and data accumulates.
5. **Routing policy layer** — let a caller express a preference (cheapest, fastest, most reliable, specific model family) instead of LMX's routing being an opaque black box; show what was chosen and why, backed by the receipt/telemetry data above. This is the productized version of "neutral router," not a new architectural layer — same `ProviderAdapter` routing decision, just exposed and made configurable per-request.

**Definition of done:** LMX Cloud can publish a real, measured reliability comparison (multi-network vs. single-network) backed by its own telemetry, and a caller can express a routing preference and see which provider was actually used, with proof.

**Open questions, unresolved:** how many additional networks is enough to prove independence without adding operational overhead disproportionate to the beta's traffic; whether the routing-policy layer belongs in the existing chat completions route or as a separate opt-in parameter.

### Phase 2 Goal 0b — Resource-type breadth on the MCP server (sequenced right after Goal 0, decided 2026-07-17)

**Why this comes second, not first, and not combined with Goal 0:** widening what LMX sells (embeddings, vision, image generation, search) is the more reliable near-term demand lever — every agent builder needs these regardless of vertical, versus the narrower, harder-to-predict demand for any single third-party marketplace listing (Goal 2). But it only comes *after* Goal 0's telemetry is live and built generically, so every new resource type is measured from day one instead of shipping unmeasured and needing retrofit later.

**Build order, revised 2026-07-18 after verifying actual model catalogs (the "likely already served" assumption was wrong):**
1. **Vision/document input on `chat_completion`, now first. Status: DONE, shipped 2026-07-18.** Not a new tool, a capability extension on the existing one — `POST /v1/chat/completions` accepts OpenAI-shaped vision content (`{ type: "image_url", image_url: { url } }` parts, https or base64 data URLs). Vision models flagged in the catalog (`llama-3.2-90b-vision`, `qwen-3.6-35b`, `qwen-3.5-35b`); clear 400 if images are sent to a text-only model. MCP `chat_completion` tool extended with the same capability. No provider adapter changes needed. Telemetry confirmed auto-covered — vision calls still record as `RESOURCE_TYPE_CHAT`, no extra wiring. Live integration test (`pnpm --filter @lmxcloud/api test:vision`) passed on `qwen-3.6-35b` via io.net; note `llama-3.2-90b-vision` accepts text but currently 404s on multimodal `image_url` upstream.
2. **`create_embedding` — parked, not building yet (2026-07-18).** Verified against both providers' live model lists: io.net's `GET /api/v1/models` returns 29 models, all `output_modalities: text` only, zero embedding families (BGE/Nomic/E5/GTE/Stella) — their docs still reference `BAAI/bge-multilingual-gemma2` and an `enable_api_embeddings` flag, but that model isn't in the live catalog; looks like a removed SKU, stale docs, not current inventory. Akash's live catalog (5 models) and `openapi.json` confirm the same — no embeddings route, no embedding models. Neither active provider offers this today. Options on hold: wait for one of the two to ship embedding support, or bring in a separate provider/self-host specifically for this — deliberately not chasing either today given the pattern of friction hit across Nosana/Aethir/Render/Golem this same session. Revisit once there's a specific reason to prioritize it again.
3. **`generate_image` — parked, not building yet (2026-07-18).** Verified live against both providers, same rigor as embeddings: io.net's 29-model catalog is `output_modalities: text` only, zero FLUX/Stable Diffusion/SDXL hits, and `POST /v1/images/generations` returns a plain 404 (no images API at all). Akash's catalog is the same, but with one extra wrinkle worth remembering — their OpenAPI spec *does* list `/v1/images/generations` and `/v1/images/edits` and their docs cite `black-forest-labs/FLUX.1-schnell` as an example, but live calls to both `FLUX.1-schnell` and `SDXL` return `404 model_not_found: "not available for this integration"`. The route is scaffolded but empty — a subtler trap than a clean absence, since the OpenAPI schema alone would've said yes. Same options on hold as embeddings: wait for a real image-gen SKU to ship on either provider, or bring in a separate provider later. Not chasing either today.
4. **`web_search` — SHIPPED 2026-07-18.** Real-time lookup via **Brave Search** passthrough (`POST /v1/web/search` + MCP `web_search`). Picked Brave over Tavily for flat ~$0.005/req wholesale + 50 RPS (cleaner per-call metering than Tavily credit tiers). LMX list price `WEB_SEARCH_PRICE_USDC` default $0.01. Balance-path billing + usage/receipt; x402 deferred. **Telemetry:** records `resource_type=web_search` success/failure in-route (not via InferenceRouter); deliberately **out of** the DePIN multi-network reliability claim — see `docs/web-search.md`.

**Net result of this pass:** of the original four, one shipped earlier (vision), one shipped this session (`web_search` via Brave), two remain blocked on provider capability (embeddings, image-gen — both confirmed absent via live calls). io.net and Akash are chat/vision-only providers today; widening beyond that needs either those providers shipping new SKUs or a new provider relationship — a slower, separate track from this sprint.

**Explicitly deferred from this pass:** `memory_store`/`memory_query` (persistent vector storage/retrieval) — the natural pairing with embeddings, but stateful rather than "just another model type" on existing infra, so it's a heavier build that converges with Goal 1 (storage routing) rather than belonging in this lighter-weight tool-breadth pass.

**Definition of done, revised to match what actually shipped (2026-07-18):** originally scoped as 4 new tools (11 total, up from 7). Actual result: vision shipped as a capability extension on `chat_completion` (no new tool count), `web_search` shipped as one genuinely new tool (8 total, up from 7), embeddings and image-gen parked on provider capability. Both shipped capabilities priced and receipted; only `chat_completion`/vision rides the DePIN reliability telemetry, `web_search` is tracked separately and explicitly excluded from the multi-network reliability claim since Brave is a single centralized vendor, not a DePIN network.

**Open item, not yet decided:** `web_search` shipped balance-path billing only, x402 pay-per-call deferred. Worth a conscious call, not a silent gap — the core product thesis is zero-prior-relationship agent access (no signup, no pre-funded balance), and an agent with no LMX balance can't use this tool yet, which cuts against that positioning even if reasonable to defer for a v1 ship. Revisit before treating `web_search` as fully aligned with the rest of the agent-native surface.

### Phase 2 Goal 1 — Storage routing (the "S3" of LMX)

**Sequencing: after Goal 0, not concurrent with it.** Storage widens the resource surface; it shouldn't compete for attention with proving the reliability claim above.

Route agent requests for storage/memory (files, logs, embeddings) to decentralized storage networks (e.g. Filecoin, Arweave) the same way inference requests already route to io.net/Akash — same `ProviderAdapter` pattern, same per-call x402 pricing/verification, same receipt/Merkle anchoring for proof of delivery.

**Definition of done:** an agent can pay per-call (or per-byte/per-period) to store and retrieve data through LMX Cloud, routed to at least one decentralized storage network, with a verifiable receipt the same way inference calls get one today.

### Phase 2 Goal 2 — Callable function registry (Marketplace + Lambda, merged 2026-07-11)

**Sequencing: last of the three Phase 2 goals.** Definition pass done 2026-07-17, informed by the closest real precedent: Virtuals Protocol's Agent Commerce Protocol (ACP) — self-serve agent listing, escrow-based settlement, ~18,000 agents live. ACP's structure includes a formal **Evaluator** role: payment sits in escrow until a third-party evaluator agent verifies delivered work against a signed agreement — a real quality market, not just a delivery receipt. That's a genuine fork for LMX, not a detail: a richer trust product with real liability surface (ACP's model) versus the thin, legally clean delivery-proof LMX already committed to elsewhere in this doc ("verified delivery" is defensible; "verified correct" is liability exposure). **Decision: stay with the thin model for the MVP** — consistent with the lean, no-new-liability posture already established — but don't treat quality-evaluation as ruled out permanently; revisit once there's real marketplace volume, same as the deferred reputation/trust-scoring line below.

**Definition, answering the four open questions:**

1. **What's sellable (MVP-narrow):** only functions wrapping resources LMX itself routes and can observe — compute via `ProviderAdapter` (live) and storage once Goal 1 ships. Pure third-party webhooks are explicitly out of the MVP: LMX has zero visibility into what a third party's own backend actually did, so the receipt guarantee for those is closest to worthless of anything on this list. Not ruled out forever — just not at launch.
2. **Who can list:** the existing plan holds — Web3-1 wallet self-mint pattern, no human review, gated by the synthetic test-call check plus a refundable USDC bond sized high enough that spam-listing costs more than LMX's own verification overhead.
3. **What LMX guarantees, per tier (new — resolves the "is a thin guarantee sellable" question):** two explicit, differently-labeled tiers rather than one uniform claim. **"LMX-routed"** listings (compute/storage LMX executes directly) get the strong guarantee — LMX can attest routing, provider used, latency, and delivery. **"Third-party webhook"** listings (post-MVP, see above) get the thin guarantee only — a call was made, this exact response came back, hashed and timestamped, nothing about backend truth. Labeling this honestly in the registry UI, rather than presenting both identically, is what makes the thin tier still sellable instead of misleading.
4. **In-registry discovery vs. Bazaar:** the differentiator is integration friction, not reach. Bazaar requires an agent to speak x402 fresh to every new provider it discovers, protocol-wide. A function listed in LMX's own registry is callable through the same MCP surface and wallet/session an agent already has open with LMX — a "zero new integration" advantage for anything already inside LMX's ecosystem that Bazaar's broader-but-shallower reach can't offer.

**Revised framing:** originally scoped as two separate goals — "open the rails to other sellers" (Marketplace) and "widen job types routed" (the "Lambda" of LMX, see retired Goal 3 below). Collapsing these: a listed marketplace seller and a callable function are the same object once distribution runs through the MCP server. The MCP server (Phase 1 Goal 2, v1 shipped 2026-07-09) stops being "LMX's own 7 tools" and becomes a registry — any wallet-verified provider, including an agent itself, registers a function (manifest: description, input/output schema, price, endpoint), and any MCP-compatible agent discovers and calls it the same way it calls LMX's built-in tools today.

**Agents as first-class citizens, applied concretely:** the registrant doesn't have to be a company. This reuses the Web3-1 self-mint pattern (wallet-signed, no human review) — an agent good at some task can list its own skill and sell it to other agents. That's the differentiated end-state; every comparable product surveyed (CDP Bazaar, x402bazaar.org, RelAI) assumes sellers are companies and agents are only buyers.

**Anti-abuse, mechanical gates only, no human curation:** (1) a synthetic test call LMX makes once at registration to confirm the function responds and matches its declared schema before going live; (2) a small refundable USDC bond, slashed on verified bad behavior (schema mismatch, receipt anomalies, buyer disputes). Consistent with wallet-native self-serve onboarding — avoids reintroducing a human review bottleneck.

**Open technical question, unresolved:** for a function backed by a third party's own webhook (not LMX-routed compute), what can the receipt actually attest? LMX only sees what the provider chooses to return — the receipt can say "a call was made, this was the response, hashed and timestamped," nothing about the provider's backend. Whether that thin a guarantee is still a sellable trust signal is untested.

**Revenue model, open:** the old "LMX earns a cut of agent-originated revenue" assumed a marketplace take-rate on GMV. If LMX isn't routing the underlying resource — just settling and receipting a third party's call — a flat or usage-based infra fee (pricing the receipt/anchoring service itself) may be the more honest model. Decide before sizing Goal 2 revenue projections.

**Scope correction:** this is a bigger product commitment than Distribution Sprint 5's current sizing ("ship 7 tools, wire x402, get in registry"). "MCP is the flagship product" implies an ongoing surface — seller/listing dashboard, an in-MCP discovery tool (agents need to search LMX's own registry, not just Bazaar's), health monitoring on every listed function, a delisting/dispute flow. Not a sprint; a product line. Needs an explicit resourcing decision, not folded silently into Sprint 5/6 as currently scoped.

**Definition of done (revised):** a wallet-verified provider — human-operated or agent-operated — can register a function with a price and schema through LMX's MCP registry; any MCP-compatible agent can discover and call it through LMX's existing MCP surface; LMX settles payment (x402) and issues a delivery receipt, without vetting the function's output quality.

### Phase 2 Goal 3 — retired, folded into Goal 0b (correction 2026-07-17, originally folded into Goal 2 on 2026-07-11)

Previously "widen job types routed (the Lambda of LMX)." Originally merged into Goal 2 as "just another function in the registry." **Corrected:** LMX-operated job types (embeddings, vision, image generation) are Goal 0b — native MCP tools LMX itself executes, same as `chat_completion` — not third-party marketplace listings. Only genuinely third-party-authored functions belong in Goal 2's registry.

### Phase 2 sprint plan (resequenced 2026-07-17 — reliability depth, then resource breadth, then storage/marketplace; not yet scoped for real execution; Phase 1 must close first)

- **Platform Sprint 0 — Compute reliability depth (Goal 0).** 2-4 new DePIN compute providers via `ProviderAdapter`, per-network telemetry built resource-type-agnostic, failure-independence check, published reliability record, routing policy layer.
- **Platform Sprint 0b — Resource-type breadth (Goal 0b).** Vision on `chat_completion` and `web_search` (Brave) shipped 2026-07-18; `create_embedding` / `generate_image` parked on provider SKUs.
- **Platform Sprint 1 — Storage routing (Goal 1).** Filecoin/Arweave adapter, same x402 + receipt pattern as compute; also the eventual home for `memory_store`/`memory_query` deferred from Goal 0b.
- **Platform Sprint 2 — Function marketplace definition (Goal 2, scoping only).** Answer the open definition questions above (what's sellable, listing bar, guarantee tiers, in-registry discovery) before any build work — output is a spec, not code.
- **Platform Sprint 3 — MCP registry foundations.** Manifest schema (description, input/output schema, price, endpoint), wallet-signed self-registration reusing the Web3-1 mint pattern, synthetic test-call gate.
- **Platform Sprint 4 — Trust mechanics.** Refundable USDC bond + slashing logic, resolve the third-party/webhook receipt guarantee question above, delisting/dispute flow.
- **Platform Sprint 5 — Seller product surface.** Listing/seller dashboard, in-MCP discovery tool, health monitoring on listed functions.
- **Platform Sprint 6 — Agent-as-seller pilot.** Get one real agent-authored function listed and transacted end-to-end as proof of the "agents as first-class citizens" thesis, before opening broadly.

Open questions carried forward into scoping: revenue model (take-rate vs. infra fee), whether the unresolved receipt-guarantee question blocks webhook-backed listings entirely, whether the mechanical-only review gate holds up at real abuse volume, and the function-marketplace definition questions raised in Goal 2 above.

**Explicitly not Phase 2:** dataset marketplace — deferred per the AWS Data Exchange sequencing note above, no verification/anti-redistribution model exists yet. Reputation/trust-scoring products (e.g. feeding receipts into ERC-8004 or similar emerging standards) — revisit once Phase 2 has real multi-resource transaction volume to make that data meaningful (note: the reliability record in Goal 0 is a narrower, near-term version of this, scoped to routing quality rather than general reputation). Treasury/spend-policy management for agents — adjacent territory already being built by others (PolicyLayer, Eco, AWS Bedrock AgentCore); not a near-term fit unless narrowly scoped to cross-provider compute/storage spend specifically.

### Demand generation (parallel track across all of Phase 2, decided 2026-07-17)

**Why this is its own track, not a Phase 2 goal in sequence:** all of the above (reliability depth, storage, marketplace) is supply-side and product-side work — it makes LMX Cloud better, not used. Phase 1 already built three discovery surfaces (x402 Bazaar/Agentic.Market, MCP registry, ElizaOS plugin) but distribution being *live* isn't the same as agents actually routing meaningful traffic through them. This runs simultaneously alongside Platform Sprints 0-6 above, not after them — waiting until the product is "done" to start driving demand repeats the mistake of treating distribution as a final step instead of a continuous one.

**Channel priority, decided 2026-07-17: Bazaar/Agentic.Market and MCP first, ElizaOS stays secondary** until its live-agent test (Distribution Sprint 6) actually finishes — pushing traffic at an unvalidated integration is wasted effort.

**How Bazaar/Agentic.Market discovery actually works (researched 2026-07-17, changes the tactics):** CDP's discovery layer ranks via hybrid text+semantic search plus a quality signal, and Agentic.Market (the human-facing directory on top of Bazaar, ~70 curated listings) surfaces live per-listing metrics — total calls, unique payers, last-active. Two concrete implications: (1) the `declareDiscoveryExtension()` description on `POST /v1/chat/completions` is functioning as real marketing copy inside semantic search, not boilerplate — worth a deliberate rewrite/review, not the placeholder text from Sprint 4; (2) real usage volume directly improves ranking and visible credibility, so even a small amount of seeded real traffic is disproportionately valuable right now versus waiting for organic discovery. Unresolved: whether LMX's listing is in Agentic.Market's curated ~70 or only indexed in the raw Bazaar catalog — needs checking, and if not curated, may need direct outreach to Coinbase/CDP developer relations rather than assuming inclusion is automatic.

**How MCP discovery actually works (researched 2026-07-17):** the official registry (`registry.modelcontextprotocol.io`) has grown to nearly 2,000 servers and is a flat metaregistry with no popularity ranking — clients query by capability, nothing surfaces LMX over any other listed server. Being in it is necessary, not sufficient. Real discovery increasingly routes through secondary curated layers on top: GitHub's own MCP registry (launched Sept 2025) and community aggregators like PulseMCP that rank by popularity/reviews. **Action item:** confirm whether `io.lmxcloud/mcp-server` is listed in GitHub's registry and PulseMCP; if not, getting into those curated layers is likely higher-leverage than anything else on the MCP side, since the official registry alone doesn't drive discovery.

**Concrete near-term tactics, both channels:**
1. Seed real usage deliberately rather than waiting for organic traffic — a handful of real paid calls from known agent-builder contacts moves both Bazaar's visible metrics and MCP's credibility (repeats what already worked once: the 2026-07-16 "one real stranger walkthrough" via Claude Code surfaced two production bugs no internal testing caught — direct outreach to specific developer communities is a proven channel, not a hypothesis).
2. Rewrite the Bazaar discovery description as real copy, informed by what semantic search actually matches against.
3. Verify and, if needed, pursue inclusion in Agentic.Market's curated set and MCP's secondary discovery layers (GitHub registry, PulseMCP) rather than assuming the two "official" listings (Bazaar catalog, official MCP registry) are sufficient on their own.
4. Once Goal 0's reliability record exists, treat it as demand-generation material, not just an internal proof point — a published multi-network reliability comparison is exactly the kind of credibility signal that plays well in both a Bazaar/Agentic.Market description and direct outreach to agent-framework developers.

**Still open:** what "real demand" means as a measurable target (distinct paying wallets/agents per week, not raw call volume); whether outreach targets human developers who deploy agents, or autonomous-agent operators directly.

## Deliberately deferred (not blocking beta)

- Real payments/Stripe billing — free beta means the dev credit top-up is fine for now.
- Wallet/crypto-native auth beyond the existing `wallet` field.
- SDKs beyond raw HTTP — a docs quickstart is enough until there's demand.
- Multi-region/high-availability infra — a single Railway deployment is fine at beta scale.

## Suggested order if the timeline compresses

If 3-4 weeks becomes 1-2: do the login fix, the real deploy with Postgres, and basic monitoring — then go straight to a small private dry run. Docs, streaming, and model coverage matter for *growth* but won't stop a handful of trusted early users from getting real signal.
