# Deploy LMX Cloud

Ship the **API on Railway** and the **dashboard + demo on Vercel**.

| App | Host | Root directory |
|-----|------|----------------|
| API | Railway | repo root (`Dockerfile`) |
| MCP Server | Railway | repo root + `apps/mcp-server/railway.toml` |
| Dashboard | Vercel | `apps/web` |
| Demo (optional) | Vercel | `apps/demo` |

---

## Prerequisites

- Code pushed to GitHub ([johnny-lineen/LMXCloud.io](https://github.com/johnny-lineen/LMXCloud.io))
- [Neon](https://console.neon.tech) Postgres (`DATABASE_URL`) — survives Railway account changes
- [Clerk](https://dashboard.clerk.com) app for dashboard sign-in
- io.net API key (required)

---

## Railway: new account (out of credits)

If your current Railway account has no credits left, use a **fresh account** — same repo, new billing identity:

1. Sign out of [railway.app](https://railway.app)
2. Sign up with a **different email** (or a Google/GitHub account not linked to the old Railway account)
3. New accounts get a **$5 trial** (30 days) — enough for a small API service
4. **Do not** delete your Neon database — `DATABASE_URL` points to Neon, not Railway, so keys and usage carry over

> **Tip:** Keep Postgres on Neon (already set up). Railway only runs the API container; you are not locked to one Railway account for data.

### Deploy API

1. [railway.app/new](https://railway.app/new) → **Deploy from GitHub repo**
2. Select `LMXCloud.io` — Railway reads `Dockerfile` + `railway.toml` at the repo root
3. **Variables** tab — add:

   | Variable | Required | Notes |
   |----------|----------|-------|
   | `IONET_API_KEY` | Yes | From [ai.io.net](https://ai.io.net/ai/api-keys) |
   | `AKASHML_API_KEY` | Recommended | DePIN fallback |
   | `DATABASE_URL` | Yes | Neon pooled connection string |
   | `CLERK_SECRET_KEY` | Yes | Clerk → API keys → Secret key |
   | `SESSION_SECRET` | Yes | Random 32+ char string (e.g. `openssl rand -hex 32`) |
   | `SENTRY_DSN` | No | Sentry project DSN for API error reporting |
   | `HOST` | No | `0.0.0.0` (default) |
   | `INITIAL_CREDIT_BALANCE` | No | `1` |
   | `CREDITS_ALLOW_SELF_TOPUP` | No | `false` in production |
   | `KEY_GEN_RATE_LIMIT_MAX` | No | `5` (conservative free-beta default) |
   | `KEY_GEN_RATE_LIMIT_WINDOW_MS` | No | `3600000` |
   | `CHAT_RATE_LIMIT_MAX` | No | `30` (conservative free-beta default) |
   | `SIWE_DOMAIN` | Yes (wallet auth) | e.g. `lmxcloud.io` |
   | `SIWE_URI` | Yes (wallet auth) | e.g. `https://lmxcloud.io` |
   | `SIWE_CHAIN_ID` | No | `8453` (Base mainnet) |
   | `BASE_RPC_URL` | Yes (deposits) | Alchemy/Infura Base RPC |
   | `TREASURY_ADDRESS` | Yes (deposits) | Wallet that receives USDC |
   | `USDC_CONTRACT_ADDRESS` | No | Mainnet default `0x833589…2913` |
   | `DEPOSIT_CONFIRMATIONS` | No | `10` |
   | `DEPOSIT_MAX_USDC` | No | `10000` per transfer |

   Do **not** set `PORT` — Railway injects it automatically.

4. **Settings → Networking → Generate Domain** — copy the URL, e.g. `https://lmxcloud-api-production.up.railway.app`
5. Optional: custom domain `api.lmxcloud.io` (CNAME to Railway)

### Verify API

```powershell
Invoke-RestMethod -Uri "https://YOUR-RAILWAY-URL/health"
Invoke-RestMethod -Uri "https://YOUR-RAILWAY-URL/v1/status"
```

---

## Railway: MCP server (`apps/mcp-server`)

Deploy MCP as a separate service so agent traffic does not couple to API container restarts.

1. In Railway, create **New Service** from the same GitHub repo.
2. Configure service to use `apps/mcp-server/railway.toml`.
3. Add variables:

   | Variable | Required | Notes |
   |----------|----------|-------|
   | `LMX_MCP_TRANSPORT` | Yes | `http` |
   | `LMX_MCP_HOST` | Yes | `0.0.0.0` |
   | `LMX_MCP_PORT` | Yes | `3334` |
   | `LMX_API_BASE_URL` | Yes | Public API base URL (e.g. `https://api.lmxcloud.io`) |
   | `LMX_API_KEY` | Yes | Service API key used for MCP tool calls |
   | `LMX_DEFAULT_MODEL` | No | `deepseek-v3.2` |

4. Generate a Railway domain (example: `https://lmxcloud-mcp-production.up.railway.app`).
5. Optional custom domain: `mcp.lmxcloud.io`.

### Verify MCP service

```powershell
Invoke-RestMethod -Uri "https://YOUR-MCP-URL/healthz"
```

Expected response:

```json
{"ok":true,"transport":"http","endpoint":"/mcp"}
```

---

## Vercel: dashboard (`apps/web`)

1. [vercel.com/new](https://vercel.com/new) → Import `LMXCloud.io`
2. **Root Directory:** `apps/web` (Edit → set path)
3. Framework: **Vite** (auto-detected; `vercel.json` handles monorepo build)
4. **Environment variables:**

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | Railway API URL (no trailing slash) |
   | `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_test_...` or `pk_live_...`) |
   | `VITE_CHAIN_ID` | Must match API `SIWE_CHAIN_ID` (`8453` mainnet) |
   | `VITE_BASE_RPC_URL` | Recommended — same Base RPC as API for reliable balance reads |
   | `VITE_DEMO_URL` | Optional — Vercel demo URL if you deploy `apps/demo` |

5. Deploy

### Clerk dashboard settings

In [Clerk](https://dashboard.clerk.com) → your app → **Configure**:

- **Paths:** set sign-in `/sign-in`, sign-up `/sign-up`, after sign-in `/auth/callback`
- **Domains → Allowed redirect URLs:** add your Vercel URL, e.g. `https://your-app.vercel.app/*`
- **Allowed origins:** same Vercel URL

Redeploy Vercel after changing env vars (Vite bakes `VITE_*` at build time).

### Verify dashboard

1. Open Vercel URL → Sign up / Sign in
2. Console loads overview, keys, usage
3. Generate a key and run a test chat from the landing page

---

## Vercel: demo (optional, `apps/demo`)

1. New Vercel project → same repo, **Root Directory:** `apps/demo`
2. Env: `VITE_API_URL` = Railway API URL
3. Deploy

---

## Custom domains (optional)

| Service | Domain | Points to |
|---------|--------|-----------|
| API | `api.lmxcloud.io` | Railway CNAME |
| Dashboard | `lmxcloud.io` or `app.lmxcloud.io` | Vercel |
| Demo | `demo.lmxcloud.io` | Vercel |

After DNS propagates, update `VITE_API_URL` on Vercel and Clerk allowed URLs.

---

## Push latest code first

Railway and Vercel deploy from GitHub. Commit and push before deploying:

```powershell
git add .
git commit -m "Prepare for production deploy"
git push origin main
```

---

## Local smoke test

```powershell
docker build -t lmxcloud-api .
docker run --rm -p 3000:3000 --env-file .env lmxcloud-api
```

```powershell
pnpm build:web
pnpm --filter @lmxcloud/web preview
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard shows Clerk error | Set `VITE_CLERK_PUBLISHABLE_KEY` on Vercel (not `NEXT_PUBLIC_*`) |
| Sign-in redirects fail | Add Vercel URL to Clerk allowed redirect URLs |
| `POST /v1/auth/clerk` returns 503 | Set `CLERK_SECRET_KEY` on Railway |
| Health panel offline | `VITE_API_URL` must match Railway URL; redeploy Vercel |
| Keys lost after redeploy | Use `DATABASE_URL` (Neon), not file storage |
| Railway build fails | Ensure `pnpm-lock.yaml` is committed; check build logs |
| CORS errors | API allows all origins (`origin: true` in `server.ts`) |
| Out of Railway credits | New Railway account + same Neon `DATABASE_URL` |

---

## Cost notes

- **Neon:** free tier for dev/small prod
- **Vercel:** free tier for static sites
- **Railway:** ~$5/mo after trial; new email = new $5 trial
- **Clerk:** free tier for moderate MAU
