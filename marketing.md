# LMX Cloud — Demand Generation Plan

Drafted 2026-07-19. Built from what's already true and already decided in `ROADMAP.md` — positioning, distribution channels, and the POM gates — not a generic launch playbook.

## Gate before anything goes wide

`ROADMAP.md`'s own POM section lists attorney review of the Week 3 legal drafts (ToS, privacy, acceptable-use) as a hard blocker for responsibly marketing any of the three Phase 1 channels, deferred multiple times already. Marketing specifically means deliberately inviting strangers' agents to transact real stablecoin with zero prior relationship — the exact exposure that gate exists for. This plan is safe to build and queue now; the "go wide" phase (private dry run onward) should wait for that to close, or for an explicit call from John to proceed without it.

## Positioning — already decided, restated for marketing use

"AWS for Web3" as the outward pitch, but the defensible claim underneath is narrower and should lead the actual copy: LMX is the neutral, multi-network DePIN router, proven with measured reliability data rather than asserted. The wedge isn't "decentralization" as a general pitch — it's that hyperscalers and centralized neoclouds have no margin incentive to route to decentralized supply, and DAOs/autonomous agents structurally can't use hyperscaler billing (no legal entity, no corporate card). Lead with the second point for agent-facing channels, the first for human-developer channels.

**New asset once it matures:** the persisted provider health history (shipped 2026-07-19) turns into a real content hook once there's enough time-series depth across 3+ networks — "measured X% uptime across N independent DePIN networks vs Y% for any single network," backed by the same data feeding the status page. Not usable as a marketing claim yet (2 providers, ~1 week of data); becomes one of the strongest differentiators once Aethir lands and the Goal 0 independence measurement has real weeks behind it. Flag this as a scheduled follow-up, not a launch-day asset.

## Channel plan — the three already-committed Phase 1 channels, sequenced by actual readiness

### 1. x402 Bazaar — closest to ready, but it isn't a "post and wait" channel

