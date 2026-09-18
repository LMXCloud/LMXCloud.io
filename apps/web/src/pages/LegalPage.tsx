import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PublicLayout } from "../components/PublicLayout";
import { SeoHead } from "../components/SeoHead";
import { PageHeader } from "../components/console/PageHeader";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "../components/console/DataTable";
import { cn } from "../lib/cn";
import {
  GITHUB_LEGAL_DIR_URL,
  GITHUB_REPO_URL,
  GITHUB_SECURITY_ADVISORIES_URL,
  GITHUB_SECURITY_URL,
  LEGAL_DOCS,
  LEGAL_EFFECTIVE_DATE,
  PROVIDER_POLICY_URLS,
  SUPPORT_EMAIL,
  type LegalDocId,
} from "../content/legal/constants";

const LEGAL_LINK_CLASS = "text-primary hover:text-primary-hover";

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
  security: {
    title: "Security — LMX Cloud",
    description:
      "How LMX Cloud protects API and MCP traffic today: Cloudflare edge, rate limits, origin lock, and known gaps.",
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
          description="Terms, privacy, acceptable use, and the current security posture for the LMX Cloud beta. Have counsel review before production launch."
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
              {activeId === "security" ? (
                <>
                  Current production posture. Source:{" "}
                  <Ext href={GITHUB_SECURITY_URL}>SECURITY.md on GitHub</Ext>.
                </>
              ) : (
                <>
                  Effective {LEGAL_EFFECTIVE_DATE}. Source copies on{" "}
                  <Ext href={GITHUB_LEGAL_DIR_URL}>GitHub</Ext>.
                </>
              )}
            </p>
          </nav>

          <article className="min-w-0">
            <header className="border-b border-border pb-6">
              <h1 className="text-headline-md text-on-surface">{active.title}</h1>
              <p className="mt-2 text-body-md text-on-surface-muted">
                {active.description}
              </p>
              <p className="mt-2 text-body-sm text-on-surface-faint">
                {activeId === "security"
                  ? "Current production posture — not a legal terms document."
                  : `Effective ${LEGAL_EFFECTIVE_DATE}`}
              </p>
            </header>

            <div className="mt-8 space-y-8">
              {activeId === "terms" ? <TermsContent /> : null}
              {activeId === "privacy" ? <PrivacyContent /> : null}
              {activeId === "acceptable-use" ? <AcceptableUseContent /> : null}
              {activeId === "security" ? <SecurityContent /> : null}
              {activeId === "contact" ? <ContactContent /> : null}
            </div>
          </article>
        </div>
      </div>
    </PublicLayout>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LEGAL_LINK_CLASS}>
      {children}
    </a>
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
          <Link to="/legal/privacy" className={LEGAL_LINK_CLASS}>
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
          Requests are routed to third-party compute networks (e.g., io.net, AkashML, Aethir Mesh).
          We do not
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
        <p>
          <strong className="font-medium text-on-surface">No double recovery.</strong> Each
          payment is reconciled at most once; we use idempotency keys to prevent duplicate
          credit-backs or refunds.
        </p>
      </LegalSection>
      <LegalSection title="Autonomous agents and non-human counterparties">
        <p>
          Software agents, bots, and other automated systems may call the Service (including via
          x402 without a human in the loop).{" "}
          <strong className="font-medium text-on-surface">
            An autonomous agent cannot accept these Terms on its own behalf.
          </strong>{" "}
          When an agent accesses the Service, these Terms bind the{" "}
          <strong className="font-medium text-on-surface">
            human or legal entity that deployed, configured, funded, or operates that agent
          </strong>{" "}
          (the &quot;Operator&quot;), and the Operator is responsible for the agent&apos;s acts
          and omissions as if the Operator performed them directly.
        </p>
        <p>
          This allocation supplements Section 5 (&quot;Autonomous agents and x402&quot;) of our{" "}
          <Link to="/legal/acceptable-use" className={LEGAL_LINK_CLASS}>
            Acceptable Use Policy
          </Link>
          : agents must comply with the AUP, and the Operator remains liable for that
          compliance and for all payment, content, and conduct obligations under these Terms.
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
          <a href={`mailto:${SUPPORT_EMAIL}`} className={LEGAL_LINK_CLASS}>
            {SUPPORT_EMAIL}
          </a>
          . Full text:{" "}
          <Ext href={`${GITHUB_LEGAL_DIR_URL}/terms-of-service.md`}>Terms of Service on GitHub</Ext>
          .
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
          We use Clerk, hosting/database providers (e.g., Railway, Vercel, Neon), Coinbase CDP
          (x402), Brave Search when you call web search, and public blockchains. On-chain
          anchoring and payments are publicly visible.
        </p>
        <p>
          Inference requests — including prompts and parameters needed to run the model — are
          sent to the provider that serves the call:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-medium text-on-surface">io.net</strong> —{" "}
            <Ext href={PROVIDER_POLICY_URLS.ionetPrivacy}>Privacy Policy</Ext>. LMX routes
            through io.net&apos;s standard inference API. io.net documents{" "}
            <Ext href={PROVIDER_POLICY_URLS.ionetLoggingFaq}>
              90-day standard audit-log retention
            </Ext>{" "}
            for GPU/API activity (enterprise plans configurable up to seven years). A separate{" "}
            <Ext href={PROVIDER_POLICY_URLS.ionetConfidentialInference}>
              Confidential Inference
            </Ext>{" "}
            product documents zero retention of prompts and responses; LMX does not currently
            route through that product.
          </li>
          <li>
            <strong className="font-medium text-on-surface">AkashML</strong> —{" "}
            <Ext href={PROVIDER_POLICY_URLS.akashmlPrivacy}>Privacy Policy</Ext>. AkashML
            states it does not retain text prompts or transient API inputs after the request
            has been processed, except transient error logs deleted within 30 days and
            server/security logs that may remain up to 90 days.
          </li>
          <li>
            <strong className="font-medium text-on-surface">Aethir Mesh</strong> —{" "}
            <Ext href={PROVIDER_POLICY_URLS.aethirPrivacy}>Privacy Policy</Ext>. Aethir states
            it retains technical usage information and data on use of its services for 12
            months. Aethir Mesh&apos;s public product materials state that every request is
            logged (latency, token usage, cost, provider); they do not separately publish a
            prompt-content retention period.
          </li>
        </ul>
        <p>
          Those providers process prompts under their own published terms. We do not control
          their retention clocks; the linked policies may change.
        </p>
      </LegalSection>
      <LegalSection title="Retention">
        <p>
          We retain account and usage data while your account is active and as needed for
          billing, security, legal compliance, and dispute resolution. We may retain anonymized
          or aggregated statistics longer.
        </p>
        <p>
          Off-chain records (for example, dashboard account data, API key metadata, usage logs,
          and payment event rows in our database) may be deleted or anonymized when we honor a
          valid erasure request, subject to legal and operational retention needs. Public
          on-chain data and data held by third parties under their own retention policies are
          addressed in the third-party section above and in a privacy request — on-chain records
          are immutable and not deletable through us.
        </p>
      </LegalSection>
      <LegalSection title="Your rights">
        <p>
          Contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={LEGAL_LINK_CLASS}>
            {SUPPORT_EMAIL}
          </a>{" "}
          with subject <code className="text-mono-sm">Privacy request</code> for access,
          correction, or deletion where applicable.
        </p>
      </LegalSection>
      <LegalSection title="Source">
        <p>
          Full policy:{" "}
          <Ext href={`${GITHUB_LEGAL_DIR_URL}/privacy-policy.md`}>Privacy Policy on GitHub</Ext>.
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
      <LegalSection title="Rate limits">
        <p>
          We enforce rate limits per key, IP, and (for x402) per payer wallet. Excessive
          automated traffic that degrades the Service for others may be throttled or blocked.
          Beta capacity is limited; we do not guarantee unlimited throughput.
        </p>
        <p>
          Limits are applied in two layers. Defaults currently disclosed:
        </p>
        <DataTable minWidth={640}>
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Layer</DataTableTh>
              <DataTableTh>Scope</DataTableTh>
              <DataTableTh>Default</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Cloudflare edge</DataTableCell>
              <DataTableCell>
                Per IP, <code className="text-mono-sm">POST /v1/auth/key</code> only
              </DataTableCell>
              <DataTableCell>
                10 requests/hour, then blocked for 1 hour
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Application</DataTableCell>
              <DataTableCell>Per IP, key mint and SIWE nonce/verify</DataTableCell>
              <DataTableCell>5 requests/hour</DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Application</DataTableCell>
              <DataTableCell>Per API key, balance-funded chat</DataTableCell>
              <DataTableCell>30 requests/minute</DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Application</DataTableCell>
              <DataTableCell>
                Per x402 payer wallet (or IP if the payer is unknown)
              </DataTableCell>
              <DataTableCell>10 requests/minute</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
        <p>
          Exceeded application limits return HTTP <code className="text-mono-sm">429</code> with
          a <code className="text-mono-sm">Retry-After</code> header. The application limiter is
          in-memory and per process: it resets on deploy and does not share counters across
          multiple API instances. The Cloudflare edge rule survives redeploys and still applies
          if the API scales past a single instance; it covers only the unauthenticated key-mint
          path. See{" "}
          <Link to="/legal/security" className={LEGAL_LINK_CLASS}>
            Security
          </Link>{" "}
          for the same disclosed limits.
        </p>
      </LegalSection>
      <LegalSection title="Autonomous agents and x402">
        <p>
          Agents calling the Service without a human operator must still comply with this
          policy. Payment via x402 or USDC does not exempt callers from these rules. We may
          block wallets, IPs, or payment payloads associated with abuse. Liability for an
          agent&apos;s use, payments, and violations rests with the human or legal entity that
          deploys or operates the agent, as stated in{" "}
          <Link to="/legal/terms" className={LEGAL_LINK_CLASS}>
            Terms of Service
          </Link>
          , Autonomous agents and non-human counterparties.
        </p>
      </LegalSection>
      <LegalSection title="Report abuse">
        <p>
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={LEGAL_LINK_CLASS}>
            {SUPPORT_EMAIL}
          </a>{" "}
          with subject <code className="text-mono-sm">Abuse report</code>. Include timestamps and
          wallet or key IDs — never full API key secrets.
        </p>
      </LegalSection>
      <LegalSection title="Source">
        <p>
          Full policy:{" "}
          <Ext href={`${GITHUB_LEGAL_DIR_URL}/acceptable-use.md`}>
            Acceptable Use Policy on GitHub
          </Ext>
          .
        </p>
      </LegalSection>
    </>
  );
}

