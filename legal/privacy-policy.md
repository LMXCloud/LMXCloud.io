# Privacy Policy

**Effective date:** July 8, 2026  
**Service:** LMX Cloud (`lmxcloud.io`)

This Privacy Policy explains how LMX Cloud ("we," "us," or "our") collects, uses, and shares information when you use our websites, API, and dashboard (the "Service").

## 1. Information we collect

### Account and identity

- **Email address** — if you sign up with email (via Clerk).
- **Wallet address** — if you sign in with Ethereum (SIWE) or pay via x402 or USDC deposits.
- **API key identifiers** — we store key metadata and hashed or masked secrets; treat API keys as passwords.

### Usage and operations

- **Inference metadata** — model name, provider routed, token counts, latency, cost, timestamps, fallback flags, and similar operational fields.
- **Verifiable receipts** — we hash routing metadata into `lmx_receipt_v1` receipts for anchoring. **We do not include prompt or completion text in on-chain receipts.**
- **Request logs** — may include metadata visible in your dashboard; content retention policies may evolve; do not submit secrets in prompts.
- **IP address, user agent, and rate-limit counters** — for security and abuse prevention.

### Web search queries

When you use `POST /v1/web/search` or the MCP `web_search` tool, we receive your **search query string** and optional result-count parameters. We forward the query to Brave Search to retrieve results and record usage metadata (for example, provider, fixed per-call cost, and success or failure) linked to your API key.

### Payments

- **On-chain transaction hashes, payer wallet addresses, and payment amounts** — for USDC deposits, x402 per-call payments, and on-chain refunds when reconciliation returns USDC to a payer wallet.
- **Payment event records** — quoted and settled amounts linked to usage where applicable.

### Cookies and local storage

- Session tokens and dashboard preferences in browser storage.
- Clerk authentication cookies when you use email sign-in.

## 2. How we use information

We use information to:

- Provide, secure, and improve the Service
- Authenticate users and API keys
- Meter usage, bill accounts, and reconcile payments (including automatic balance credit-backs and on-chain USDC refunds when inference fails after payment, as described in our [Terms of Service](./terms-of-service.md))
- Detect abuse, fraud, sanctions or compliance screening failures, and violations of our [Acceptable Use Policy](./acceptable-use.md)
- Send internal operational alerts to our team (for example, new signups, credit events, and first API usage per key)
- Comply with legal obligations
- Communicate service updates and respond to support requests

## 3. What we do not sell

We do not sell your personal information. We do not use your prompts to train third-party foundation models unless we explicitly tell you otherwise in a separate agreement.

See Section 10 (CCPA/CPRA draft) for counsel review of whether any sharing with service providers could constitute a "sale" or "share" under California law.

## 4. Sharing with service providers

We use third-party providers that process data on our behalf, including:

- **Clerk** — email authentication
- **Hosting and database providers** (e.g., Railway, Vercel, Neon) — infrastructure and stored account, usage, and payment records
- **Inference providers** (e.g., io.net, Akash) — your API requests (including prompts and parameters needed to run inference) are sent to route inference
- **Coinbase Developer Platform (CDP)** — x402 payment verification, settlement, and know-your-transaction screening when enabled
- **Brave Search** — when you use web search, your **search query** and result-count parameters are sent to Brave's Search API (`api.search.brave.com`) to retrieve results; LMX meters and bills the call separately
- **Sentry** — when `SENTRY_DSN` is configured on our API servers, error and performance monitoring for unhandled exceptions and certain provider or route failures. We do not intentionally send prompts or completions to Sentry, but **error reports may include stack traces, request paths, provider error messages, and other diagnostic context that could incidentally contain portions of request content** if those appear in an error message. Counsel should review our Sentry data-scrubbing configuration before production reliance.
- **Telegram** — when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured, **internal operator notifications only** (not user-facing messages). Notifications may include truncated API key identifiers, account email or wallet address, credit amounts and balances, deposit or refund source labels, and first-call routing metadata (provider, model, resource type). Prompt text, completion text, and full API secrets are not included in these notifications.
- **Blockchain networks** — receipt Merkle roots, payment transactions, and refund transactions are recorded on-chain and are public (see Sections 5 and 9)

