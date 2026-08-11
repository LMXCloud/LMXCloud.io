# LMX Tool & Agent Workflow — Repo Structure

The repeatable pattern for everything built after `pdf-extract`, not a one-off for this build.

## The pattern, in one line

Tools live as workspace packages under `LMXCloud.io/apps/tools/*`, mounted by a shared deployable host (`apps/tools/host`). Agents live separately (today: extraction work in agent repos / Track A) and call tools over HTTP by URL only — a tool's source is never reachable from an agent's repo.

## Why the hard rule is tool/agent separation, not one-repo-per-tool

The actual risk (confirmed while splitting `pdf-extract` out of the extraction agent's repo): if a tool's source lives inside an agent's repo, open-sourcing or forking the agent gives the tool away for free, and any settlement gate becomes a few lines of code a forker can just delete. That risk is solved by any tool/agent boundary — it doesn't require splitting tools from each other too. Bundling multiple tools together in one shared host doesn't reintroduce the problem, since agents still only ever hold a URL, never another package's source.

## Structure (current)

`LMXCloud.io/apps/tools/` — tool packages in the core monorepo:

| Path | Role |
|------|------|
| `apps/tools/<name>/` | Hono app package exporting `./app` (+ optional standalone `src/index.ts`) |
| `apps/tools/host/` | Shared deployable host — mounts each tool under a path prefix |
| `apps/tools/_template/` | Copy-paste skeleton for tool #N |

`pdf-extract` is mounted at `/pdf-extract`. Deploy one Railway service via `apps/tools/host/railway.toml`. MCP points `PDF_EXTRACT_URL` at `https://<host>/pdf-extract`.

Agents remain outside the tool packages (and ideally outside the tool host). `lmx-agents/` as a separate workspace for orchestration packages is still the direction for Track A agents; it is not required for the tools host itself.

## Trade-off, named honestly

If a third party ever wants to fork and self-host just one specific tool, they'd clone the whole monorepo (or later `git subtree split` one package) instead of a tiny standalone repo. Not a one-way door: any package can be split out later when a specific tool earns that.

## Local development

```bash
pnpm install
pnpm dev:tools-host          # host :8080, tools under /<name>
# optional single-tool iteration:
pnpm dev:pdf-extract         # standalone :8787
```

MCP local: set `PDF_EXTRACT_URL=http://127.0.0.1:8080/pdf-extract` when using the host.

## What a tool package looks like

1. A Hono app (`src/app.ts`) with `/health` plus the capability route(s) — routes are relative to the mount prefix.
2. A settlement/auth gate wrapping paid routes (deferred for now) — checks a valid LMX API key or accepts x402 before running logic. Gate lives on the tool app, not the host root, so each tool can price differently.
3. Discovery metadata (Bazaar/x402) when ready to list publicly.
4. Mounted in `apps/tools/host/src/index.ts` with one import + one `.route()`. Deployed via the shared host (Railway), same pattern as other LMX services.

**Dependency note:** `@lmxcloud/x402` is a private package in this monorepo — tools can take a workspace dependency when settlement lands. If a tool is ever split to an external repo, either depend on the public `@x402/*` packages or publish `@lmxcloud/x402`.

## What an agent package looks like

Pure orchestration, no tool implementation code, ever. Holds: the URLs of the tools it calls, its own LMX credentials (API key for now; a wallet later), and sequencing/state logic.

## Getting discoverable — two paths

- **Proxy through LMX's central MCP server** (`apps/mcp-server`) — add the tool as a hand-coded entry (what `extract_pdf` does today). Requires a platform-repo change per tool.
- **Tool speaks MCP natively** — each tool (or the shared host) runs its own MCP surface and declares Bazaar/x402 metadata independently.

The second path scales better as the tool count grows; the first path is the current wiring for Grid/MCP.

## Sequencing (status)

1. ~~Move pdf-extract into a tools workspace package~~ — done (`apps/tools/pdf-extract`).
2. ~~Shared host + template~~ — done (`apps/tools/host`, `apps/tools/_template`). See [`apps/tools/README.md`](./apps/tools/README.md).
3. Deploy tools-host on Railway; set MCP `PDF_EXTRACT_URL` to `…/pdf-extract`.
4. Add settlement gate + discovery metadata when ready to bill publicly.

## Adding the next tool

Copy `_template` → implement `app.ts` → one host `.route()` line. That is the whole procedure — details in [`apps/tools/README.md`](./apps/tools/README.md).
