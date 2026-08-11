# LMX CMO Agent — Architecture

Full-funnel marketing orchestrator: aggregates goals/data → plans → generates → auto-posts → collects results → optimizes, on repeat. Built as an orchestrator layer on top of the existing marketing suite (content planner, generator, publisher, analytics — shipped wk of 2026-07-29), plus two new pieces (Intake, Optimizer) that close the loop.

Same construction pattern as everything else in the ecosystem: fork/wrap external capability as an `lmx-tool-*` with a hardwired settlement + proof-of-execution hook to Grid, and the agent just holds a manifest reference. Nothing below requires special-casing in the orchestrator — every capability is a tool call.

---

## The Loop

```
INTAKE → PLAN → GENERATE → PUBLISH → COLLECT → OPTIMIZE ─┐
   ↑___________________________________________________|
```

The CMO Agent is the state machine that owns this loop. It doesn't do the work itself — it holds campaign state (current goal, plan, KPIs, history) and calls each stage's agent as a tool, in sequence, on a schedule or event trigger (e.g., "weekly cadence" or "re-plan when KPI drifts >20% off target").

---

## Agent Structure

### 0. CMO Agent (Orchestrator)
**Role:** owns campaign state and the loop above. No content/data logic of its own — pure routing + state.

| Tool Endpoint | Type | Input | Output | Grid Hook |
|---|---|---|---|---|
| `cmo.create_campaign` | internal | goal brief (from Intake) | campaign_id, initial state | no (state write) |
| `cmo.advance_stage` | internal | campaign_id, current stage output | next stage triggered | no |
| `cmo.get_campaign_state` | internal | campaign_id | full state object | no |

State store: needs a persistent DB (campaign_id → goal, plan, KPI targets, history of cycles). This is new — doesn't exist in the current marketing suite, which is stateless per the fork-pattern.

---

### 1. Intake Agent (new)
**Role:** aggregate and normalize everything the CMO agent needs before it can plan: goals, keywords, pitches, KPIs, existing data.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `intake.parse_brief` | LLM | raw goal text/doc from user | structured goal object (type, target metric, deadline, audience, constraints) | yes | new |
| `intake.keyword_research` | external data | seed terms, industry | ranked keyword list + volume/difficulty | yes | fork (wrap existing OSS keyword/SEO tool or 3rd-party API) |
| `intake.pitch_library` | data store | none / query | canonical value props, positioning, brand voice rules | yes | new |
| `intake.kpi_registry` | data store | KPI name | definition + current baseline (pulled from Analytics agent) | yes | new |

---

### 2. Planning Agent (existing: content planner)
**Role:** turn a structured goal + keywords + KPIs into a content calendar and channel mix.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `planner.generate_campaign_plan` | LLM | goal object, keywords, KPIs | content calendar: list of {content_type, channel, target_keyword, target_kpi, scheduled_date} | yes | exists |
| `planner.channel_selector` | LLM + data | audience, historical performance (from Analytics) | ranked channel list | yes | exists (extend to read Analytics history) |
| `planner.budget_allocator` | internal | budget/credits, channel mix | per-channel spend/credit allocation | yes | new (only if credit spend is in scope) |

---

### 3. Generation Agent (existing: content generator)
**Role:** produce the actual content per planned item.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `generator.write_copy` | LLM (LMX inference router) | content_type, keyword, pitch, channel | draft copy | yes — this is real inference-router call volume | exists |
| `generator.generate_image` | external | copy/brief, brand assets | image asset | yes | **already connected**: Canva MCP is live in this session (`generate-design`, `create-design-from-brand-template`, `export-design`) — use it directly instead of building an image tool from scratch |
| `generator.brand_voice_check` | LLM | draft copy, pitch_library | pass/fail + revision notes | yes | exists |

---

### 4. Publishing Agent (existing: content publisher)
**Role:** auto-post approved content to the right channel at the right time.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `publisher.post_to_x` | external API | final content, schedule time | post_id, post_url | yes | exists — gated on registered X dev app |
| `publisher.post_to_linkedin` | external API | final content, schedule time | post_id, post_url | yes | exists — gated on registered LinkedIn dev app |
| `publisher.post_to_discord` | external API | final content, target server/channel | message_id | yes | new — needed if outreach/community posting is in scope |
| `publisher.post_to_reddit` | external API | final content, target subreddit | post_id | yes | new — same as above |
| `publisher.schedule_queue` | internal | queued items | execution log | no | exists |

