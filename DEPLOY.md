# Deploy LMX Cloud

Ship the API on **Railway** and the demo UI on **Vercel**. Total time: ~30 minutes.

## Prerequisites

- GitHub repo with this code pushed
- [Railway](https://railway.app) account
- [Vercel](https://vercel.com) account
- io.net API key (required); AkashML key optional but recommended for the DePIN demo

---

## Step 1 — Push to GitHub

If you haven't initialized git yet:

```powershell
cd C:\Users\jline\OneDrive\Desktop\LMXCloud.io
git init
git add .
git commit -m "LMX Cloud API + demo UI"
```

Create a repo on GitHub, then:

```powershell
git remote add origin https://github.com/YOUR_USER/LMXCloud.io.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Deploy API (Railway)

1. Go to [railway.app/new](https://railway.app/new) → **Deploy from GitHub repo**
2. Select your `LMXCloud.io` repository
3. Railway detects the `Dockerfile` and `railway.toml` at the repo root
4. **Variables** — add these (copy values from your local `.env`):

   | Variable | Required | Example |
   |----------|----------|---------|
   | `IONET_API_KEY` | Yes | `io-...` |
   | `AKASHML_API_KEY` | Recommended | `akml-...` |
   | `PORT` | Auto-set by Railway | (leave default) |
   | `HOST` | No | `0.0.0.0` |
   | `KEY_GEN_RATE_LIMIT_MAX` | No | `10` |
   | `KEY_GEN_RATE_LIMIT_WINDOW_MS` | No | `3600000` |

5. **Settings → Networking → Generate Domain** — note the URL, e.g. `https://lmxcloud-api-production.up.railway.app`
6. Optional: add custom domain `api.lmxcloud.io` (CNAME to Railway)

### Persist API keys (recommended)

Without a volume, keys reset on every deploy.

1. Railway → your service → **Volumes** → Add volume, mount path `/data`
2. Set variable: `API_KEYS_FILE=/data/api-keys.json`

### Verify API

```powershell
Invoke-RestMethod -Uri "https://YOUR-RAILWAY-URL/health"
Invoke-RestMethod -Uri "https://YOUR-RAILWAY-URL/v1/status"
```

---

## Step 3 — Deploy Demo (Vercel)

1. Go to [vercel.com/new](https://vercel.com/new) → Import your GitHub repo
2. **Root Directory:** `apps/demo` (click Edit, set to `apps/demo`)
3. Framework preset: **Vite** (auto-detected)
4. **Environment variables:**

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | Your Railway API URL (no trailing slash) |
   | `VITE_GITHUB_URL` | Optional — your repo URL |
   | `VITE_DOCS_URL` | Optional — docs URL when ready |

5. Deploy

Vercel uses `apps/demo/vercel.json` for monorepo install/build commands.

### Verify demo

1. Open your Vercel URL
2. Health panel shows live providers
3. Generate API Key → Send with `default` route
4. Switch to `provider:akash` or `cheapest` → Send again → provider changes in response

---

## Step 4 — Custom domains (optional)

| Service | Domain | Points to |
|---------|--------|-----------|
| API | `api.lmxcloud.io` | Railway CNAME |
| Demo | `demo.lmxcloud.io` | Vercel |

Update `VITE_API_URL` on Vercel to `https://api.lmxcloud.io` after DNS propagates.

---

## Local production smoke test

Before deploying, verify the Docker image builds:

```powershell
docker build -t lmxcloud-api .
docker run --rm -p 3000:3000 --env-file .env lmxcloud-api
```

Demo production build:

```powershell
pnpm build:demo
pnpm --filter @lmxcloud/demo preview
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Demo shows "offline" health | Check `VITE_API_URL` matches Railway URL; redeploy Vercel after changing |
| Provider shows `unknown` | API must expose CORS headers (already configured in `server.ts`) |
| Key gen returns 429 | Rate limit hit — 10 keys/hour/IP by default |
| Keys stop working after redeploy | Add Railway volume at `/data` + `API_KEYS_FILE` |
| CORS errors | Ensure demo origin is allowed; API uses `origin: true` (all origins) |

---

## What ships in this stack

- **API:** Multi-provider DePIN router, health monitor, key auth, rate-limited key generation
- **Demo:** Single-page try-it-now UI with provider transparency
- **Not included yet:** Usage dashboard, payments, streaming, user accounts (Week 3–4)