function SecurityContent() {
  return (
    <>
      <LegalSection title="Scope">
        <p>
          External summary of how production traffic is protected today. Edge protection covers
          the API and MCP services on Railway (<code className="text-mono-sm">api.lmxcloud.io</code>
          , <code className="text-mono-sm">mcp.lmxcloud.io</code>). The dashboard on Vercel is
          out of scope for Cloudflare hardening — it already sits behind Vercel&apos;s edge and
          is Clerk-gated.
        </p>
        <p>
          Working log of decisions:{" "}
          <Ext href={`${GITHUB_REPO_URL}/blob/main/ROADMAP.md`}>ROADMAP.md</Ext>. Deploy steps
          and env vars:{" "}
          <Ext href={`${GITHUB_REPO_URL}/blob/main/DEPLOY.md`}>DEPLOY.md</Ext>. This page
          mirrors{" "}
          <Ext href={GITHUB_SECURITY_URL}>SECURITY.md</Ext>.
        </p>
      </LegalSection>
      <LegalSection title="Edge protection (Cloudflare)">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <code className="text-mono-sm">lmxcloud.io</code> is registered through Cloudflare
            Registrar. DNS has been on Cloudflare since day one.
          </li>
          <li>
            <code className="text-mono-sm">api.lmxcloud.io</code> and{" "}
            <code className="text-mono-sm">mcp.lmxcloud.io</code> are proxied through Cloudflare
            to Railway.
          </li>
          <li>
            The dashboard (<code className="text-mono-sm">www.lmxcloud.io</code> /{" "}
            <code className="text-mono-sm">lmxcloud.io</code>) points at Vercel unproxied (DNS
            only) — Vercel provides its own edge network.
          </li>
          <li>SSL/TLS mode: Full (Strict) (Railway terminates TLS on its own domain).</li>
          <li>DDoS protection: on by default at the Cloudflare edge (Free plan).</li>
        </ul>
      </LegalSection>
      <LegalSection title="Rate limiting">
        <p>
          Two layers. Exceeded application limits return HTTP{" "}
          <code className="text-mono-sm">429</code> with a{" "}
          <code className="text-mono-sm">Retry-After</code> header.
        </p>
        <DataTable minWidth={640}>
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Layer</DataTableTh>
              <DataTableTh>Where</DataTableTh>
              <DataTableTh>What</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Edge</DataTableCell>
              <DataTableCell>
                Cloudflare rule <code className="text-mono-sm">auth-key-limit</code>
              </DataTableCell>
              <DataTableCell>
                Blocks an IP after 10 requests/hour to{" "}
                <code className="text-mono-sm">POST /v1/auth/key</code> (the one
                unauthenticated route), for 1 hour
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>App</DataTableCell>
              <DataTableCell>
                In-memory limiter (
                <Ext href={`${GITHUB_REPO_URL}/blob/main/apps/api/src/rate-limit.ts`}>
                  rate-limit.ts
                </Ext>
                )
              </DataTableCell>
              <DataTableCell>
                Defaults: 5 requests/hour per IP on key mint and SIWE; 30 requests/minute per
                API key on balance-funded chat; 10 requests/minute per x402 payer wallet (or IP
                if the payer is unknown)
              </DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
        <p>
          The Cloudflare rule is a second layer on top of the app limiter. Edge rules survive
          Railway redeploys and still apply if the API scales past a single instance; the
          in-memory app limiter does not (it resets on deploy and is not shared across
          instances).
        </p>
      </LegalSection>
      <LegalSection title="Origin lock">
        <p>
          Raw Railway hostnames (<code className="text-mono-sm">*.up.railway.app</code>) still
          resolve if someone knows them. Origin lock makes those URLs useless for API/MCP
          traffic unless the request came through Cloudflare.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Code:{" "}
            <Ext href={`${GITHUB_REPO_URL}/blob/main/apps/api/src/origin-lock.ts`}>
              API origin-lock
            </Ext>
            ,{" "}
            <Ext href={`${GITHUB_REPO_URL}/blob/main/apps/mcp-server/src/origin-lock.ts`}>
              MCP origin-lock
            </Ext>
          </li>
          <li>
            A Cloudflare Request Header Transform Rule injects{" "}
            <code className="text-mono-sm">X-Origin-Secret</code> on every request forwarded to{" "}
            <code className="text-mono-sm">api.lmxcloud.io</code> /{" "}
            <code className="text-mono-sm">mcp.lmxcloud.io</code>
          </li>
          <li>
            The app compares the header (timing-safe) to{" "}
            <code className="text-mono-sm">LMX_ORIGIN_SECRET</code> on Railway
          </li>
          <li>Missing or wrong header → 403</li>
          <li>
            Exempt: <code className="text-mono-sm">/health</code> (API) and{" "}
            <code className="text-mono-sm">/healthz</code> (MCP) so Railway healthchecks keep
            working
          </li>
          <li>
            Local / pre-edge: check no-ops when{" "}
            <code className="text-mono-sm">LMX_ORIGIN_SECRET</code> is unset
          </li>
        </ul>
        <p>
          Cloudflare rejects Transform Rules that set headers starting with{" "}
          <code className="text-mono-sm">Cf-</code> (reserved). Use{" "}
          <code className="text-mono-sm">X-Origin-Secret</code>, not{" "}
          <code className="text-mono-sm">Cf-Origin-Secret</code>.
        </p>
        <p>
          Verified live (API, 2026-07-12): raw{" "}
          <code className="text-mono-sm">*.up.railway.app</code> blocked on non-health routes;{" "}
          <code className="text-mono-sm">api.lmxcloud.io</code> through Cloudflare unaffected.
          MCP not yet verified live — blocked on a Railway plan limit (see Known gaps).
        </p>
      </LegalSection>
      <LegalSection title="Known gaps / deferred">
        <p>
          These are conscious tradeoffs, not oversights. Revisit before public agent-discovery
          listing unless noted otherwise.
        </p>
        <DataTable minWidth={720}>
          <DataTableHead>
            <DataTableRow>
              <DataTableTh>Gap</DataTableTh>
              <DataTableTh>Status</DataTableTh>
              <DataTableTh>Why deferred / what to do</DataTableTh>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>WAF (Cloudflare OWASP Managed Ruleset)</DataTableCell>
              <DataTableCell>Not enabled (as of 2026-07-12)</DataTableCell>
              <DataTableCell>
                Requires Cloudflare Pro. Relying on edge rate limiting + default DDoS
                protection for now.
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>
                <code className="text-mono-sm">mcp.lmxcloud.io</code> custom domain
              </DataTableCell>
              <DataTableCell>Not on Railway yet</DataTableCell>
              <DataTableCell>
                Trial plan caps custom domains at 1 account-wide. Origin-lock code is deployed
                to the MCP service but cannot be verified end-to-end until Railway is upgraded
                and the custom domain is attached.
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>Bot Fight Mode / Super Bot Fight Mode</DataTableCell>
              <DataTableCell>Status not explicitly confirmed</DataTableCell>
              <DataTableCell>
                Should stay OFF on API/MCP. Legitimate traffic is autonomous agents (no
                browser, no human) — aggressive bot scoring is a footgun. DDoS + WAF (when
                enabled) are safe; bot scoring is not.
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>In-memory rate limiter + SIWE nonce store</DataTableCell>
              <DataTableCell>Fine for single-instance beta</DataTableCell>
              <DataTableCell>
                Resets on deploy; ineffective across multiple Railway instances. Cloudflare
                edge rate limiting partially mitigates for the auth-key path only. Real fix
                before multi-instance scale: Redis-backed (or equivalent) limiter and nonce
                store.
              </DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      </LegalSection>
      <LegalSection title="Reporting">
        <p>
          If you believe you&apos;ve found a vulnerability in LMX Cloud, please open a private
          report via{" "}
          <Ext href={GITHUB_SECURITY_ADVISORIES_URL}>GitHub Security Advisories</Ext> (or
          contact the maintainers through the channels listed on{" "}
          <Link to="/" className={LEGAL_LINK_CLASS}>
            lmxcloud.io
          </Link>
          ). Do not open a public issue for exploitable findings.
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
          <a href={`mailto:${SUPPORT_EMAIL}`} className={LEGAL_LINK_CLASS}>
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
