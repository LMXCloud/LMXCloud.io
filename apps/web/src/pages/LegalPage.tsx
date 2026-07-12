import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PublicLayout } from "../components/PublicLayout";
import { SeoHead } from "../components/SeoHead";
import { PageHeader } from "../components/console/PageHeader";
import { cn } from "../lib/cn";
import {
  LEGAL_DOCS,
  LEGAL_EFFECTIVE_DATE,
  SUPPORT_EMAIL,
  type LegalDocId,
} from "../content/legal/constants";

const LEGAL_SEO: Record<LegalDocId, { title: string; description: string }> = {
  terms: {
    title: "Terms of Service — LMX Cloud",
    description:
      "Beta terms of service for LMX Cloud, the OpenAI-compatible DePIN inference API for developers and autonomous agents.",
  },
  privacy: {
    title: "Privacy Policy — LMX Cloud",
    description:
      "How LMX Cloud collects, uses, and protects account, wallet, and usage data for the inference API and console.",
  },
  "acceptable-use": {
    title: "Acceptable Use Policy — LMX Cloud",
    description:
      "Rules for lawful and fair use of the LMX Cloud inference API, including prohibited abuse and reporting channels.",
  },
  contact: {
    title: "Contact & Support — LMX Cloud",
    description:
      "Contact LMX Cloud for product feedback, abuse reports, and privacy requests at support@lmxcloud.io.",
  },
};

function isLegalDocId(value: string | undefined): value is LegalDocId {
  return LEGAL_DOCS.some((doc) => doc.id === value);
}

