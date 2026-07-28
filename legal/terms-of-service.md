# Terms of Service

**Effective date:** July 8, 2026  
**Service:** LMX Cloud (`lmxcloud.io`)

## 1. Agreement

These Terms of Service ("Terms") govern your access to and use of LMX Cloud, an OpenAI-compatible inference API and related websites, dashboards, and tools (the "Service"), operated by the LMX Cloud project ("we," "us," or "our").

By creating an account, connecting a wallet, obtaining an API key, or using the Service, you agree to these Terms and our [Privacy Policy](./privacy-policy.md). If you do not agree, do not use the Service.

<!-- ATTORNEY REVIEW NEEDED: Anonymous x402 payers — assess whether 402-response disclosure is sufficient contractual acceptance or Terms URL must be added to API response -->
### x402 per-call payments without an account

When per-call (x402) payments are enabled, a caller may use the Service without creating an account or completing a click-through acceptance flow. In that flow, an unauthenticated `POST` to `/v1/chat/completions` receives HTTP `402 Payment Required` with a JSON body that includes a `payment_required` error, a price quote (`quoted_amount_usdc`, model, and estimated tokens), and payment requirements per the x402 protocol. The caller may then retry the same request with a signed payment payload (for example, an EIP-3009 or Permit2 authorization) to pay and receive inference.

**By submitting a signed x402 payment payload and receiving inference, the wallet holder (or the person or entity that authorized the wallet or software making the payment) agrees to these Terms and our [Privacy Policy](./privacy-policy.md) and [Acceptable Use Policy](./acceptable-use.md) for that transaction and any related use of the Service.** We treat cryptographic authorization of payment at the quoted price as assent to pay for the described Service on these Terms, analogous to acceptance by use for account-based access.

**Counsel note:** As of the date of this draft, the `402` response body (`unpaidResponseBody` in `apps/api/src/payments/x402-server.ts`) does **not** include a Terms URL or explicit "by paying you agree" language — only the error, quote, and x402 payment requirements. Please advise whether that disclosure is sufficient for enforceability against anonymous payers, or whether the `402` body (and/or x402 Bazaar resource metadata) should reference `https://lmxcloud.io/legal/terms` explicitly before production reliance on this clause.

## 2. Beta service

The Service is offered as a **beta**. Features, pricing, availability, and supported models may change without notice. We may suspend or discontinue the Service or any feature at any time. The Service is provided for evaluation and development use unless we state otherwise in writing.

## 3. Eligibility

You must be at least 18 years old (or the age of majority in your jurisdiction) and able to form a binding contract. You may not use the Service if you are barred under applicable law or our [Acceptable Use Policy](./acceptable-use.md).

## 4. Accounts, API keys, and wallets

- **Email accounts** may be provided through our authentication partner (Clerk).
- **Wallet accounts** use Sign-In with Ethereum (SIWE). You are responsible for securing your wallet and private keys.
- **API keys** are secrets. You are responsible for all activity under your keys and for revoking compromised keys promptly.
- One person or entity may not maintain multiple accounts to evade limits or abuse controls.

We may refuse service, suspend, or terminate accounts at our discretion, including for violations of these Terms or the Acceptable Use Policy.

## 5. Inference and third-party providers

The Service routes requests to third-party compute providers (e.g., io.net, Akash). We do not control those networks. Output quality, latency, availability, and content are not guaranteed. You use model outputs at your own risk and are responsible for reviewing outputs before relying on them.

## 6. Credits, USDC, and x402 payments

- **Balance-funded use:** You may fund an account with USDC on Base (or testnets when configured). Credits are consumed based on metered usage after successful inference unless stated otherwise.
- **Per-call (x402) use:** When enabled, anonymous or wallet-based callers may pay per request via the x402 payment protocol. Quotes and settlement are described in our API documentation. x402 verification and settlement may be processed through the Coinbase Developer Platform (CDP) x402 Facilitator, which may apply its own compliance screening (including know-your-transaction checks) before settlement.
- Cryptocurrency transactions are generally irreversible once confirmed on-chain. You are responsible for sending funds to the correct chain and address.

<!-- ATTORNEY REVIEW NEEDED: Refund mechanics — confirm plain-English summary matches operational policy and is adequate for consumer-facing terms -->
### Refunds and payment failure reconciliation

Except as required by applicable law, we do not offer discretionary refunds for successful inference or for mistaken payments. When you pay but do not receive a successful inference response, we reconcile as follows:

