# Cursor Prompt — Split into lmx-tools / lmx-agents workspaces

## Why

This repo currently bundles the pdf-extract tool's implementation alongside the agent. Before this is open-sourced, the tool's source can't live anywhere an agent-forker can reach it — otherwise the tool ships for free to anyone who forks the agent, and any settlement/payment gate added later is just code sitting in a repo the forker already has, trivial to delete. The agent should only ever hold a URL to call the tool at, never its implementation.

The fix is two shared workspace repos, not two single-purpose repos — `lmx-tools` will hold every tool LMX builds as its own package, `lmx-agents` will hold every agent the same way, both mirroring how `LMXCloud.io` itself is already structured (a pnpm workspace with independently deployable packages, e.g. `apps/api`, `apps/mcp-server`). The two workspaces are never mixed with each other.

## What to do

1. Create a new repo `lmx-tools`, set up as a pnpm workspace (same shape as `LMXCloud.io`'s `pnpm-workspace.yaml` — `packages/*`). Move `tools/pdf-extract` into it as `packages/pdf-extract`. It should have no dependency on anything in the agent repo.
2. Create a new repo `lmx-agents`, same pnpm workspace shape. Move the `agent` folder into it as `packages/extract`.
3. In `lmx-agents/packages/extract`, update the tool call to hit a configurable URL (env var, defaulting to `http://127.0.0.1:8787` for local dev) rather than assuming the tool lives in a sibling folder.
4. Write a README at the root of each new repo: `lmx-tools`'s explains this holds every LMX tool as independent packages, each with its own deploy; `lmx-agents`'s explains the same for agents, and notes that agent packages call tool packages over HTTP only — never import them directly.

## Constraint

This is a structural move only — don't change the extraction logic or the agent's orchestration logic.

## Verify after the split

Run `packages/pdf-extract` standalone within `lmx-tools` (`/health`, `/extract` against a sample PDF, same as before), then run the agent's full command from `lmx-agents/packages/extract` against the now-external tool and confirm a real `.md` file lands in `datasets/demo/`. That end-to-end run — not the tool endpoint alone — is the actual v0 acceptance test.
