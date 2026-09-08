# Cursor Prompt — Extraction Pipeline Resilience Against Chat API Failures

## Context

The extraction pipeline (PDF/DOCX ingest → `structure.generate_insights` via LMX's own `POST /v1/chat/completions` → write dataset markdown, per `EXTRACTION_AGENT_ARCHITECTURE.md`) currently loses the whole run when the insight-generation step fails. A real run today (2026-08-11, a Helium DOCX re-processed through the UI) died with a Cloudflare 504 on the chat API call, and nothing from that run was written anywhere — the successfully-parsed raw text was thrown away along with the failed insight call. Separately, the CLI path already has a working completed version of this same document (`datasets/realworld-cli/cli-docx-helium.md`), so the extraction/parsing side is not the problem — only the insight-generation step is fragile.

The chat API itself is being hardened separately (see `cursor-prompt-inference-router-reliability-fix.md` / ROADMAP.md Goal 0 item 7) — production success rate on chat completions has been as low as ~17% recently. This prompt is about making the extraction pipeline not lose work or fail opaquely when that call fails, regardless of how reliable the underlying API ends up being — retries and graceful degradation are good practice here independent of the current incident.

## What to do

1. **Don't lose the raw extract on insight-gen failure.** If `structure.generate_insights` fails (timeout, 5xx, network error), still write what's already been produced — at minimum the raw extracted text and source metadata — to the dataset folder (or a clearly-marked partial/pending location), instead of discarding the whole run. A user should never have to re-run extraction from scratch just because the LLM step failed after parsing already succeeded.

2. **Add retry with backoff on the `generate_insights` call specifically** — a handful of retries with exponential backoff (a 504 is explicitly Cloudflare's own "retryable, try again shortly" signal) before giving up and falling back to (1).

3. **Surface a clear, specific error** when insight-gen ultimately fails after retries — not a generic UI failure. Something like "extraction succeeded, insight generation is currently unavailable (LMX chat API), raw extract saved — retry insight generation from here" as both a UI-facing message and whatever the CLI's equivalent output is.

4. **Make retrying just the insight-generation step possible without redoing extraction** — if the raw extract is already saved per (1), there should be a way to pick it back up and retry only the LLM step, not necessarily a full pipeline re-run.

## Constraints

- This only touches the extraction pipeline's handling of the `generate_insights` call and its output — don't change the chat API itself, PDF/DOCX parsing, or dataset file schema beyond what's needed to represent a partial/pending state.
- Keep the existing output schema (YAML frontmatter + `## Summary` / `## Key Insights` / `## Entities / Claims` / `## Full Extracted Text` sections) for a completed run — a partial run's file should be clearly distinguishable (e.g. a status field in frontmatter) rather than silently missing sections.
- Whether this pipeline currently lives in the UI backend, the CLI (`apps/cli`), or both — find the actual call site(s) for `generate_insights` in the repo and apply this consistently across whichever surfaces call it, rather than assuming one location.

## Reference

`EXTRACTION_AGENT_ARCHITECTURE.md` (pipeline + output schema), `cursor-prompt-extraction-agent-v0.md` (original v0 build prompt — this repo's version, not the standalone-repo one), `apps/mcp-server/src/lmx-client.ts` (existing pattern for calling LMX's own chat completions API). `datasets/realworld-cli/cli-docx-helium.md` is the known-good CLI output for this same source document, useful as a reference for what a completed run should look like.
