# @lmxcloud/pdf-extract

Minimal HTTP tool that extracts text (and light structure) from a PDF.

## What it exposes

| Route | Method | Auth |
|-------|--------|------|
| `/health` | `GET` | Public |
| `/extract` | `POST` | Public (settlement gate TBD) |

### `POST /extract`

- Multipart form field: `file` (a PDF)
- Returns JSON: `{ text, pageCount, title, headings }`

## Environment variables

- `PORT` (default: `8787`)
- `HOST` (default: `0.0.0.0`)

## Local dev

```bash
pnpm --filter @lmxcloud/pdf-extract dev
```

- Health: `http://127.0.0.1:8787/health`
- Extract: `curl -F file=@sample.pdf http://127.0.0.1:8787/extract`

## Build / start

```bash
pnpm --filter @lmxcloud/pdf-extract build
pnpm --filter @lmxcloud/pdf-extract start
```

The Hono app in `src/app.ts` is also mountable under a path prefix (e.g. `/pdf-extract`) if a shared tools gateway is added later. Not wired into `@lmxcloud/mcp-server` yet.