---

### 5. Analytics Agent (existing: analytics agent)
**Role:** collect engagement + conversion data per campaign, roll up against KPIs.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `analytics.collect_engagement` | external API | post_id per platform | likes/comments/shares/clicks | yes | exists |
| `analytics.collect_conversion` | internal (Grid query) | campaign_id, time window | new DAU / new wallet calls / credit redemptions attributable to campaign | **reads from Grid's own call/settlement logs** | new — this is the loop that proves the agent is actually driving router usage, not just posting content |
| `analytics.kpi_rollup` | internal | campaign_id | actuals vs. targets, variance flags | no | exists |

---

### 6. Optimization Agent (new)
**Role:** closes the loop. Reads the rollup, decides what changes, writes back into the plan.

| Tool Endpoint | Type | Input | Output | Grid Hook | Build |
|---|---|---|---|---|---|
| `optimizer.analyze_performance` | LLM | kpi_rollup, campaign history | plain-language diagnosis (what worked/didn't) | yes | new |
| `optimizer.recommend_adjustments` | LLM | diagnosis | structured adjustment object (shift budget A→B, kill content type X, retry variant Y) | yes | new |
| `optimizer.update_campaign_plan` | internal | adjustment object, campaign_id | updated plan, fed back to `cmo.advance_stage` → Planning | no | new |

---

## Data Layer — Per-Agent Storage

Every agent harvests data specific to its own task. Nothing is a shared free-for-all table — each agent owns its rows, joined across agents by `campaign_id`.

| Agent | Data Harvested | Write Pattern | Notes |
|---|---|---|---|
| Intake | campaign briefs, keyword research results, KPI baselines, pitch library | low-volume, mostly reference/config | read by Planner on every cycle |
| Planning | plan versions (calendar, channel mix, budget allocation) per campaign | append-only — each re-plan is a new version, not an overwrite | gives Optimizer something to diff against |
| Generation | content drafts + revisions, brand-voice check results, asset references | moderate volume | store Canva design IDs / URLs, not image blobs |
| Publishing | post records: post_id, URL, channel, scheduled vs. actual time, errors | append-only log | one row per publish attempt |
| Analytics | time-series engagement pulls (per post, per platform, per timestamp), conversion attribution pulled from Grid's call logs | highest volume, time-series shape | this is the table that proves ROI |
| Optimizer | diagnosis, recommended adjustment, before/after plan diff | append-only audit trail | answers "why did the campaign change" later |
| CMO (orchestrator) | campaign state: current stage, stage-transition history | single row per campaign, updated in place | the join key (`campaign_id`) for everything above |

### What LMX Storage actually is

Not a relational DB with migrations — a thin metered key/value or document store: `put(namespace, key, value)`, `get(namespace, key)`, `query(namespace, filter)`. Almost everything above (campaign state, plan versions, drafts, post records, engagement logs) is document-shaped, not join-heavy. It doesn't require LMX to run its own DB cluster — it can be a metered proxy in front of an existing managed DB, wrapped with the same settlement + proof hook as every other tool. Same fork-and-wrap pattern applied to storage instead of a marketing capability, which keeps this a small build, not a "build a database" build.

### Storage decision: LMX Storage resource, not local SQLite by default

The agent already can't run without an LMX API key — inference calls (`write_copy`, `generate_campaign_plan`, `analyze_performance`, etc.) are hardwired through LMX's router per the existing tool pattern. Given that dependency is non-negotiable already, routing storage through an LMX-hosted resource on the same key adds no incremental setup for a self-hoster — no DB to install, no file to persist across container restarts, nothing to configure. That's actually lower friction than shipping local SQLite, not higher, and it satisfies "fully run by LMX Cloud infra" without a tradeoff.

This is the first concrete instance of the "storage" resource type already sequenced next in LMX's execution layer (compute → storage → third-party functions). Same shape as everything else: `lmx-tool-storage` wraps the interface, hardwired Grid settlement + proof-of-execution hook, agent config just holds a manifest reference.

Keep a thin storage-adapter interface in the orchestrator (`get`/`put`/`query`, one implementation per backend) so the LMX Storage resource isn't hard-baked into every agent's code directly — that's what lets someone who forks the repo swap in local SQLite if they want to strip the dependency entirely, consistent with the fully-open self-hostable promise. It just isn't the shipped default.

## Grid Integration Notes

- Every tool that touches an external system (platform APIs, keyword data, Canva) gets wrapped as `lmx-tool-*` with a hardwired settlement + proof-of-execution hook — non-optional, per the established pattern.
- Internal LLM calls (`write_copy`, `generate_campaign_plan`, `analyze_performance`, etc.) route through LMX's own inference router. This is real, attributable call volume against the DAU goal — the CMO agent is a demand source, not just a feature.
- `analytics.collect_conversion` inverts the usual direction: instead of Grid metering the tool, the agent queries Grid's logs as a first-party data source to prove campaign ROI. Worth surfacing as a customer-facing feature later (verifiable attribution), not just plumbing.

## Known Dependencies / Chokepoints

- Platform dev app registrations (X, LinkedIn, and Discord/Reddit if outreach posting is in scope) — named previously as a real moat, gates the Publishing Agent regardless of how the tools are built.
- Canva MCP is already connected in this session — reuse it for `generator.generate_image` rather than building an image-gen tool.
- Campaign state store (`cmo.*` internal tools) doesn't exist yet — everything else in the current suite is stateless. Resolved above via the LMX Storage resource.
- `lmx-tool-storage` itself doesn't exist yet — it's the one new piece of core infra this build requires, not just another marketing tool.

## Open Questions

- Does the Optimizer act autonomously (auto-adjusts budget/channel/next plan) or does a cycle need human approval before re-publishing? Changes whether `optimizer.update_campaign_plan` writes directly or queues a diff for review.
- Is Discord/Reddit outreach posting in v1 scope, or does that stay manual for now? Determines whether `publisher.post_to_discord` / `post_to_reddit` get built immediately.

## Suggested Repo Layout

```
lmx-agent-cmo/              orchestrator (open source)
lmx-tool-intake-keywords/   fork + Grid hook
lmx-tool-publish-x/         existing
lmx-tool-publish-linkedin/  existing
lmx-tool-publish-discord/   new
lmx-tool-publish-reddit/    new
lmx-tool-analytics-collect/ existing, extend with collect_conversion
lmx-tool-storage/           new — LMX Storage resource, Grid-hooked, default backend for cmo.* state + all per-agent tables
```

## Build Sequence — Start Small

**v0 — prove the loop.** One campaign, one channel (X — dev app already exists). Goal supplied by hand as a structured config, no Intake agent yet. Bare CMO orchestrator chains Planning → Generation → Publishing once, no re-loop, no Optimizer. Storage uses the adapter interface pointed at a local dev implementation (single SQLite or JSON file) — not the real `lmx-tool-storage` resource. Analytics does `collect_engagement` only, reviewed by hand. This is mostly wiring three agents that already exist plus one thin new orchestrator, and it starts generating real inference-router traffic immediately.

Cut entirely for v0: Intake agent, Optimizer agent, Discord/Reddit publishing, `collect_conversion`, `kpi_rollup`, and the real LMX Storage resource.

**v1 — close the loop.** Add Optimizer, shaped by whatever you actually learned reviewing v0's data — don't design its heuristics blind. Add `collect_conversion` (Grid log query) once there's a real campaign to attribute. Add re-looping: orchestrator runs Plan→...→Optimize→Plan on a cadence instead of once.

**v2 — make it a product.** Build the real `lmx-tool-storage` resource and swap the adapter over from dev-mode. Add the Intake agent (keyword research, pitch library, KPI registry) so goal input stops being manual. Add remaining channels if outreach automation is still in scope. This is the point where download-and-run friction for other people actually matters — v0/v1 are just you dogfooding it.

## Next Steps

- Build v0 first: CMO orchestrator (bare) + existing Planning/Generation/Publishing agents + local dev storage.
- Once v0 runs a real campaign end to end, a Cursor-ready prompt can be written for it.
