# LMX Cloud — Path to Public Beta

Goal: go from working proof-of-concept (Phase 1-7) to something you can hand to strangers — developers trying it for free — without it breaking, leaking data, or embarrassing you. Target: 3-4 weeks. Payments are out of scope for this phase (free beta); pricing/billing becomes Phase 9+ once there's real usage signal.

## Where things actually stand

The core is real: multi-provider routing with fallback, health monitoring, per-key usage tracking, credit balances, and a full dashboard (`apps/web`) are all built and working locally. What's missing isn't features — it's the stuff that only matters once people outside your machine are using it.

Two things found in the audit that should jump the queue:

1. **Login is email-only, no verification.** `POST /v1/auth/login` in `apps/api/src/routes/auth.ts` issues a valid session token to anyone who submits an email address that has an account — no password, no magic link, no OTP. Right now, anyone who knows (or guesses) a beta user's email can log into their dashboard and see their keys, usage, and balance. This has to close before you send the signup link to anyone you don't personally trust.
2. **Nothing is deployed yet.** DEPLOY.md is written but unexecuted — API keys and data currently live only on your machine. Every day this stays local is a day you can't send anyone a link.

## Week 1 — Deploy for real, close the security gap

- **Fix login.** Cheapest correct option for a free beta: passwordless magic-link email (send a signed, short-lived link instead of trusting a bare email string). Alternative if you want to ship faster: require the original API key as a second factor to establish a session, and clearly label the dashboard as "share your API key with no one." Pick one — don't ship the current version to outsiders.
- **Rotate `SESSION_SECRET`** off the `change-me-in-production` default before deploying anywhere.
- **Deploy API to Railway, dashboard + demo to Vercel**, following DEPLOY.md. Confirm `DATABASE_URL` (Neon) is set so keys/usage persist across restarts — don't launch on file storage.
- **Add error monitoring** (Sentry free tier is enough) and a **basic uptime check** (UptimeRobot / Better Stack) on the API health endpoint. You want to know the router is down before a beta user tells you.
- **Re-check rate limits** for a public audience: `KEY_GEN_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_MAX`, and `INITIAL_CREDIT_BALANCE` currently assume trusted local testing. Decide what stops one person from spinning up 500 keys or draining provider budget in an afternoon.
- **CORS is currently `origin: true`** (allows any site to call the API from a browser). Fine for the demo's cross-origin design, but confirm this is intentional and not just unset — document it either way.

## Week 2 — Make it usable by someone who isn't you

- **Write real API docs** — a docs page or even a well-organized `/docs` markdown, not just the README's PowerShell snippets. Include a curl example (most devs aren't on PowerShell) and a "get a key and get a response in under 60 seconds" quickstart.
- **Add streaming support** to `/v1/chat/completions`. This was flagged as missing in DEPLOY.md and matters a lot for real usage — most chat UIs and SDKs expect streamed tokens, and its absence will be the first thing a technical evaluator notices.
- **Expand model coverage.** Only `llama-3-70b` is aliased today. Add 2-3 more popular models across whichever providers are live (io.net, AkashML) so the router looks like infrastructure, not a single-model demo.
- **Polish the signup → key → first request flow** in `apps/web` and `apps/demo`. Walk through it yourself as a stranger would: confusing error states, unclear balance/cost display, or a broken step here will lose people before they see the product work.
- **Public status page.** You already compute provider health for `/v1/status` — surface it as a simple public page. For a DePIN pitch, visible uptime/fallback transparency is part of the trust story, not just an internal debugging tool.

## Week 3 — Trust and support basics

- **Terms of Service + Privacy Policy.** Minimal but real — you're collecting emails and usage data from strangers. A generated template (e.g. via a ToS generator or a lawyer-reviewed boilerplate) is enough for a free beta; don't skip it entirely.
- **Acceptable use / abuse policy.** One paragraph: no illegal content, no key sharing/resale, rate limits are enforced, accounts can be revoked. Link it from signup.
- **A feedback channel.** Discord server, a shared email, or a Typeform — something lower-friction than "open a GitHub issue" for non-technical-adjacent testers.
- **Decide (don't build) the future pricing model.** Beta users will ask "what happens when this isn't free." Have a one-line answer ready (e.g. "usage-based, priced near provider cost + margin, beta credits carry over") even though Stripe integration is post-beta.

## Week 4 — Outreach prep

- **Refresh landing copy** around the DePIN value prop specifically: cheaper/more resilient inference via decentralized compute, OpenAI-compatible so it's a drop-in swap. Lead with "get an API key in 30 seconds," link the live demo.
- **Line up first channels**: r/LocalLLaMA, Indie Hackers, AI-dev Discord/Twitter circles, and io.net/Akash community channels (they have an interest in a router that showcases their networks).
- **Run a private dry run first.** Get 2-3 friendly technical testers on the deployed version before the public post — this is where the login flow, rate limits, and error states get caught cheaply instead of publicly.
- **Basic funnel visibility.** You don't need an analytics platform yet — a couple of SQL queries against the Postgres store (signups → first key → first successful request → repeat usage) tells you if outreach is converting.

## Deliberately deferred (not blocking beta)

- Real payments/Stripe billing — free beta means the dev credit top-up is fine for now.
- Wallet/crypto-native auth beyond the existing `wallet` field.
- SDKs beyond raw HTTP — a docs quickstart is enough until there's demand.
- Multi-region/high-availability infra — a single Railway deployment is fine at beta scale.

## Suggested order if the timeline compresses

If 3-4 weeks becomes 1-2: do the login fix, the real deploy with Postgres, and basic monitoring — then go straight to a small private dry run. Docs, streaming, and model coverage matter for *growth* but won't stop a handful of trusted early users from getting real signal.
