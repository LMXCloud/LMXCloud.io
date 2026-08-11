# Cursor prompt — Sentry test-error verification route

Goal: prove `SENTRY_DSN` is actually set and working in the production Railway
environment, not just wired in code. Right now `apps/api/src/server.ts`
(~L68-75) only calls `Sentry.init()` if `process.env.SENTRY_DSN` is present,
and the global error handler (~L106-109) calls `Sentry.captureException`
on unhandled errors — but nobody has confirmed a real event has ever landed
in the Sentry project dashboard from prod.

Add a way to deliberately trigger a real, safe error in production and
confirm it shows up in Sentry, gated the same way the rest of `/v1/ops/*`
already is (see `apps/api/src/ops/` — reuse whatever auth check those routes
use, keyed on `LMX_OPS_API_KEY`, so this can't be hit by the public).

Constraints:
- Must actually throw/error in a way that reaches the existing
  `app.setErrorHandler` path (or call `Sentry.captureException` directly —
  your call which is more representative of a real failure).
- Must not be reachable without ops auth.
- Should return something useful in the response (e.g. confirmation that
  Sentry.captureException was invoked, plus whether SENTRY_DSN is set at all)
  so a curl from the terminal is enough to check — no need to also open the
  Sentry dashboard just to know the call fired.

Once it's in, I'll hit it against `https://api.lmxcloud.io` with the ops key
and check the Sentry issues feed for the event.
