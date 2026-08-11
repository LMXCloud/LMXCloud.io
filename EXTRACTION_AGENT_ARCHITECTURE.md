# LMX Extraction Agent — Architecture

First agent to actually build. Ingests unstructured sources (PDF, YouTube, books) → extracts data + generates insights → writes structured markdown optimized for agent consumption → organized into named datasets. Domain-agnostic by default — general knowledge extraction, not marketing-specific (flag if that assumption's wrong).

## Why this is the right first build

Smaller than the CMO agent: one agent, no multi-stage orchestration, no state machine. It's also more leveraged than it looks — this is the generalized version of what the CMO doc's Intake agent needs (`parse_brief`, `keyword_research`, `pitch_library` are all "ingest unstructured input → structured data," just scoped to marketing). Build the general tool first; Intake becomes a caller of it later instead of duplicate logic. Still generates real inference-router call volume — the insight-generation step is an LLM call through LMX's own router, same dogfooding benefit as the CMO agent, faster to ship.

## The Pipeline

```
INGEST (source-specific) → EXTRACT (raw text/structure) → STRUCTURE (LLM insight gen) → WRITE (dataset-organized .md)
```

No orchestrator agent needed yet — one agent holding a small set of tools, called in sequence per source.

## Tool Endpoints

| Tool | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `extract.from_pdf` | fork (PDF parser — e.g. Docling/marker) | PDF file/path | raw text + structural elements (headings, tables) | yes | fork |
| `extract.from_youtube` | fork (transcript/caption API) | YouTube URL | transcript text + metadata (title, channel, timestamp, duration) | yes | fork |
| `extract.from_book` | fork (epub/PDF parser, shares base w/ `from_pdf`) | ebook file/path | raw text + chapter structure | yes | fork |
| `structure.generate_insights` | LLM (LMX inference router) | raw text + source metadata | structured insight object: summary, key points, entities, claims, quotes | yes — real router call volume | new |
| `structure.write_dataset_md` | internal | insight object + metadata | written `.md` file placed in dataset folder | no (v0: local file) / yes (v1+: LMX Storage) | new |
| `dataset.query` | internal | dataset name, filter | matching files/metadata | yes if backed by LMX Storage | new — deferred to v1 |

## Output Schema

YAML frontmatter carries the queryable fields; body is predictable sections so any agent can consume without re-parsing prose:

```markdown
---
source_type: pdf | youtube | book
source: <url or filename>
title: <extracted or provided title>
dataset: <dataset name / namespace>
extracted_at: <timestamp>
tags: [...]
---

## Summary

## Key Insights
- ...

## Entities / Claims
- ...

## Full Extracted Text (or chunked reference)
```

## Datasets

v0: a dataset is just a folder of `.md` files (e.g. `datasets/industry-reports/`). Zero infra, consistent with starting small.

v1+: once `lmx-tool-storage` exists (per the CMO agent doc), index each file's frontmatter into it so `dataset.query` can filter without scanning the filesystem. Files stay canonical — storage becomes a queryable index over them, not a replacement.

## Build Sequence

**v0.** PDF only — broadest utility, no ASR/audio complexity of YouTube, no epub edge cases of books. `extract.from_pdf` → `structure.generate_insights` → `structure.write_dataset_md`, writing to local folders. No querying, no other source types, no storage resource. Proves the pipeline end to end on the simplest input.

**v1.** Add YouTube (transcript-based — cheaper and covers most videos, skip ASR fallback initially) and books. Add `dataset.query` once there's enough file volume to need filtering over folder-browsing.

**v2.** Index into `lmx-tool-storage` once it exists. Wire this agent as a callable tool from the CMO agent's Intake stage rather than duplicating ingestion logic there.

## Connection to Other Docs

See `CMO_AGENT_ARCHITECTURE.md` — this agent is the generalized ingestion layer that CMO's Intake stage should eventually call, and `lmx-tool-storage` (defined there) is the eventual backing store for datasets past v0.
