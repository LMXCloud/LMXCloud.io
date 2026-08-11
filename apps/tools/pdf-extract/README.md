# @lmxcloud/pdf-extract

Minimal HTTP tool that extracts text (and light structure) from a PDF.

In production and typical local multi-tool runs, this app is mounted by `@lmxcloud/tools-host` at `/pdf-extract` (see [`apps/tools/README.md`](../README.md)). Standalone mode below is still useful for tool-only development.

## What it exposes

Routes are relative to the mount prefix (standalone root, or `/pdf-extract` behind the host).

| Route | Method | Auth |
|-------|--------|------|
| `/health` | `GET` | Public |
| `/extract` | `POST` | Public (settlement gate TBD) |

### `POST /extract`

- Multipart form field: `file` (a PDF)
- Returns JSON: `{ text, pageCount, title, headings }`

## Environment variables

- `PORT` (default: `8787` standalone)
- `HOST` (default: `0.0.0.0`)

## Local dev (standalone)

```bash
pnpm --filter @lmxcloud/pdf-extract dev
# or: pnpm dev:pdf-extract
```

- Health: `http://127.0.0.1:8787/health`
- Extract: `curl -F file=@sample.pdf http://127.0.0.1:8787/extract`

## Via tools-host

```bash
pnpm dev:tools-host
```

- Health: `http://127.0.0.1:8080/pdf-extract/health`
- Extract: `curl -F file=@sample.pdf http://127.0.0.1:8080/pdf-extract/extract`

MCP clients should set `PDF_EXTRACT_URL` to the tool base URL (no trailing slash):

- Host: `http://127.0.0.1:8080/pdf-extract`
- Standalone: `http://127.0.0.1:8787`

## Build / start

```bash
pnpm --filter @lmxcloud/pdf-extract build
pnpm --filter @lmxcloud/pdf-extract start
```

The Hono app is exported as `@lmxcloud/pdf-extract/app` for the shared host.
