# Cursor Prompt — Extraction Agent v0

## Goal

Build v0 of the LMX Extraction Agent: given a PDF, extract its text, generate structured insights via LMX's own inference API, and write the result as a markdown file into a local dataset folder. This is the smallest working slice of the pipeline defined in `EXTRACTION_AGENT_ARCHITECTURE.md` — PDF only, no YouTube/books yet, local files only, no LMX Storage resource, no payment gating (internal tool, not a paid public one yet).

## What exists today (verified in-repo)

- Monorepo is pnpm workspaces, `apps/*` and `packages/*` (`pnpm-workspace.yaml`).
- `apps/cli` (`@lmxcloud/cli`) is the existing pattern for a small standalone Node/TS tool that authenticates against the LMX API — see `src/api.ts`, `src/auth.ts`, `src/storage.ts`. Good template/precedent, whether or not the extraction agent ends up living inside it.
- `apps/mcp-server/src/lmx-client.ts` has the working pattern for calling LMX's own API (`fetchJson`, hitting `/v1/chat/completions`) — this is how insight-generation should route through LMX's own router instead of an external LLM provider.
- `apps/mcp-server/src/x402.ts` and `packages/x402` show the paid/x402-gated tool pattern used for public MCP tools like `chat_completion`. Not needed for v0 — this tool isn't public or paid yet — but it's the pattern to follow later when/if the extraction agent becomes a registered paid tool.
- No PDF-parsing, YouTube-transcript, or dataset/markdown-writing code exists anywhere in this repo yet — that part is fully new.

## What v0 needs to do

1. Take a PDF file as input.
2. Extract its raw text (pick a well-maintained Node-native PDF text extraction library — your call).
3. Send the extracted text to LMX's own inference API (same call pattern as `lmx-client.ts`) to generate a structured insight object: summary, key insights, entities/claims.
4. Write the result as a markdown file with YAML frontmatter (`source_type`, `source`, `title`, `dataset`, `extracted_at`, `tags`) followed by `## Summary`, `## Key Insights`, `## Entities / Claims`, and `## Full Extracted Text` sections. Exact schema is in `EXTRACTION_AGENT_ARCHITECTURE.md`.
5. Place the file in a local folder representing the dataset (e.g. `datasets/<dataset-name>/`).

## Constraints

- PDF only — no YouTube or book ingestion yet.
- No `lmx-tool-storage`, no LMX Storage resource, no x402 payment gating — local files, internal use only.
- Authenticate to the LMX API the same way `apps/cli` already does — don't build new auth.
- Keep it runnable as a simple script/CLI command. Whether that's a new command inside `apps/cli` or a new minimal package under `apps/` is your call.

## Reference

Full architecture and output schema: `EXTRACTION_AGENT_ARCHITECTURE.md` (repo root).