Each provider is used under their own terms and privacy policies.

## 5. Public blockchain data

Wallet addresses, transaction hashes, and anchored Merkle roots are **public** on Base (or configured networks). Anyone can view them on a block explorer. Do not use the Service if you are unwilling to have payment and anchoring metadata appear on-chain.

On-chain records are **immutable** and outside our control once confirmed. They are not deletable through a privacy request to us (see Section 9).

## 6. Retention

We retain account and usage data while your account is active and as needed for billing, security, legal compliance, and dispute resolution. We may retain anonymized or aggregated statistics longer.

Off-chain records (for example, dashboard account data, API key metadata, usage logs, and payment event rows in our database) may be deleted or anonymized when we honor a valid erasure request, subject to legal and operational retention needs. Public on-chain data and data held by third parties under their own retention policies are addressed in Sections 4, 5, and 9.

## 7. Security

We use industry-standard measures including TLS, access controls, and hashed credentials where applicable. No system is perfectly secure; you are responsible for protecting API keys and wallet keys.

<!-- ATTORNEY REVIEW NEEDED: Automated decision-making — confirm disclosure scope for rate limits, compliance blocks, and whether human review / appeal process is required -->
## 8. Automated decision-making

We use automated systems that can affect your access to the Service **without a human reviewer in the loop**, including:

- **Rate limiting** — per API key, IP address, and (for x402) payer wallet, using in-memory counters; exceeded limits return HTTP `429` with a retry interval.
- **Credit and payment checks** — automated refusal of requests when balance is insufficient or x402 payment verification or settlement fails.
- **Compliance and abuse controls** — automated refusal or cancellation of payments that fail facilitator know-your-transaction screening, and blocking or throttling of wallets, IPs, or payloads associated with suspected abuse (see our [Acceptable Use Policy](./acceptable-use.md) and [Terms of Service](./terms-of-service.md), Section 8).

These measures are intended to protect the Service and comply with law; they are not used to make legal or similarly significant decisions about you beyond access and billing. If you believe an automated block was in error, contact **support@lmxcloud.io** with subject `Automated block appeal` and relevant identifiers (account email, wallet address, API key ID, or transaction hash — never send full API key secrets).

## 9. Your choices and rights

Depending on your location, you may have rights to access, correct, delete, or export personal data, or to object to certain processing. Contact **support@lmxcloud.io** with subject `Privacy request`. We may need to verify your identity (e.g., via account email or wallet signature).

You may revoke API keys in the dashboard and disconnect wallets at any time.

<!-- ATTORNEY REVIEW NEEDED: Deletion vs. on-chain immutability — confirm wording for GDPR/other erasure rights and what we can practically honor -->
### What we can and cannot delete

| Category | Examples | Deletable on request? |
|----------|----------|------------------------|
| **Off-chain account and usage data** | Email (via Clerk), API key metadata, dashboard usage logs, payment event rows in our database, support correspondence | **Often yes**, subject to legal retention, billing disputes, fraud prevention, and backup latency |
| **Public on-chain data** | Wallet addresses, transaction hashes, USDC transfer amounts, anchored Merkle receipt roots on Base | **No** — permanently public on the blockchain and outside our deletion control; erasure rights do not reach data already recorded on-chain |
| **Third-party processor copies** | Clerk auth records, Sentry error events, Brave query logs, CDP settlement records | **Limited** — we can delete or anonymize our copies where applicable; separate retention by the provider may remain; we will forward deletion requests where we have a mechanism to do so |
| **Aggregated or de-identified statistics** | Usage aggregates that no longer identify you | **Not applicable** — not personal data |

Requesting deletion of off-chain data does **not** remove public blockchain history. If you need on-chain activity not to be publicly associated with you, do not use wallet-based payments or on-chain anchoring features, or use a wallet you are willing to have appear permanently on-chain.

