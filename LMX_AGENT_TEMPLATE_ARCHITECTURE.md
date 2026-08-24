# LMX Agent Template — Architecture (Track A)

The reusable scaffold every `lmx.*` agent forks from — `lmx.voice`, `lmx.research`, `lmx.code`, and the rest of the candidates in `LMX_AGENTS.md`. Not a shared library agents import: per the established policy, every agent is its own standalone public repo, never bundled together. This template is the starter kit each one is cloned from — the same role `apps/tools/_template` plays for tools, one level up.

Fulfills ROADMAP.md → "LMX.Agent — open agent framework" (Track A, decided 2026-07-26): wallet-identified out of the box, calls LMX's MCP tools / pays via x402 with minimal setup. Demand-generation, not new product scope — confirmed 2026-08-11 to run in parallel with active outreach, not gated behind Grid-deepening.

## The hard rule this inherits

Same boundary as `TOOL_AND_AGENT_WORKFLOW.md`: an agent built from this template holds **zero tool implementation code, ever** — only tool URLs, its own LMX credentials, and orchestration/state logic. That boundary is what makes "open-source it, fork it, self-host it" safe. There's nothing to give away — the tool logic and whatever settlement gate sits in front of it live in `apps/tools/*`, never in an agent's repo.

## What's structurally hardwired, not a convention someone can strip

Every capability an agent has — reasoning, tool calls — is a metered Grid endpoint. An agent built from this template is inert without a working LMX credential: there's no local model, no offline fallback, no code path that produces output without going through Grid. That's the chokepoint, and it's structural rather than a settlement gate bolted on afterward — a forked tool needs an explicit hardwired gate to stay paid; a forked agent has no gate to remove, because it was never able to do anything on its own.

## The loop

```
INIT (load identity/credential)
   → RECEIVE (input: CLI arg, webhook, scheduled tick)
   → PLAN (optional — decide which tools, what order)
   → CALL TOOLS (0..n, by URL only)
   → CALL GRID (chat_completion — the actual reasoning/generation step)
   → ACT (side effect: publish, save, respond, trade)
   → PERSIST (state) ─┐
   ↑__________________┘  (next trigger / next stage)
```

A single-shot agent (`lmx.tutor` answering one question) collapses this to `RECEIVE → CALL GRID → ACT`. A stateful, cyclical one (`lmx.social`, `lmx.dev-ops`) uses the full loop, with `PERSIST` feeding back into the next cycle's `PLAN`. Same shape as the CMO Agent's six-stage state machine (`CMO_AGENT_ARCHITECTURE.md`) — that's the most complex real instance of this loop; this template is the general form it was already built from, pulled out so the next 14 agents in `LMX_AGENTS.md` don't each re-derive it.

## File tree

```
lmx-agent-template/
  src/
    identity.ts     — wallet-first auth: generate/load a local signing key, sign in (raw-keypair
                       path from Web3-1, same as the dashboard's SIWE flow minus the browser),
                       fall back to an instant demo API key for a zero-friction first run
    lmx-client.ts   — typed wrapper over Grid: chat completions, balance/usage, reads the
                       x-lmx-* response headers (provider/fallback/latency/cost/balance) —
                       same shape as apps/cli/src/api.ts, not reinvented
    settlement.ts   — x402 payment signing for outbound calls, reusing @x402/core + @x402/evm
                       client packages already proven in plugin-lmxcloud and test-x402-chat.ts
    tools.ts        — typed registry: { name, url, pricing/x402 metadata } per tool this agent
                       calls. URLs only — never a tool's source, per the hard rule above.
    state.ts        — minimal put/get/query interface per namespace, mirroring LMX Storage's
                       eventual shape (see CMO_AGENT_ARCHITECTURE.md's "Data Layer") — agents
                       build against this today on a local file/SQLite backend and swap the
                       backend later without a rewrite once Goal 1 ships
    agent.ts        — the loop above. The one file every fork actually rewrites.
    index.ts        — entrypoint: CLI arg, webhook handler, or scheduled tick — caller's choice,
                       the template doesn't force a hosting model
  .env.example      — LMX_API_KEY | LMX_WALLET_PRIVATE_KEY, LMX_API_URL, per-tool URL overrides
  package.json, tsconfig.json — same Node/TS conventions as apps/cli and apps/tools/_template
  README.md         — "fork this to build lmx.<name>" instructions + the non-negotiables above
```

## Identity, specifically — what "wallet-identified out of the box" means

Three tiers, ordered by friction, extending the CLI's existing `resolveAuth` pattern (`apps/cli/src/auth.ts`) with the wallet tier Track A actually asked for:

1. **Env var / demo key** — `LMX_API_KEY`, or instant generation via `POST /v1/auth/key`. Zero friction: an agent runs before anyone has thought about payment.
2. **Wallet** — `LMX_WALLET_PRIVATE_KEY`, the raw-keypair path already proven in Web3-1 (no browser required). This is the literal meaning of "wallet-identified out of the box": an agent can sign its own x402 payments and carry an on-chain identity without a human ever opening the dashboard.
3. **(Track B, gated)** — onchain identity/reputation persisting across calls, once Goal 2's registry has real transaction volume to make it meaningful. Not built into this template yet; `identity.ts` should leave the seam for it rather than assume it never arrives.

## Build sequence

**v0.** `identity.ts` (demo-key path only) + `lmx-client.ts` + one hardcoded tool call + `agent.ts` doing `RECEIVE → CALL GRID → ACT`. Prove one real agent end-to-end — cheapest candidate from `LMX_AGENTS.md` is a single-shot one with no scheduling or state (`lmx.tutor`, `lmx.research`), not `lmx.social` or `lmx.dev-ops`.

**v1.** Wallet identity path, `settlement.ts` (x402), `state.ts` on a local-file backend, `tools.ts` registry supporting more than one tool.

**v2.** Swap `state.ts`'s backend to LMX Storage once Goal 1 ships. Publish `lmx-agent-template` itself as the public repo other developers fork — this is the actual Track A deliverable, not any one agent built from it.

## Connection to other docs

- `TOOL_AND_AGENT_WORKFLOW.md` — the tool-side half of the boundary this template enforces on the agent side.
- `CMO_AGENT_ARCHITECTURE.md` — the most complex real instance of the loop above; this template is the general form it's built from.
- `LMX_AGENTS.md` — the 15 candidate agents this template exists to make cheap to build.
- `ROADMAP.md` → "LMX.Agent — open agent framework, phased" — the roadmap entry this document fulfills, and where Track A's parallel-with-outreach status is recorded.