export function LegalPage() {
  const { doc } = useParams<{ doc?: string }>();
  const activeId: LegalDocId = isLegalDocId(doc) ? doc : "terms";

  if (doc && !isLegalDocId(doc)) {
    return <Navigate to="/legal/terms" replace />;
  }

  const active = LEGAL_DOCS.find((item) => item.id === activeId)!;
  const seo = LEGAL_SEO[activeId];

  return (
    <PublicLayout>
      <SeoHead title={seo.title} description={seo.description} path={`/legal/${activeId}`} />
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)] py-10 sm:py-14">
        <PageHeader
          eyebrow="Trust"
          title="Legal"
          description="Terms, privacy, and acceptable use for the LMX Cloud beta. Have counsel review before production launch."
        />

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav className="lg:sticky lg:top-24 lg:self-start">
            <p className="text-label-sm text-on-surface-faint">Documents</p>
            <ul className="mt-3 space-y-1">
              {LEGAL_DOCS.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/legal/${item.id}`}
                    className={cn(
                      "block rounded-md px-3 py-2 text-body-sm transition-colors",
                      item.id === activeId
                        ? "bg-surface text-on-surface"
                        : "text-on-surface-muted hover:bg-surface hover:text-on-surface",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-body-sm text-on-surface-faint">
              Effective {LEGAL_EFFECTIVE_DATE}. Source copies in{" "}
              <code className="text-mono-sm">legal/</code> in the repository.
            </p>
          </nav>

          <article className="min-w-0">
            <header className="border-b border-border pb-6">
              <h1 className="text-headline-md text-on-surface">{active.title}</h1>
              <p className="mt-2 text-body-md text-on-surface-muted">
                {active.description}
              </p>
              <p className="mt-2 text-body-sm text-on-surface-faint">
                Effective {LEGAL_EFFECTIVE_DATE}
              </p>
            </header>

            <div className="mt-8 space-y-8">
              {activeId === "terms" ? <TermsContent /> : null}
              {activeId === "privacy" ? <PrivacyContent /> : null}
              {activeId === "acceptable-use" ? <AcceptableUseContent /> : null}
              {activeId === "contact" ? <ContactContent /> : null}
            </div>
          </article>
        </div>
      </div>
    </PublicLayout>
  );
}

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-title-md text-on-surface">{title}</h2>
      <div className="mt-3 space-y-3 text-body-md text-on-surface-muted">{children}</div>
    </section>
  );
}

function TermsContent() {
  return (
    <>
      <LegalSection title="Agreement">
        <p>
          These Terms govern your use of LMX Cloud — an OpenAI-compatible inference API,
          dashboard, and related tools. By creating an account, connecting a wallet,
          obtaining an API key, or calling the API, you agree to these Terms and our{" "}
          <Link to="/legal/privacy" className="text-primary hover:text-primary-hover">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="Beta service">
        <p>
          The Service is offered as a beta. Features, pricing, models, and availability may
          change without notice. We may suspend or discontinue any part of the Service at any
          time.
        </p>
      </LegalSection>
      <LegalSection title="Accounts, API keys, and wallets">
        <p>
          You are responsible for securing API keys and wallet private keys. Email sign-in may
          use Clerk; wallet sign-in uses SIWE. All activity under your credentials is your
          responsibility.
        </p>
      </LegalSection>
      <LegalSection title="Inference and third-party providers">
        <p>
          Requests are routed to third-party compute networks (e.g., io.net, Akash). We do not
          guarantee output quality, latency, or availability. Review model outputs before
          relying on them.
        </p>
      </LegalSection>
      <LegalSection title="Credits, USDC, and x402">
        <p>
          Balance-funded accounts consume credits after successful inference. When enabled,
          per-call x402 payments settle via the Coinbase facilitator on Base. On-chain
          transactions are irreversible. We are not a bank or money transmitter.
        </p>
      </LegalSection>
      <LegalSection title="Disclaimers and liability">
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS.&quot; TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE
          DISCLAIM WARRANTIES AND LIMIT LIABILITY TO THE GREATER OF USD $100 OR AMOUNTS YOU
          PAID IN THE PRIOR THREE MONTHS.
        </p>
      </LegalSection>
      <LegalSection title="Governing law">
        <p>
          Delaware law governs these Terms. Disputes are resolved in Delaware courts unless
          applicable law requires otherwise.
        </p>
      </LegalSection>
      <LegalSection title="Contact">
        <p>
          Questions:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:text-primary-hover">
            {SUPPORT_EMAIL}
          </a>
          . Full text in repository: <code className="text-mono-sm">legal/terms-of-service.md</code>
        </p>
      </LegalSection>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <LegalSection title="What we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>Email (Clerk), wallet address (SIWE / x402 / deposits), API key metadata</li>
          <li>
            Usage metadata: model, provider, tokens, latency, cost, timestamps — not prompt text
            in on-chain receipts
          </li>
          <li>Payment data: tx hashes, payer wallets, quoted/settled amounts</li>
          <li>IP address and rate-limit counters for security</li>
        </ul>
      </LegalSection>
      <LegalSection title="How we use data">
        <p>
          To operate the Service, authenticate callers, meter usage, reconcile payments, prevent
          abuse, and comply with law. We do not sell personal information.
        </p>
      </LegalSection>
      <LegalSection title="Third parties">
        <p>
          We use Clerk, hosting/database providers, inference providers, Coinbase CDP (x402), and
          public blockchains. On-chain anchoring and payments are publicly visible.
        </p>
      </LegalSection>
      <LegalSection title="Your rights">
        <p>
          Contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:text-primary-hover">
            {SUPPORT_EMAIL}
          </a>{" "}
          with subject <code className="text-mono-sm">Privacy request</code> for access,
          correction, or deletion where applicable.
        </p>
      </LegalSection>
      <LegalSection title="Full policy">
        <p>
          <code className="text-mono-sm">legal/privacy-policy.md</code> in the repository.
        </p>
      </LegalSection>
    </>
  );
}

function AcceptableUseContent() {
  return (
    <>
      <LegalSection title="Lawful use">
        <p>
          No illegal content, fraud, malware, harassment, IP infringement, or circumvention of
          safety systems. You are responsible for outputs generated from your prompts.
        </p>
      </LegalSection>
      <LegalSection title="API keys">
        <p>
          Do not share, publish, or resell API keys. Rotate compromised keys immediately. Do not
          create accounts to evade limits or bans.
        </p>
      </LegalSection>
      <LegalSection title="Rate limits and agents">
        <p>
          Fair use applies to humans and autonomous agents. x402 payment does not exempt callers
          from these rules. We may block wallets, IPs, or payloads associated with abuse.
        </p>
      </LegalSection>
      <LegalSection title="Report abuse">
        <p>
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:text-primary-hover">
            {SUPPORT_EMAIL}
          </a>{" "}
          with subject <code className="text-mono-sm">Abuse report</code>. Include timestamps and
          wallet or key IDs — never full API key secrets.
        </p>
      </LegalSection>
      <LegalSection title="Full policy">
        <p>
          <code className="text-mono-sm">legal/acceptable-use.md</code> in the repository.
        </p>
      </LegalSection>
    </>
  );
}

function ContactContent() {
  return (
    <>
      <LegalSection title="Support">
        <p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:text-primary-hover">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </LegalSection>
      <LegalSection title="Abuse reports">
        <p>
          Subject: <code className="text-mono-sm">Abuse report</code>. Include description,
          timestamps, wallet addresses or key IDs, and transaction hashes where relevant.
        </p>
      </LegalSection>
      <LegalSection title="Privacy requests">
        <p>
          Subject: <code className="text-mono-sm">Privacy request</code>. We may verify identity
          via account email or wallet signature.
        </p>
      </LegalSection>
      <LegalSection title="Beta pricing FAQ">
        <p>
          Usage-based pricing near provider cost plus margin. Beta credits may carry over when
          paid tiers launch. Per-call x402 prices are at{" "}
          <code className="text-mono-sm">GET /v1/pricing</code> when enabled.
        </p>
      </LegalSection>
    </>
  );
}