**Operator note (autonomous agents):** If you deploy an agent that calls the Service, you are responsible for personal data the agent submits, as described in Section 7 of our [Terms of Service](./terms-of-service.md). Privacy requests regarding agent-submitted data may require the Operator to authenticate as the account holder or payer.

## 10. Regional privacy rights — drafts for counsel (not adopted)

<!-- ATTORNEY REVIEW NEEDED: Applicability — determine whether GDPR, UK GDPR, CCPA/CPRA, or other regimes apply based on actual user geography and business footprint; select, edit, or remove drafts below -->
**The sections below are draft options only. They are not binding unless counsel confirms applicability and adopts final language.**

### Draft — GDPR / UK GDPR

**Data controller (draft — complete before publication):**  
`[LEGAL ENTITY NAME]`  
`[REGISTERED ADDRESS]`  
Contact: **support@lmxcloud.io**

**Legal bases for processing (draft):** Counsel to map each processing purpose in Section 2 to an appropriate Article 6 basis (for example, contract performance for providing the Service, legitimate interests for security and abuse prevention, legal obligation for compliance, and consent where required).

**International transfers (draft):** Personal data may be processed in the United States and other countries where our service providers operate (Section 4). Where required, we rely on appropriate transfer mechanisms such as Standard Contractual Clauses — **counsel to confirm which transfers occur and which safeguards apply.**

**Your rights (draft):** Where GDPR or UK GDPR applies, you may have rights to access, rectify, erase, restrict, object, and data portability, and to lodge a complaint with a supervisory authority. Submit requests to **support@lmxcloud.io** with subject `GDPR request`. Erasure is subject to Section 9 (on-chain data cannot be deleted).

### Draft — CCPA / CPRA (California)

**Your rights (draft):** Where the California Consumer Privacy Act or California Privacy Rights Act applies, you may have the right to know what personal information we collect and how we use and disclose it; to delete personal information (subject to Section 9 exceptions); to correct inaccurate personal information; to opt out of the **sale** or **sharing** of personal information; and not to receive discriminatory treatment for exercising these rights.

**Sale and share (draft — counsel to decide):** Section 3 states we do not sell personal information. **Counsel should evaluate whether any disclosures to service providers in Section 4 (for example, inference routing, Brave Search queries, Sentry error data, or CDP payment screening) constitute a "sale" or "share" under CPRA** and whether we must provide a **"Do Not Sell or Share My Personal Information"** link or honor opt-out preference signals.

**Sensitive personal information (draft):** We do not intentionally collect government ID numbers or precise geolocation for marketing. Wallet addresses and payment data may be sensitive in some contexts — counsel to confirm required notices.

**Authorized agent requests (draft):** We may accept requests through an authorized agent where permitted by law and after verification.

## 11. Data breach notification — draft for counsel

<!-- ATTORNEY REVIEW NEEDED: Breach notification — set jurisdiction-specific timelines, thresholds, and contact method before publication -->
**Draft only — not adopted.**

If we become aware of a security incident that compromises the security of personal information we hold off-chain, we will investigate promptly and, **where required by applicable law**, notify affected individuals and regulators. **Counsel to set the notification timeline** (for example, without undue delay, within 72 hours for GDPR supervisory notification where applicable, or as required by U.S. state breach-notification statutes).

Notifications may be sent by email to the address associated with your account or by posting a notice on our website if we cannot contact you directly. On-chain public data breaches (for example, exposure of already-public wallet activity) are generally outside the scope of this commitment.

Initial breach reports: **support@lmxcloud.io** with subject `Security incident`.

## 12. Children

The Service is not directed to children under 18. We do not knowingly collect data from children.

## 13. International users

If you access the Service from outside the United States, you consent to processing in the United States and other countries where our providers operate.

**Counsel note:** This section may overlap with or conflict with the draft GDPR/UK GDPR language in Section 10 until counsel harmonizes them.

## 14. Changes

We may update this Policy. We will post the revised version with a new effective date. Material changes may be communicated via the website or email where appropriate.

## 15. Contact

Privacy questions: **support@lmxcloud.io**
