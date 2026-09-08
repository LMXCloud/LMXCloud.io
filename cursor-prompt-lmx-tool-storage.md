# Cursor Prompt — lmx-tool-storage v0 (Phase A, self-hostable)

*Supersedes the 2026-08-20, 2026-08-22, and earlier 2026-08-28 drafts of this file. This revision adds full roadmap context, the mechanics, and a concrete user story so the build makes sense on its own — without needing `ROADMAP.md`, `VAULT_PRIMITIVE.md`, `CMO_AGENT_ARCHITECTURE.md`, and `LMX_AGENT_TEMPLATE_ARCHITECTURE.md` open side by side. The actual scope — what to build, what not to — is unchanged from the 2026-08-28 version.*

Paste this into the **LMXCloud.io monorepo** (pnpm workspace, Node >=20, TypeScript). This is a new package.

---

## TL;DR

Build `lmx-tool-storage`: a small, independently-runnable HTTP service that stores and queries markdown+frontmatter documents, namespaced per agent/vault. This is **Vault Phase A** — structured storage only, no payment or permission layer yet. One operator, one instance, one database, own-namespace read/write, free. That's the whole build.

---

## 1. The roadmap — where this fits

LMX Cloud is building toward every AI agent it produces (`lmx.agent` — `lmx.social`, `lmx.research`, `lmx.tutor`, etc.) having four default primitives, plus a settlement layer underneath:

- **Wallet** — identity + x402 payment, every agent gets one at scaffold.
- **Agent** — the orchestration loop (`agent.ts`): receive input → plan → call tools → call the inference router → act → persist state → repeat.
- **Vault** — the agent's own persistent memory: markdown notes with YAML frontmatter, free to read/write for the agent that owns them, later payable for any *other* agent to read. **This is what `lmx-tool-storage` backs.**
- **Inference Router** (`api.lmxcloud.io`) — the metered reasoning calls every agent makes.
- **Grid** — settlement + proof underneath all of it: meters and settles every inference call, every external tool call, and (once Phase B ships) every cross-agent vault read, minting free Merkle-anchored receipts as the audit trail.

`ROADMAP.md`'s "Storage, Vault, and LMX.Agent realignment" section lays out a six-week build sequence to get there. This package is **Week 1**:

1. **Week 1 (this build)** — `lmx-tool-storage` v0: own-namespace put/get/query, no gate, running independently of everything else.
2. **Week 2** — `lmx-agent-template`'s `state.ts` (currently a local-file/SQLite stub) gets wired to call this instead, so every future agent forked from the template has real storage from day one.
3. **Week 3** — Vault Phase A finishes wiring into the template, and `lmx.social` (the marketing/X-posting agent — LMX's flagship dogfood agent) ships v0 using it for real.
4. **Week 4** — weekly reflection loop (raw event notes get periodically synthesized into sparser "lessons learned" notes); both `lmx-tool-storage` and `lmx-agent-template` get open-sourced.
5. **Week 5** — Vault Phase B: x402 payment gate, permission tiers, Merkle receipts, and a minimal manifest registry so one agent can discover and pay to read another agent's vault.
6. **Week 6** — review against these checkpoints, pick the next agent to build.

None of Weeks 2–6 are this build. They're here so the API this build ships doesn't have to be reshaped later — namespace-scoped now because Phase B's permission gate slots in per-namespace, frontmatter cleanly queryable now because Phase B's paid `vault.query` is the same query this build already has to support, just metered.

## 2. Why this can't be one more table in LMX's own database

Decided 2026-08-21, in `VAULT_PRIMITIVE.md`'s "Custody model: federated, not LMX-hosted" section: LMX positions itself as Web3-native infrastructure. LMX being the literal custodian of every agent's private memory — one shared Postgres database it operates and can read — directly contradicts that positioning. So the model got split in two:

- **`lmx.storage`** (this package) — the engine. Each agent operator runs their *own* instance: own database, own deploy, own uptime.
- **`lmx.vault`** — what an operator has once they're running an instance for their agent. Their data, their infra, never LMX's.
- **A thin LMX-run manifest registry** (Phase C, not this build) — the only thing LMX ever hosts centrally: `vault_id, owner_wallet, endpoint_url, permission_tiers, price`. No content, ever — close to a DNS record.

Once Phase B ships, a cross-agent read works like this (context only — none of it is built in this package): a reading agent looks up the target vault's `endpoint_url` in LMX's registry, pays through Grid via x402, Grid mints a receipt and a short-lived signed access grant, and the reading agent presents that grant *directly* to the owner's own `lmx.storage` instance — LMX is out of that hop entirely, bytes never transit through LMX. That's the reason this package has to be a real, independently-deployable service now, not a module inside LMX's shared API.

## 3. User story — who actually calls this, and why

The concrete near-term caller is `lmx.social`, the marketing agent that posts to `@LMXCloudio` (Week 3). Its loop, per the locked `lmx.agent` architecture, is: **recall → draft → (optional image) → publish → collect → remember.** Two of those six steps are this package:

> As `lmx.social`, before I draft a new post, I want to **recall** what's worked before — so I `POST /lmx-social/query` with a filter like `{ tags: "engagement" }` against my own vault and get back my last few performance notes, instead of drafting blind every time.
>
> After I publish and gather engagement numbers, I want to **remember** what happened — so I `PUT /lmx-social/<post_id>` a new markdown note: frontmatter with `post_id`, `timestamp`, `likes`, `tags`; body a line or two of what I observed ("posts published 2-4pm on weekdays are outperforming mornings by ~30%"). That note is mine — free to write, free to read back, no one else's business unless they pay for it later (Phase B, not now).
>
> Weeks from now, once enough of these raw notes pile up, a separate weekly reflection job (Week 4, not this build) reads a batch of them back via `query` and writes one denser "reflection note" that synthesizes the pattern — the kind of note worth another agent paying to read, once Phase B exists.

This build doesn't need to wire `lmx.social` itself (that's Week 3) or build the reflection job (Week 4) — but every route this package ships should be shaped so that story works cleanly once those weeks arrive: a caller supplies a namespace and a key, writes markdown with real frontmatter, and gets a clean equality/containment filter back on query. Nothing here should assume a single hardcoded agent or a single document shape — any future `lmx.agent` (not just `lmx.social`) writes to and reads from this exact same API.

