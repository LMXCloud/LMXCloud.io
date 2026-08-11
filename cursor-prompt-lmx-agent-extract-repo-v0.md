# Cursor Prompt — LMX Extraction Agent (new standalone repo, v0)

Paste this into a **fresh Cursor project in a new, empty folder** — not inside the LMXCloud.io repo. This is intentionally a separate, independent project.

## Context: what LMX Cloud is (you have no prior knowledge of it)

LMX Cloud is an inference/compute router. It exposes an OpenAI-compatible chat completions API:

- Base URL: `https://api.lmxcloud.io`
- Auth: `Authorization: Bearer lmx_...` header (API key created at lmxcloud.io/console/keys)
- Chat completions: `POST /v1/chat/completions`, OpenAI-compatible request/response shape
- Models list: `GET /v1/models`

Example:
```
curl https://api.lmxcloud.io/v1/chat/completions \
  -H "Authorization: Bearer lmx_..." \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-3-70b", "messages": [{"role": "user", "content": "..."}]}'
```

**All LLM calls in this project must go through this API** — not OpenAI, not Anthropic, not any other provider directly. Routing usage through LMX's own router is the point of this build, not an implementation detail.

**Architecture principle to follow strictly, even at this small scale:** agents are orchestration logic only. Any non-trivial capability (parsing, extraction, etc.) is built as a standalone tool exposed over HTTP and called by the agent — never imported as a library directly into the agent's own code. These tool services are meant to eventually run independently, get their own metering/settlement wrapper, and be reused by other agents, so keep them decoupled from day one even though everything runs locally for now.

## Goal

Build v0 of an extraction agent: given a PDF, extract its text via a separate tool endpoint, generate structured insights via LMX's inference API, and write the result as a markdown file into a local dataset folder.

## Required structure — two decoupled services, not one codebase

1. **`tools/pdf-extract/`** — a minimal standalone HTTP server exposing one endpoint (e.g. `POST /extract`) that accepts a PDF and returns extracted raw text (plus structural info like headings, if easy to get). Pick a well-maintained PDF text-extraction library for this — your call. This is "the tool." Nothing outside this folder should ever import a PDF-parsing library directly.

2. **`agent/`** — the orchestrator. It has zero PDF-parsing logic. It:
   - calls the `tools/pdf-extract` HTTP endpoint to get raw text from a given PDF,
   - calls LMX's `/v1/chat/completions` to turn that raw text into a structured insight object (summary, key insights, entities/claims),
   - writes the result to a markdown file.

Run both as two local processes talking over `localhost` HTTP (e.g. agent calls `http://localhost:<port>/extract`). Structure them so `tools/pdf-extract` could become its own deployed service later without changing how the agent calls it.

## Output format

Markdown file, YAML frontmatter followed by predictable sections:

```markdown
---
source_type: pdf
source: <filename>
title: <extracted or provided title>
dataset: <dataset name>
extracted_at: <timestamp>
tags: []
---

## Summary

## Key Insights
- ...

## Entities / Claims
- ...

## Full Extracted Text
```

Write output to `datasets/<dataset-name>/<file>.md`.

## Explicit constraints for v0

- PDF only — no YouTube, no books, no other source types.
- No database, no hosted storage — local files only.
- No payment/settlement logic (x402, wallets, etc.) — this version is unauthenticated internally between the two local services; that comes later once this is a public tool.
- The only external network call allowed is to `https://api.lmxcloud.io` for the LLM step. Everything else runs locally.
- Needs an `LMX_API_KEY` env var (get one from lmxcloud.io/console/keys) and default `LMX_API_URL=https://api.lmxcloud.io`.

## What to scaffold

A new git repo with the two-folder structure above, a root README explaining what this is and how to run both processes together, and clear env var handling for the LMX API key. Your call on language/framework for both pieces — Node/TS is a reasonable default given the rest of the LMX ecosystem, but not a hard requirement.