- **Account balance (API key):** If usage was deducted from your prepaid balance but inference did not complete successfully, we automatically credit the deducted amount back to your account balance.
- **x402 — payment never settled on-chain:** If inference fails before on-chain settlement completes, no USDC leaves your wallet; we mark the payment attempt failed and no on-chain refund is needed.
- **x402 — settled without successful inference:** If USDC settles to us but no successful usage is linked to that payment (including inference failure, cancellation, or a stuck fulfillment), we queue reconciliation. After a short grace period (currently two minutes by default, to allow delayed usage recording), we attempt to return USDC to the payer wallet that signed the payment.
- **Automatic on-chain refunds:** On-chain USDC refunds execute automatically when the refund amount is at or below our automatic refund threshold (currently USD $5 USDC by default, configurable as `REFUND_AUTO_MAX_USDC`) and our treasury refund wallet is configured.
- **Manual approval:** Refund amounts above that threshold are queued for manual review and approval before we send an on-chain refund. Timing is not guaranteed.
- **No double recovery:** Each payment is reconciled at most once; we use idempotency keys to prevent duplicate credit-backs or refunds.

Reconciliation depends on system configuration (for example, database availability, treasury wallet setup, and facilitator behavior) and may not be available in all environments. Failed or delayed reconciliation does not expand our liability beyond Section 13.

<!-- ATTORNEY REVIEW NEEDED: Money transmission / custody — evaluate regulatory characterization given USDC deposits, balance ledger, treasury custody, and bidirectional on-chain refunds; do not treat the below as a final legal conclusion -->
### Money transmission and financial services

The Service accepts USDC deposits, maintains internal usage balances, settles x402 payments through third-party facilitators, and may send on-chain USDC refunds from our treasury wallet. **We have not determined whether these activities constitute money transmission, custody, or other regulated financial services in any jurisdiction.** Nothing in the Service is intended to constitute banking, money transmission, securities, or investment services, and we do not provide financial, investment, tax, or legal advice. **Counsel should evaluate our actual flows (deposit crediting, balance ledger, CDP facilitator settlement, and treasury refunds) and advise on required licenses, disclosures, and contractual language before we rely on this section.**

## 7. Autonomous agents and non-human counterparties

<!-- ATTORNEY REVIEW NEEDED: Agent liability allocation — confirm binding the deployer/operator is sufficient for autonomous x402 and API-key use -->
Software agents, bots, and other automated systems may call the Service (including via x402 without a human in the loop). **An autonomous agent cannot accept these Terms on its own behalf.** When an agent accesses the Service, these Terms bind the **human or legal entity that deployed, configured, funded, or operates that agent** (the "Operator"), and the Operator is responsible for the agent's acts and omissions as if the Operator performed them directly.

This allocation supplements Section 5 ("Autonomous agents and x402") of our [Acceptable Use Policy](./acceptable-use.md): agents must comply with the AUP, and the Operator remains liable for that compliance and for all payment, content, and conduct obligations under these Terms.

## 8. Sanctions and export compliance