## 4. What a Vault document actually is

Each record is a markdown document: YAML frontmatter for structured/queryable fields, a prose body underneath. Frontmatter is what `query()` filters against. Use `gray-matter` to parse/stringify frontmatter+body rather than hand-rolling a parser.

```
---
post_id: "1839..."
timestamp: "2026-08-20T14:00:00Z"
likes: 142
tags: [engagement, weekday]
---

Posts published 2-4pm on weekdays are outperforming the morning slot by ~30%.
```

`[[wikilinks]]` in the body are just stored as text for now — nothing parses them or builds a graph yet.

## 5. Where this package lives, and repo conventions to match

`pnpm-workspace.yaml` already globs `apps/tools/*`, so a new folder at **`apps/tools/lmx-tool-storage/`** is picked up by the workspace automatically — no workspace config changes needed, and it stays consistent with where every other tool package lives (`apps/tools/_template/`, `apps/tools/pdf-extract/`). Independence from the shared host is about it never being imported into `apps/tools/host/src/index.ts` (verified today — that file mounts exactly one tool, `pdf-extract`, at `/pdf-extract`; this package gets no entry there) and having its own `DATABASE_URL`, not about which folder it sits in.

Match the existing tool-package shape (see `apps/tools/_template/package.json` and `apps/tools/pdf-extract/package.json` — both `@lmxcloud/<name>`, `"type": "module"`, and this same script set):
- `dev`: `tsx watch src/index.ts`
- `build`: `tsc -b --force`
- `start`: `node dist/index.js`
- `typecheck`: `tsc --noEmit`

Name it `@lmxcloud/lmx-tool-storage` so `pnpm --filter @lmxcloud/lmx-tool-storage dev` works the same way `pnpm --filter @lmxcloud/pdf-extract dev` already does. Adding convenience scripts to the root `package.json` (`dev:storage` / `build:storage` / `start:storage`, matching the existing `dev:pdf-extract` pattern) is a nice-to-have, your call — just don't touch any of the *existing* root scripts or any other package while adding them.

Give it its own `.env.example` inside its own folder (see `apps/tools/pdf-extract/.env.example` for the shape) documenting `PORT`, `HOST`, and its `DATABASE_URL` — since this runs as a fully separate process with its own env, reusing the name `DATABASE_URL` inside *its own* `.env` is fine and matches the convention `apps/api/src/db/pool.ts` already uses; just make sure nothing here reads from or falls back to the repo-root `.env`'s `DATABASE_URL` (that one is the shared LMX database — this package must never touch it, even by accident via a missing env check).

## 6. Storage backend

