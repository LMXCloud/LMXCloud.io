# Cursor Prompt — Inference Router Reliability Fix (production incident, 2026-08-11)

## Context

`GET /v1/status` on production (`https://api.lmxcloud.io`), checked 2026-08-11, shows the core inference router — the actual product, not a side tool — succeeding on roughly 1 in 6 chat completion requests:

- 7-day overall success rate: **17.44% (15/86 attempts)**
- **Aethir**: fully down (health check failing, no latency reported)
- **Akash**: gateway health check reports healthy, but **0% real chat success (0/35 attempts)**
- **io.net** (tier 1, primary): **29.41% success (15/51 attempts)** at 2,878ms avg latency

The fallback chain (`registry.ts`, `apps/api/src/providers/*`) is currently a static tier order — `io.net → Akash → Aethir` — not weighted by actual success rate. That's the exact "weight routing by historical signals" follow-up already flagged in ROADMAP.md under the three-tier health signals work (shipped 2026-07-19) and never built. The result: most traffic goes to io.net regardless of its live ~29% success rate, and Akash's gateway-ping-says-healthy-but-real-calls-all-fail gap goes undetected by the routing logic even though the data to detect it (`provider_health_checks`, `getProviderHealthHistory`, `real_traffic` merge) already exists.

## What to do

1. **Root-cause first, don't just patch routing blind.** Check Railway logs and Sentry for the actual failure mode on io.net and Akash chat completions over the last 7 days — timeouts, upstream errors, auth failures, rate limits, connection resets. Confirm whether this is an upstream provider-side outage, an LMX-side timeout/connection-handling regression, or something introduced by the 2026-08-11 `extract_pdf` / `apps/tools/host` ship. Don't assume cause before checking.

2. **Make routing decisions use the real-traffic/synthetic success-rate data that's already being collected, not just the 30s gateway `/models` ping.** A provider that's gateway-healthy but has near-zero real chat success (like Akash right now) should not keep receiving primary traffic. Use `provider_health_checks` (`gateway` / `synthetic_completion` / real `usage_events`) as the actual routing signal — rolling window, your call on exact weighting — instead of (or in addition to) the current gateway-only health check that drives in-memory routing.

3. **Add a circuit breaker / fast-demote for a provider whose recent real success rate craters**, so a provider like Akash (0/35) or Aethir (fully down) stops eating traffic and retry time immediately instead of waiting for a manual fix or a slow rolling average to catch up.

4. **Surface this on `StatusPage.tsx` / `/v1/status` in a way that would have made this obvious sooner** — e.g., a visible "real success rate" per provider alongside the existing gateway/synthetic signals, not just in raw health-check numbers a human has to interpret.

5. **Alert on this.** There's already Sentry + a Telegram ops-alert pattern elsewhere in this codebase — wire a threshold alert (e.g., rolling chat success rate below some floor, or a provider fully down) so a collapse like this is caught within minutes, not discovered by someone dogfooding a side feature.

## Constraints

- This is the production API — verify changes against real behavior (a mainnet/production-safe check, not just local), and don't ship anything that could make routing worse under partial data (e.g., a provider with very few recent attempts shouldn't get unfairly blacklisted off a tiny sample).
- Keep the existing three-tier signal architecture (`gateway` / `synthetic_completion` / `real_traffic`) — this is about using it for routing decisions and circuit-breaking, not replacing it.
- Don't touch pricing, credits, or x402 settlement logic — this is scoped to provider selection and health/alerting.

## Reference

`ROADMAP.md` → "Platform Sprint 0 — Compute reliability depth (Goal 0)" item 7 (2026-08-11 incident entry) has the full numbers and context. Relevant files: `apps/api/src/providers/*`, `apps/api/src/registry.ts` (or wherever the fallback chain/routing logic lives), `apps/api/src/routes/chat.ts`, `apps/api/src/routes/status.ts` (or equivalent), `StatusPage.tsx`.
