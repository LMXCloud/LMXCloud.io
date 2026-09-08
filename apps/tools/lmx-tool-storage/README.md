# @lmxcloud/lmx-tool-storage

Independently-runnable HTTP service for namespaced markdown + YAML frontmatter documents (Vault Phase A). One operator, one instance, one database. Not mounted into `apps/tools/host`.

## Setup

No database setup is required for a first run. If `DATABASE_URL` is unset, the server uses a local SQLite file at `data/vault.db` (created automatically, gitignored). Semantic search uses a local sentence-embedding model (`Xenova/all-MiniLM-L6-v2`) with no API key. The first boot may download model weights into `data/models/` (~23MB from the Hugging Face Hub); after that, inference is fully local. Storage, embeddings, query, and search never leave this process — consolidation is the one route that calls out (LMX Grid).

```bash
pnpm install
pnpm --filter @lmxcloud/lmx-tool-storage dev
```

To use Postgres instead, copy `.env.example` to `.env` and set `DATABASE_URL` to **your own** Postgres database — never the repo-root LMX API database. This package loads only `apps/tools/lmx-tool-storage/.env`. Postgres is the production path; SQLite is the zero-setup local default. The Postgres path enables `pgvector` on boot (`CREATE EXTENSION IF NOT EXISTS vector`); the database user must be allowed to create that extension.

```bash
cp apps/tools/lmx-tool-storage/.env.example apps/tools/lmx-tool-storage/.env
# then uncomment and set DATABASE_URL
```

Default: `http://127.0.0.1:8788` (`PORT` / `HOST` overridable). Root convenience scripts: `pnpm dev:storage`, `pnpm build:storage`, `pnpm start:storage`.

Boot logs which backend was picked (`Using local SQLite at ./data/vault.db` or `Using Postgres`).

## Routes

| Method | Path | Body |
|--------|------|------|
| `GET` | `/health` | — |
| `PUT` | `/:namespace/:key` | raw markdown (frontmatter + body) |
| `GET` | `/:namespace/:key` | stored markdown, byte-for-byte |
| `POST` | `/:namespace/query` | `{ "filter": { "field": value } }` |
| `POST` | `/:namespace/search` | `{ "query": "natural language", "top_k": 10 }` |
| `POST` | `/:namespace/consolidate` | — (no body) |

`POST /query` matches frontmatter by equality or containment (including `{ "tags": "engagement" }` against `tags: [engagement, weekday]`). Empty `filter` returns the namespace, capped at 100.

`POST /search` ranks documents in the namespace by semantic similarity of the query to each document body. `top_k` defaults to 10 and is capped at 100. Each hit includes `key`, `frontmatter`, `body`, and a cosine `score`. This sits beside `/query` — it does not replace it.

`POST /consolidate` is a callable action, not a background timer this service owns. Wire it from your own cron, a manual curl, or an agent's scheduler. It pulls raw notes in the namespace that have not yet been folded (`kind: reflection` notes and notes with `superseded_by` are skipped), clusters near-duplicates with the local embedding model, sends the batch to Grid, writes one new `kind: reflection` note (searchable like any other document), and annotates each folded original with `superseded_by` pointing at that reflection's key. Originals are never deleted. A second call on the same namespace is a no-op until new raw notes arrive. Requires `LMX_API_KEY` in this package's `.env`; if unset, this route returns **503** with an actionable error. PUT/GET/query/search keep working with zero Grid config.

## Round-trip (without tools-host)

```bash
# 1. PUT a document with real frontmatter
curl -sS -X PUT http://127.0.0.1:8788/lmx-social/post-1839 \
  --data-binary @- <<'EOF'
---
post_id: "1839"
timestamp: "2026-08-20T14:00:00Z"
likes: 142
tags: [engagement, weekday]
---

Posts published 2-4pm on weekdays are outperforming the morning slot by ~30%.
EOF

# 2. GET it back — identical markdown
curl -sS http://127.0.0.1:8788/lmx-social/post-1839

# 3. PUT two more into the same namespace
curl -sS -X PUT http://127.0.0.1:8788/lmx-social/post-1840 \
  --data-binary @- <<'EOF'
---
post_id: "1840"
likes: 12
tags: [morning]
---

Morning slot underperformed.
EOF

curl -sS -X PUT http://127.0.0.1:8788/lmx-social/post-1841 \
  --data-binary @- <<'EOF'
---
post_id: "1841"
likes: 88
tags: [engagement, weekend]
---

Weekend engagement held up.
EOF

# 4. Query — only documents whose tags contain "engagement"
curl -sS -X POST http://127.0.0.1:8788/lmx-social/query \
  -H "Content-Type: application/json" \
  -d '{"filter":{"tags":"engagement"}}'

# 5. Semantic search — no shared keywords with the target note.
#    "when is the best time of day to publish?" should rank post-1839
#    (2-4pm weekdays outperforming morning) first. Frontmatter filter
#    cannot answer this; the note never uses those query words.
curl -sS -X POST http://127.0.0.1:8788/lmx-social/search \
  -H "Content-Type: application/json" \
  -d '{"query":"when is the best time of day to publish?","top_k":3}'
```