An operator's own database, not LMX's. Postgres is the natural default given `apps/api/src/db/pool.ts` already shows the connection pattern this codebase uses (raw `pg.Pool`, lazy singleton `getPool()`, SSL skipped for `localhost`, pool-level error handler so a dropped idle connection doesn't crash the process, `DATABASE_URL` env var) — worth mirroring that same shape here against this package's own database, though whether SQLite makes sense as a lower-friction alternative (or a config-driven choice between the two) for someone with almost no infra is your call.

The document table needs at minimum: `namespace` (= `vault_id`), `key`, parsed `frontmatter` (queryable), the raw markdown (source of truth), and timestamps. Write whatever migration matches this repo's existing migration pattern — `apps/api/src/db/migrate.ts` is an ordered array of SQL statements run in sequence inside `runMigrations()`; match that style against this package's own database, not that file itself.

## 7. API surface

Follow `apps/tools/_template/src/app.ts` + `src/index.ts` for the Hono app shape (routes in `app.ts`, `serve()` in `index.ts`) — that convention is worth keeping even though this won't be mounted into the shared host. Routes, roughly:

- `PUT /:namespace/:key` — raw markdown body (frontmatter + body), upsert
- `GET /:namespace/:key` — raw markdown back, 404 if missing
- `POST /:namespace/query` — `{ filter: { field: value, ... } }`, equality/containment match on frontmatter, returns parsed `frontmatter` + `body` per match
- `GET /health`

`namespace` is caller-supplied, no registration step. Any caller can read or write any namespace on **this instance** — that's fine, because "this instance" now belongs to one operator, not a shared LMX store. That's what makes the missing permission check safe to leave out of this build.

## 8. Out of scope — do not build any of this here

- No settlement/x402 gate on any route — that's Vault Phase B (Week 5).
- No manifest registry, no `vault.register`, no MCP discovery metadata — Phase B/C.
- No cross-namespace permission checks, not even a stub — Phase B adds the gate.
- No signed access grants / grant verification — that's the Phase B cross-instance access flow described in `VAULT_PRIMITIVE.md`.
- No embeddings, semantic search, or link-graph indexing.
- No bond/slashing, no pricing.
- No wiring `lmx.social` or `lmx-agent-template`'s `state.ts` to this — that's Weeks 2–3.
- No reflection-note synthesis job — that's Week 4.
- No changes to `apps/tools/host` or any other existing package.

If you find yourself about to add any of the above, stop — later phase, not this one.

## 9. Deploy story — later, not blocking today

The Week 1 bar is running independently, proven locally — not deployed somewhere new today. When it is ready to deploy, `DEPLOY.md` already shows the pattern this repo uses for a standalone service: repo root + a service-specific `railway.toml` (see `apps/tools/host/railway.toml` for the existing example), added as a new row in `DEPLOY.md`'s table. A Dockerfile/`railway.toml` for this package now is fine if it falls out naturally, but don't let deploy plumbing block getting the round-trip working locally first.

## 10. What "working end-to-end" means for this build

1. `PUT` a document with real frontmatter into some namespace.
2. `GET` it back — identical markdown, byte for byte.
3. `PUT` two more documents into the same namespace with different frontmatter values.
4. `POST /query` with a filter matching one field — get back only the matching document(s).

And critically: it does this without `apps/tools/host` running at all, on its own `DATABASE_URL`, with no dependency on LMX's shared Postgres instance.

## 11. Reference — existing patterns to match, not reinvent

- `apps/tools/_template/` — Hono app package skeleton (routes, package.json, scripts).
- `apps/tools/pdf-extract/` — closest existing example of a standalone tool's shape, including its own `.env.example`; note where this build deliberately diverges (never mounted into `host`) per above.
- `apps/tools/host/src/index.ts` — confirmed today to mount only `pdf-extract`; leave it untouched.
- `apps/tools/host/Dockerfile`, root `Dockerfile`, `DEPLOY.md` — how this repo already packages something deployable, for when this package is ready for its own deploy story.
- `apps/api/src/db/pool.ts`, `apps/api/src/db/migrate.ts` — connection and migration pattern to reuse the *style* of, against this package's own separate database.
- `VAULT_PRIMITIVE.md` ("Custody model: federated, not LMX-hosted" section), `ROADMAP.md` ("Storage, Vault, and LMX.Agent realignment," Decision 4 and the Week 1 checkpoint), `CMO_AGENT_ARCHITECTURE.md` ("Data Layer — Per-Agent Storage"), and `LMX_AGENT_TEMPLATE_ARCHITECTURE.md` (`state.ts`) — the docs this build has to match, and where the user story above comes from.