Confirmed via CDP's own docs: there's no manual listing step. The Facilitator catalogs a service automatically the first time it settles a real payment where discovery metadata (`declareDiscoveryExtension`) was declared on the route. Agents find sellers through semantic search over that declared metadata, not a submitted profile. Source: [CDP Bazaar docs](https://docs.cdp.coinbase.com/x402/bazaar).

**What this means for demand generation, specifically:**
- Audit the discovery metadata on `POST /v1/chat/completions` — the semantic description is effectively the SEO copy for agent discovery. Worth a deliberate pass once legal clears, written for what an agent's search query actually looks like ("cheap chat completion," "DePIN inference," "pay-per-call LLM"), not human marketing copy.
- The catalog entry needs real settled transactions to have signal — the private dry run (below) also serves as "priming" the Bazaar listing, not just a bug hunt.

### 2. MCP — infrastructure ready, this is a content/case-study channel more than a discovery one

Server, 8 tools, dual-path payments, and the official registry listing already shipped. The genuine asset here is the "real stranger walkthrough" that already happened (2026-07-16) and surfaced two real production bugs — that's a legitimate, honest case study: "an independent user connected, broke things we hadn't caught ourselves, we fixed them same day." That story is better outreach content than generic feature copy, and it's already true. Use it once ready to post publicly.

### 3. ElizaOS — furthest behind, sequence last as already decided

Plugin published to npm, registry PR open awaiting community review. Discovery here runs through GitHub topics (`elizaos-plugins` tag) and the community plugin registry, not paid/outbound marketing. Source: [ElizaOS plugin registry](https://github.com/elizaos-plugins/registry). **Action:** push on getting the registry PR reviewed/merged — that's the actual blocker, not a content or channel problem. Add professional README assets (logo, screenshots) per ecosystem convention once the live ElizaOS agent test (still not started) closes.

## Broader awareness channels — from the existing Week 4 outreach plan, unchanged, sequenced after the above

r/LocalLLaMA, Indie Hackers, AI-dev Discord/Twitter circles, and io.net/Akash community channels (they have a direct interest in a router that showcases their networks — worth reaching out to them specifically as partners, not just posting cold). Landing copy should lead with the DePIN cost/resilience story and "OpenAI-compatible, drop-in swap" — both already decided in ROADMAP.md's Week 4 section.

## Sequencing

1. **Now:** discovery-metadata audit for Bazaar, ElizaOS registry PR push, case-study writeup of the MCP stranger walkthrough. None of this is "marketing" in the outbound sense — it's readiness work.
2. **Gate:** attorney review closes (or John explicitly overrides).
3. **Private dry run:** 2-3 friendly technical testers on the deployed version — per the existing Week 4 plan, this catches login/rate-limit/error-state issues cheaply and also primes the Bazaar catalog with real transactions.
4. **Public push, phased:** Bazaar + MCP first (infra readiest), ElizaOS once its registry PR and live-agent test close, broader channels (Reddit/Indie Hackers/Discord) once the above are live and stable.
5. **Content layer, later:** the reliability-comparison claim, once Aethir's live and independence data has real weeks behind it — genuinely differentiated content no competitor can currently make.

## Demand bootstrapping — concrete tactics, not just discoverability

**Honest context first:** a March 2026 Coindesk piece on x402 itself is headlined "demand is just not there yet" for the protocol broadly — 119M+ cumulative transactions and $35M+ volume sound large, but that's aggregate across the whole ecosystem, not evidence any given new listing gets organic traffic. Source: [Coindesk — x402 demand piece](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet). This matters directly: being listed and discoverable on Bazaar is necessary but not sufficient — it won't generate transactions by itself. The real lever is deliberate, manual seeding, not passive discovery-layer optimization. Below is what that actually looks like.

### Bootstrapping real Bazaar transactions

1. **Prime the catalog with real, disclosed usage — not synthetic/wash volume.** Bazaar's ranking is driven by real settled transactions against the declared discovery metadata. The private dry-run testers (already planned) are the first legitimate source of this — frame their onboarding explicitly as "help us prime the Bazaar listing," not just bug-hunting.
2. **Target Coinbase's own hackathon pipeline directly.** CDP runs recurring x402/AgentKit hackathons (e.g. "Agents in Action") where builders specifically need cheap, pay-per-call infrastructure for their agent projects during the event. Source: [Coinbase — Agents in Action winners](https://www.coinbase.com/developer-platform/discover/launches/agents-in-action-winners). Action: check for the next scheduled one, reach out to CDP devrel or post directly in the hackathon's builder channel offering free starter credits to any team that routes inference through LMX — this is a concentrated pool of builders who need exactly what you have, actively building during a fixed window, which is a much higher-conversion target than cold outreach.
3. **Direct 1:1 credit grants to specific known agent builders**, not broad giveaways — identify real agent projects (ElizaOS community devs, AgentKit hackathon alumni, indie builders posting publicly about inference costs) and offer them free starter credits specifically to route through LMX. Small scale, high conversion, and each one is a real settled transaction feeding the catalog.
4. **Get listed on `awesome-x402`** (community-curated GitHub list, [xpaysh/awesome-x402](https://github.com/xpaysh/awesome-x402)) alongside the Bazaar catalog presence — low effort, real developer eyeballs beyond Bazaar's own discovery surface.

### MCP campaign — concrete channels beyond the official registry

The official `registry.modelcontextprotocol.io` listing already shipped, but it's one of several real discovery surfaces developers actually use:

- **PulseMCP** — the largest hand-reviewed MCP directory, daily updated. [pulsemcp.com/servers](https://www.pulsemcp.com/servers)
- **Glama** and **MCP.so** — broadest automated coverage.
- **Smithery** — another actively used discovery platform.
- **mcpservers.org** — mirrors the `awesome-mcp-servers` curated list, 450+ servers.

Submitting to these individually is low-cost, high-signal — each funnels real developer discovery traffic the official registry alone doesn't reach. Beyond listings:

- **Turn the "stranger walkthrough" bug story into real content** — post it to Hacker News, r/LocalLLaMA, MCP-focused X/Twitter accounts, relevant Discords. Honest "here's what broke on first real contact, here's how fast we fixed it" narrative content converts better with developer audiences than feature-list copy, and it's a true story you already have.
- **Referral loop** — free starter credits to both the referrer and the new connection when someone brings another builder to LMX via MCP. Cheap to implement given wallet-based crediting already exists, and it's a proven low-cost demand lever for exactly this kind of developer-tool adoption.
- **Direct outreach**, same as Bazaar — find specific builders publicly complaining about inference costs and DM them directly rather than posting and waiting.

## Heurist case study — what actually drove their first traffic (added 2026-07-26)

Two eras, worth being honest about both since only one is replicable here.

**Era 1 (2024, pre-Mesh): crypto-native community-growth mechanics.** Incentivized testnet with a points system, Web3 quest platforms (Zealy, then Intract) rewarding task completion with points/whitelist access, an Ambassador Program, conference-booth presence, NFT drops tied to participation. Built an engaged, self-promoting community before there was a real product to sell — but ran almost entirely on token/points speculation. **Not directly replicable for LMX** — depends on the exact token-incentive mechanic already deferred in `ROADMAP.md` (native token held until legal clears and demand is proven, explicitly to avoid the "mercenary capital" trap).

**Era 2 (2025 onward, once Mesh existed): ecosystem partnerships, not enterprise sales.** Dozens of "Heurist x [Partner]" integrations, each simultaneously a product addition and a co-marketing event riding on the partner's own audience — mostly peer infra/AI projects integrating laterally, not traditional enterprise clients. The closest real anchor-client story is recent and singular: FasterClaude, a real external product, now runs on Heurist's payment rail as a dependency, publicized as a case study — took about two years to produce one of those.

**What this means for LMX:** marketplace listing (Bazaar/Agentic Market) was never Heurist's top-of-funnel — it's a distribution layer on top of traffic already generated elsewhere. This directly reinforces the Coindesk finding already in this doc ("demand is just not there yet" for x402 broadly): a listing without pre-seeded usage won't generate its own traffic.

**Sequencing correction:** direct outreach and custom-built integrations for a small number of specific targets should run before or alongside the broad marketplace push, not strictly after. Find 3-5 specific targets, build them something real, get a public "X runs on LMX" integration out of it (the FasterClaude pattern), and treat each as a genuine partnership with its own announcement — same spirit as the already-planned direct 1:1 credit grants and hackathon targeting above, just extended past the initial dry-run phase. Once 2-3 of those exist, the broad Agentic Market push has real usage/credibility behind it instead of a listing with zero signal.

**Partnership target categories** (deliberately not the same list Heurist already has — see positioning note below): other agent-framework builders in ecosystems adjacent to LMX (ElizaOS plugin developers, MCP-client tool builders) who need cheap, verifiable, wallet-native compute or data tools as a component of their own product; small DePIN/Web3-native startups who need inference/data infra without running their own stack; once the registry opens, individual developers who list a tool — each one still a real partnership and its own piece of content (see `ROADMAP.md` Demand generation tactic #5).

**Self-registration model, confirmed 2026-07-26:** keep it Heurist-style — internally curated/reviewed by LMX, not open self-service — until listing would actually be profitable for a third-party author to justify opening it up. Full reasoning in `ROADMAP.md`'s Phase 2 north star section.

**Positioning vs. Heurist, in a few lines (for outreach copy and to resolve the "they already have these partners" concern):** LMX is the verifiable settlement layer for any autonomous agent's resource and tool use — compute, storage, third-party functions — proven by cryptographic delivery receipts, not curated market data. Heurist is a crypto-intelligence vertical plus a token economy layered on top of DePIN compute. Different axis, not a head-to-head: they compete on data-curation depth in one niche; LMX competes on provable trust across any niche. That's also the direct answer to the partnership-overlap worry — Heurist's partner list is crypto-data providers (CoinGecko/DexScreener/Zerion-type companies); LMX's target list is agent-framework builders and infra projects that need provable execution, which barely overlaps with theirs.

## Measurement

Reuse the already-decided approach rather than adding a new tool: a few saved SQL queries against `usage_events`/`payment_events` for signups → first key → first successful request → repeat usage, consistent with the no-new-spend precedent already set on Datadog. Add one funnel step specific to this plan: first Bazaar-discovered call vs. first direct-signup call, to see which channel is actually converting once both are live.

## Open question for John

Attorney review status — still open, or resolved since the last ROADMAP update? This determines whether step 2 above is "wait" or "already clear, proceed to dry run."