## Env vars (this package's `.env` only)

| Variable | Default | Role |
|---|---|---|
| `DATABASE_URL` | (unset → SQLite) | Postgres connection; never the repo-root LMX database |
| `PORT` / `HOST` | `8788` / `0.0.0.0` | listen address |
| `LMX_API_URL` | `https://api.lmxcloud.io` | Grid — **consolidation only** |
| `LMX_API_KEY` | — | Grid Bearer key — **consolidation only**. This service does not mint keys. |
| `LMX_MODEL` | `mistral-nemo` | chat model for consolidation |

## Consolidation round-trip

Needs `LMX_API_KEY` in `apps/tools/lmx-tool-storage/.env`. Seed related + conflicting notes, fold them, then GET the reflection and one annotated original.

```bash
# 1. Related notes (including a near-duplicate of the weekday slot)
curl -sS -X PUT http://127.0.0.1:8788/demo-consolidate/post-1839 \
  --data-binary @- <<'EOF'
---
kind: observation
timestamp: "2026-08-20T14:00:00Z"
tags: [engagement, weekday]
---

Posts published 2-4pm on weekdays are outperforming the morning slot by ~30%.
EOF

curl -sS -X PUT http://127.0.0.1:8788/demo-consolidate/post-1839-dup \
  --data-binary @- <<'EOF'
---
kind: observation
timestamp: "2026-08-21T14:00:00Z"
tags: [engagement, weekday]
---

Weekday afternoon (2-4pm) posts beat the morning slot by about 30%.
EOF

# 2. A later note that contradicts the slot, plus one durable side fact
curl -sS -X PUT http://127.0.0.1:8788/demo-consolidate/post-1901 \
  --data-binary @- <<'EOF'
---
kind: observation
timestamp: "2026-08-27T09:00:00Z"
tags: [engagement, morning]
---

Morning is actually the best time now — the 2-4pm weekday slot dropped off.
EOF

curl -sS -X PUT http://127.0.0.1:8788/demo-consolidate/post-1841 \
  --data-binary @- <<'EOF'
---
kind: observation
timestamp: "2026-08-22T18:00:00Z"
tags: [engagement, weekend]
---

Weekend engagement held up.
EOF

# 3. Fold them. Response includes the new reflection key and which originals it superseded.
curl -sS -X POST http://127.0.0.1:8788/demo-consolidate/consolidate

# Example shape (keys and prose will vary):
# {
#   "ok": true,
#   "namespace": "demo-consolidate",
#   "reflection": {
#     "key": "reflection-2026-09-02T20-00-00-000Z",
#     "frontmatter": {
#       "kind": "reflection",
#       "timestamp": "2026-09-02T20:00:00.000Z",
#       "supersedes": ["post-1839", "post-1839-dup", "post-1901", "post-1841"]
#     },
#     "body": "...morning is now the stronger slot; earlier 2-4pm weekday claim is superseded; weekend engagement held up..."
#   },
#   "superseded": [
#     { "key": "post-1839", "superseded_by": "reflection-2026-09-02T20-00-00-000Z" }
#   ],
#   "clusters": [
#     { "keys": ["post-1839", "post-1839-dup"], "near_duplicates": true }
#   ]
# }

# 4. GET the reflection — kind: reflection, supersedes: [...]
curl -sS http://127.0.0.1:8788/demo-consolidate/reflection-2026-09-02T20-00-00-000Z

# 5. GET a superseded original — still stored, now annotated, never deleted
curl -sS http://127.0.0.1:8788/demo-consolidate/post-1839
# ---
# kind: observation
# ...
# superseded_by: reflection-2026-09-02T20-00-00-000Z
# ---
#
# Posts published 2-4pm on weekdays are outperforming the morning slot by ~30%.
```
