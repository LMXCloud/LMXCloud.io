# Cursor prompt — stop IP-spoofed rate-limit bypass

Goal: right now a client can bypass our per-IP rate limits (key generation,
wallet auth, anonymous x402 chat) just by setting their own
`X-Forwarded-For` header. Fix the IP derivation so it can't be spoofed
through Cloudflare.

Where this lives:
- `apps/api/src/server.ts` (~L58) — Fastify is built with `trustProxy: true`,
  which trusts the entire `X-Forwarded-For` chain via `proxy-addr`. Depending
  on how Cloudflare appends vs. forwards that header, Fastify may end up
  picking the attacker-supplied leftmost value instead of the real
  edge-observed client IP.
- `apps/api/src/routes/auth.ts` (~L229, ~L274, ~L359) — three call sites use
  `request.ip` directly as the rate-limit key for `POST /v1/auth/key`,
  `POST /v1/auth/wallet/nonce`, and `POST /v1/auth/wallet/verify`.
- `apps/api/src/routes/chat.ts` (~L76-80, `x402RateLimitKey`) — falls back to
  `` `x402:ip:${request.ip}` `` for anonymous x402 chat requests with no
  payer wallet in the payload.

Note: there's already an `origin-lock` hook (`apps/api/src/origin-lock.ts`,
gated on `LMX_ORIGIN_SECRET`) that rejects requests not routed through
Cloudflare via a shared-secret header. That's a separate, complementary
control — it proves the request came through our Cloudflare zone, but it
does not fix *which* IP Fastify derives from the proxy chain once the
request is confirmed to be Cloudflare-routed. Don't remove or weaken it;
this fix is additional.

The actual bug: Cloudflare sets `CF-Connecting-IP` itself on every request
that passes through it, and that header cannot be spoofed by the client
(Cloudflare overwrites it at the edge) — but nothing in this codebase reads
it. All four rate-limit call sites trust Fastify's derived `request.ip`
instead, which is only as trustworthy as `trustProxy: true` + whatever
`X-Forwarded-For` value made it through.

What "fixed" looks like: all four rate-limit key derivations should prefer
`CF-Connecting-IP` when present, falling back to `request.ip` when it's
not (local dev, or any environment not yet sitting behind Cloudflare).
A single shared helper used at all four call sites is probably cleaner than
four inline fixes, but use your judgment — you know this codebase's
conventions better than I'm prescribing here.

Constraints:
- Don't change `trustProxy: true` itself unless you have a specific reason —
  the CORS/other logic in `server.ts` may depend on Fastify's normal proxy
  handling elsewhere; the safer fix is what key the *rate limiter* uses, not
  ripping out proxy trust wholesale.
- Local dev (no Cloudflare in front) must keep working — don't hard-require
  `CF-Connecting-IP` and break `pnpm dev`.
- Don't change the rate limiter's own logic (`apps/api/src/rate-limit.ts`) —
  it's key-agnostic and fine as-is; this is purely about what string gets
  passed in as the key.

Once it's in, I'll want to verify by sending requests with a forged
`X-Forwarded-For` header against a rate-limited route (e.g. hammering
`POST /v1/auth/key` past the 5/hour limit) and confirming the limit still
trips instead of resetting per fake IP.