<!-- ATTORNEY REVIEW NEEDED: Sanctions scope — confirm OFAC/export wording and alignment with CDP facilitator KYT screening -->
You may not use the Service if you are, or are owned or controlled by, any person or entity on any applicable sanctions or restricted-party list (including lists maintained by the U.S. Treasury Department's Office of Foreign Assets Control ("OFAC") or equivalent authorities), or if you are located in, organized under the laws of, or ordinarily resident in any country or region subject to comprehensive sanctions or embargoes, except where authorized by law.

You represent that your use of the Service and any USDC payments comply with applicable sanctions, export-control, and anti-money-laundering laws. We may block, suspend, or refuse transactions associated with wallets, IP addresses, or payment payloads that fail compliance screening or that we reasonably believe violate this section. When x402 is enabled, our payment facilitator (CDP) may perform know-your-transaction screening before settlement; a failed screen may prevent payment and inference even if our API otherwise accepted the request.

## 9. Pricing and taxes

Prices are usage-based and published in the dashboard, documentation, or `GET /v1/pricing` when applicable. We may change prices with reasonable notice where practicable. You are responsible for any taxes arising from your use of the Service.

## 10. Your content and data

You retain rights to prompts and inputs you submit. You grant us a limited license to process inputs and generate outputs solely to operate and improve the Service, comply with law, and enforce these Terms. See the Privacy Policy for how we handle data.

You represent that you have the rights to submit your content and that your use complies with applicable law and our Acceptable Use Policy.

## 11. Intellectual property

We own the Service, branding, documentation, and underlying software except for open-source components under their respective licenses. You may not copy, reverse engineer, or resell the Service except as expressly permitted (e.g., calling the public API under these Terms).

## 12. Disclaimers

THE SERVICE IS PROVIDED **"AS IS"** AND **"AS AVAILABLE."** TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 13. Limitation of liability

<!-- ATTORNEY REVIEW NEEDED: Liability cap — sanity-check $100 / 3-month-fees cap against current payment volumes and bidirectional USDC flows (deposits + refunds) -->
TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR CRYPTO ASSETS. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THE SERVICE IS LIMITED TO THE GREATER OF (A) USD $100 OR (B) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE THREE (3) MONTHS BEFORE THE CLAIM.

Some jurisdictions do not allow certain limitations; in those cases our liability is limited to the fullest extent permitted by law.

## 14. Indemnity

You will defend and indemnify us against claims arising from your use of the Service, your content, or your violation of these Terms or applicable law.

## 15. DMCA copyright policy

<!-- ATTORNEY REVIEW NEEDED: DMCA agent — complete designated-agent registration before go-live; verify notice/counter-notice procedure -->
We respond to notices of alleged copyright infringement consistent with the U.S. Digital Millennium Copyright Act ("DMCA"). If you believe content accessible through the Service infringes your copyright, send a written notice to our designated agent with:

1. Identification of the copyrighted work claimed to have been infringed.
2. Identification of the material claimed to be infringing and information reasonably sufficient to locate it (e.g., API request metadata, timestamps, wallet or account identifiers, URLs).
3. Your contact information (name, address, telephone, and email).
4. A statement that you have a good-faith belief that use of the material is not authorized by the copyright owner, its agent, or the law.
5. A statement, under penalty of perjury, that the information in the notice is accurate and that you are authorized to act on behalf of the copyright owner.
6. Your physical or electronic signature.

**Designated DMCA agent (complete before publication):**  
**Name:** `[DESIGNATED AGENT NAME]`  
**Address:** `[STREET ADDRESS, CITY, STATE, ZIP]`  
**Email:** `[DMCA AGENT EMAIL]`

We may remove or disable access to material identified in a valid notice and may terminate repeat infringers where appropriate. Counter-notification procedures will be provided upon request or in a subsequent update to this section.

## 16. Dispute resolution — draft for counsel (not adopted)

<!-- ATTORNEY REVIEW NEEDED: Dispute resolution strategy — choose between Section 16 draft (arbitration + class waiver) vs. Section 18 (Delaware courts); do not publish both as binding -->
**The language below is a draft option for John and counsel only. It is not binding unless expressly adopted in place of Section 18.**

### Option A — Binding arbitration and class-action waiver (draft)

Any dispute, claim, or controversy arising out of or relating to these Terms or the Service that cannot be resolved informally within thirty (30) days will be resolved by **binding arbitration** administered by the American Arbitration Association under its Consumer Arbitration Rules (or Commercial Arbitration Rules for entity users), rather than in court, except that either party may seek injunctive relief in court for intellectual property or unauthorized access.

**Class-action waiver (draft):** You and we agree that each may bring claims against the other only in an individual capacity, and not as a plaintiff or class member in any purported class, collective, or representative proceeding.

**Venue (draft):** Arbitration will take place in Delaware, USA, or remotely by mutual agreement. The arbitrator may award the same damages and relief that a court could award, subject to Section 13.

**Opt-out (draft):** An individual user may opt out of this arbitration agreement within thirty (30) days of first accepting these Terms by emailing **support@lmxcloud.io** with subject `Arbitration opt-out` and the account email or wallet address used with the Service.

*If Option A is adopted, Section 18 should be revised to state that arbitration governs and courts are limited to the exceptions above.*

## 17. Changes

We may update these Terms. We will post the revised version with a new effective date. Material changes may be communicated via the website or email where appropriate. Continued use after changes constitutes acceptance.

## 18. Governing law

These Terms are governed by the laws of the State of Delaware, United States, excluding conflict-of-law rules. Disputes will be resolved in the state or federal courts located in Delaware, unless applicable law requires otherwise.

**Counsel note:** This section conflicts with the draft arbitration option in Section 16 until one approach is selected.

## 19. Contact

Questions about these Terms: **support@lmxcloud.io**
