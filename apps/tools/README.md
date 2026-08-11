# Tools

Each tool is a workspace package under `apps/tools/*` that exports a Hono app (`./app`). The shared host (`apps/tools/host`, `@lmxcloud/tools-host`) mounts those apps under path prefixes and is what gets deployed.

| Package | Mount | Standalone default port |
|---------|-------|-------------------------|
| `@lmxcloud/pdf-extract` | `/pdf-extract` | `8787` |
| `@lmxcloud/tools-host` | — (root `/health`) | `8080` |

## Local run

```bash
# Preferred — all mounted tools on one process
pnpm dev:tools-host

# Single-tool iteration (no host)
pnpm dev:pdf-extract
```

Host checks:

- `GET http://127.0.0.1:8080/health` → `{ ok: true, tools: ["pdf-extract"] }`
- `GET http://127.0.0.1:8080/pdf-extract/health`
- `POST http://127.0.0.1:8080/pdf-extract/extract` (multipart `file`)

## Deploy

Railway service uses `apps/tools/host/railway.toml` (Dockerfile builds pdf-extract + host). After deploy, point MCP at:

`PDF_EXTRACT_URL=https://<tools-host-domain>/pdf-extract`

Settlement/auth gating is deliberately deferred — add it on each tool app before public billing.

## How to add tool #2

1. Copy `apps/tools/_template` to `apps/tools/<name>` and rename the package in `package.json`.
2. Build the tool logic in `src/app.ts` (keep routes relative — no mount prefix).
3. In `apps/tools/host`: add a dependency on the new package, then one import + one `.route()` line in `src/index.ts`. Update the host `/health` `tools` list.

That's it.
