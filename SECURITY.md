# Security — LMX Cloud

External/reference summary of how production traffic is protected today. For the working log of decisions and in-progress state, see `ROADMAP.md` (especially **Known gaps / needs hardening** and **Cloudflare edge hardening**). Deploy steps and env vars live in `DEPLOY.md`.

**Scope of this pass:** edge protection for the API and MCP services on Railway (`api.lmxcloud.io`, `mcp.lmxcloud.io`). The dashboard on Vercel is out of scope for Cloudflare hardening — it already sits behind Vercel's edge and is Clerk-gated.

---

## Edge protection (Cloudflare)

- `lmxcloud.io` is registered directly through Cloudflare Registrar. DNS has been on Cloudflare since day one (no nameserver migration).
- `api.lmxcloud.io` and `mcp.lmxcloud.io` are **proxied** through Cloudflare (orange-cloud) to Railway.
- The dashboard (`www.lmxcloud.io` / `lmxcloud.io`) points at Vercel **unproxied** (DNS only) — Vercel provides its own edge network.
- SSL/TLS mode: **Full (Strict)** (Railway terminates TLS on its own domain).
- DDoS protection: on by default at the Cloudflare edge (Free plan).

---

## Rate limiting

Two layers. Exceeded application limits return HTTP **429** with a `Retry-After` header.

| Layer | Where | What |
|-------|--------|------|
| Edge | Cloudflare rule `auth-key-limit` | Blocks an IP after **10 requests/hour** to `POST /v1/auth/key` (the one unauthenticated route), for **1 hour** |
| App | In-memory limiter (`apps/api/src/rate-limit.ts`) | Defaults: **5 requests/hour per IP** on key mint and SIWE (`KEY_GEN_RATE_LIMIT_MAX`); **30 requests/minute per API key** on balance-funded chat (`CHAT_RATE_LIMIT_MAX`); **10 requests/minute per x402 payer wallet** (or IP if the payer is unknown; `X402_ANON_RATE_LIMIT_MAX`) |

The Cloudflare rule is a second layer on top of the app limiter. Edge rules survive Railway redeploys and still apply if the API scales past a single instance; the in-memory app limiter does not (it resets on deploy and is not shared across instances).

---

## Origin lock

Raw Railway hostnames (`*.up.railway.app`) still resolve if someone knows them. Origin lock makes those URLs useless for API/MCP traffic unless the request came through Cloudflare.

| Piece | Detail |
|-------|--------|
| Code | `apps/api/src/origin-lock.ts`, `apps/mcp-server/src/origin-lock.ts` |
| Header | Cloudflare Request Header Transform Rule injects `X-Origin-Secret` on every request forwarded to `api.lmxcloud.io` / `mcp.lmxcloud.io` |
| Env | App compares the header (timing-safe) to `LMX_ORIGIN_SECRET` on Railway |
| Fail closed | Missing or wrong header → **403** |
| Exempt | `/health` (API) and `/healthz` (MCP) so Railway healthchecks keep working |
| Local / pre-edge | Check **no-ops** when `LMX_ORIGIN_SECRET` is unset |

> Cloudflare rejects Transform Rules that set headers starting with `Cf-` (reserved). Use `X-Origin-Secret`, not `Cf-Origin-Secret`.

**Verified live (API, 2026-07-12):** raw `*.up.railway.app` blocked on non-health routes; `api.lmxcloud.io` through Cloudflare unaffected. **MCP not yet verified live** — blocked on a Railway plan limit (see Known gaps).

Setup: `DEPLOY.md` → **Cloudflare origin lock**.

---

## Known gaps / deferred

These are **conscious tradeoffs**, not oversights. Revisit before Distribution Sprint 4 listing (public agent discovery) unless noted otherwise.

| Gap | Status | Why deferred / what to do |
|-----|--------|---------------------------|
| **WAF** (Cloudflare OWASP Managed Ruleset) | Not enabled (as of 2026-07-12) | Requires Cloudflare Pro (~$20/mo). Relying on edge rate limiting + default DDoS protection for now. Revisit before Sprint 4 listing if budget allows. |
| **`mcp.lmxcloud.io` custom domain** | Not on Railway yet | Trial plan caps custom domains at **1** account-wide. Origin-lock code is deployed to the MCP service but cannot be verified end-to-end until Railway is upgraded (Hobby, ~$5/mo) and the custom domain is attached. |
| **Bot Fight Mode / Super Bot Fight Mode** | Status not explicitly confirmed | Should stay **OFF** on API/MCP. Legitimate traffic is autonomous agents (no browser, no human) — aggressive bot scoring is a footgun for Sprint 4's goal. DDoS + WAF (when enabled) are safe; bot scoring is not. |
| **In-memory rate limiter + SIWE nonce store** | Fine for single-instance beta | Resets on deploy; ineffective across multiple Railway instances. Cloudflare edge rate limiting partially mitigates for the auth-key path only. Real fix before multi-instance scale: Redis-backed (or equivalent) limiter and nonce store. |

Related ops/security items tracked in `ROADMAP.md` (not duplicated here in full): uptime monitoring confirmation, x402 mainnet canary / abuse load validation, payment failure reconciliation beyond middleware cancel, streaming deduct edge cases, and counsel review of published legal drafts before public listing.

---

## Reporting

If you believe you've found a vulnerability in LMX Cloud, please open a private report via GitHub Security Advisories on this repository (or contact the maintainers through the channels listed on [lmxcloud.io](https://lmxcloud.io)). Do not open a public issue for exploitable findings.
