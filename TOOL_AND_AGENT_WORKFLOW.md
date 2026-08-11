# LMX Tool & Agent Workflow — Repo Structure

The repeatable pattern for everything built after `pdf-extract`, not a one-off for this build.

## The pattern, in one line

Two shared repos: `lmx-tools` (every tool, as workspace packages) and `lmx-agents` (every agent, as workspace packages). The two are never mixed with each other, and neither is nested in `LMXCloud.io`. Agents call tools over HTTP; a tool's source is never reachable from an agent's repo.

## Why the hard rule is tool/agent separation, not one-repo-per-tool

The actual risk (confirmed while splitting `pdf-extract` out of the extraction agent's repo): if a tool's source lives inside an agent's repo, open-sourcing or forking the agent gives the tool away for free, and any settlement gate becomes a few lines of code a forker can just delete. That risk is solved by any tool/agent boundary — it doesn't require splitting tools from each other too. Bundling multiple tools together in one shared repo doesn't reintroduce the problem, since agents still only ever hold a URL, never another repo's source.

## Structure

`lmx-tools/` — one pnpm workspace repo, mirrors how `LMXCloud.io` itself is already structured (`apps/api`, `apps/mcp-server`, etc. as independently deployable packages in one repo). Packages: `packages/pdf-extract`, future `packages/youtube-transcript`, `packages/storage`, etc. Each package is independently deployable (its own Railway service) and carries its own settlement gate + discovery metadata.

`lmx-agents/` — same shape, one workspace repo. Packages: `packages/extract`, future `packages/cmo`, etc. Each is pure orchestration.

Both separate from `LMXCloud.io` (core platform — API, MCP server, dashboard, CLI).

## Trade-off, named honestly

If a third party ever wants to fork and self-host just one specific tool, they'd have to clone the whole `lmx-tools` repo instead of a small standalone one — less clean than one-repo-per-tool for that case. Not a one-way door: any package can be split out into its own repo later (`git subtree split` or similar) exactly when a specific tool earns that, rather than upfront for all of them.

## Local development layout

```
~/lmx/
  LMXCloud.io/    (core platform, existing)
  lmx-agents/     (workspace repo, packages/extract, ...)
  lmx-tools/      (workspace repo, packages/pdf-extract, ...)
```

## What a tool package looks like

1. A minimal HTTP server (Hono, matching `pdf-extract`) exposing the capability at one or more endpoints (`/health` plus the capability's own route).
2. A settlement/auth gate wrapping that route — checks a valid LMX API key (same validation call `apps/mcp-server` already makes against `/v1/usage`) or accepts x402 payment, before running the actual logic. This is what makes it "on Grid" — the gate lives in the tool's own deployed code, since a deployed server is the only thing that enforces it regardless of who's calling.
3. Discovery metadata (Bazaar/x402 declaration) so it's listable on Agentic.Market once deployed.
4. Deployed independently with a real URL — Railway, matching the rest of the ecosystem (`DEPLOY.md`, existing `railway.toml` files). One workspace repo, independently deployed packages — same pattern LMXCloud.io itself already uses.

**Dependency note:** `@lmxcloud/x402` (the settlement wrapper `apps/mcp-server` uses) is a private, unpublished package living inside the LMXCloud.io monorepo — `lmx-tools` can't import it directly. When wiring settlement into a tool package, either build against the underlying public packages it wraps (`@x402/core`, `@x402/evm`, `@x402/extensions`), or publish `@lmxcloud/x402` for reuse once there are enough tools to justify it. Not a decision to make now.

## What an agent package looks like

Pure orchestration, no tool implementation code, ever. Holds: the URLs of the tools it calls, its own LMX credentials (API key for now; a wallet later, per the x402 client pattern already working in `plugin-lmxcloud/src/x402-client.ts`), and whatever sequencing/state logic is its actual job.

## Getting discoverable — two paths

- **Proxy through LMX's central MCP server** (`apps/mcp-server` in LMXCloud.io) — add the tool as a new hand-coded entry, same shape as `chat_completion`. Requires a change to the core platform repo every time.
- **Tool speaks MCP natively, on its own** — each package in `lmx-tools` runs its own small MCP server (same `@modelcontextprotocol/sdk` LMX's own server uses) and declares its own Bazaar/x402 discovery metadata, independently listed without LMX's central server knowing about it at all.

The second path scales better as the tool count grows and doesn't block on platform-repo changes — likely the right default once a tool is ready to go public, even though the first path is what "wiring into Grid/MCP" referred to earlier in this build.

## Sequencing for the current build

1. Move `tools/pdf-extract` into `lmx-tools` as its first workspace package (pnpm workspace, mirroring LMXCloud.io's own `apps/*` pattern). Extraction agent moves into `lmx-agents` as its first package.
2. Verify both repos still work locally, agent package calling the tool package over HTTP.
3. Once satisfied with insight quality on real documents, deploy the `pdf-extract` package and add the settlement gate + native discovery metadata to it — this is the point it actually becomes billed and discoverable.

## Worth doing once this one is proven

A template package within each workspace (a `packages/_template` folder, or a small generator script) so future tools/agents don't re-derive the server + settlement-gate + discovery-metadata boilerplate from scratch each time. Premature before this first tool/agent pair is fully working end to end and deployed — revisit after.
