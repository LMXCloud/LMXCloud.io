import { SignedIn, SignedOut } from "@clerk/clerk-react";
import {
  DEFAULT_MODEL_ALIAS,
  listUniqueModelAliases,
  MODEL_CATEGORIES,
  type ModelCategory,
  type SupportedModel,
} from "@lmxcloud/shared";
import {
  ArrowRight,
  Bot,
  Code2,
  FileCheck,
  Layers,
  Plug,
  Route,
  Shield,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { LandingChat } from "../components/LandingChat";
import { SeoHead } from "../components/SeoHead";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { cn } from "../lib/cn";
import { formatHeroSavings, getHeroSavingsHint } from "../lib/openai-benchmark";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "../lib/seo";

const SUPPORTED_MODEL_LIST = listUniqueModelAliases();

const MODELS_BY_CATEGORY = SUPPORTED_MODEL_LIST.reduce<
  Partial<Record<ModelCategory, SupportedModel[]>>
>((groups, model) => {
  const bucket = groups[model.category] ?? [];
  bucket.push(model);
  groups[model.category] = bucket;
  return groups;
}, {});


const CATEGORY_ORDER: ModelCategory[] = [
  "meta",
  "qwen",
  "deepseek",
  "glm",
  "mistral",
  "kimi",
  "openai",
  "google",
  "minimax",
];

const HERO_STATS = [
  {
    label: "Cost savings",
    value: formatHeroSavings(),
    hint: getHeroSavingsHint(),
    tone: "success" as const,
  },
  {
    label: "DePIN routing",
    value: "2",
    unit: "networks",
    hint: "io.net + Akash · auto-failover",
    tone: "info" as const,
  },
  {
    label: "Model catalog",
    value: String(SUPPORTED_MODEL_LIST.length),
    unit: "models",
    hint: "Llama, Qwen, DeepSeek & more",
    tone: "primary" as const,
  },
];

const FEATURES = [
  {
    icon: Plug,
    title: "Drop-in compatible",
    description:
      "Same endpoints and request format as OpenAI. Swap the base URL — keep your SDK, agents, and tooling.",
    accent: "primary" as const,
  },
  {
    icon: Route,
    title: "DePIN routing",
    description:
      "Route by cost, latency, or DePIN-only across io.net and Akash. Automatic failover when a provider goes dark.",
    accent: "info" as const,
  },
  {
    icon: Bot,
    title: "x402 pay-per-call",
    description:
      "Agents pay per request in USDC on Base — no signup, no API key, no pre-funded balance. HTTP 402 with a price, pay, get inference.",
    accent: "warning" as const,
  },
  {
    icon: Wallet,
    title: "Wallet identity",
    description:
      "Sign in with Ethereum (SIWE) from a browser wallet or a raw keypair script. Fund with USDC on Base — no corporate card required.",
    accent: "success" as const,
  },
  {
    icon: FileCheck,
    title: "Verifiable logs",
    description:
      "Every request gets a cryptographic receipt, batched into Merkle roots anchored on Base. Independently verify routing claims — not just dashboard numbers.",
    accent: "primary" as const,
  },
  {
    icon: Shield,
    title: "Resilient by design",
    description:
      "No single-vendor lock-in. Transparent headers show which provider served each call and whether fallback kicked in.",
    accent: "info" as const,
  },
];

const AUDIENCES = [
  {
    icon: Code2,
    title: "Developers",
    body: "Sign in with email or wallet, fund with USDC on Base, and manage keys, usage, and billing from the console. $1.00 in credits to start.",
    cta: { label: "Open console", to: "/sign-up" as const },
  },
  {
    icon: Bot,
    title: "Autonomous agents",
    body: "Call the API with no prior relationship. Receive HTTP 402 with per-model pricing, pay in USDC via x402, and get routed DePIN inference back — no account setup.",
    cta: { label: "View x402 docs", to: "/docs#pricing" as const },
  },
];

const STEPS = [
  {
    step: "01",
    title: "Choose how you connect",
    body: "Developers: sign in with email or wallet and mint an API key. Agents: skip signup — call /v1/chat/completions directly and follow the x402 payment flow.",
  },
  {
    step: "02",
    title: "Pay in stablecoin",
    body: "Fund a balance with USDC on Base, or pay per call via x402. No Stripe, no corporate billing entity — stablecoin rails built for humans and headless agents alike.",
  },
  {
    step: "03",
    title: "Get routed inference",
    body: "OpenAI-compatible chat completions across io.net and Akash, with streaming, transparent fallback, and verifiable receipts on every call.",
  },
];

const MCP_ONBOARDING_STEPS = [
  {
    step: "01",
    title: "Get an API key",
    body: "Create a key from the console and fund your balance for inference.",
  },
  {
    step: "02",
    title: "Add MCP config",
    body: "Set lmxcloud to https://mcp.lmxcloud.io/mcp and add Authorization: Bearer lmx_YOUR_KEY in .cursor/mcp.json headers.",
  },
  {
    step: "03",
    title: "Check balance and run",
    body: "Call get_balance, quote_price, then chat_completion with llama-3-70b to confirm end-to-end routing and billing.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SeoHead title={DEFAULT_TITLE} description={DEFAULT_DESCRIPTION} path="/" />
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-[clamp(20px,4vw,48px)]">
          <Link to="/" className="group flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary bg-primary/10">
              <Layers className="h-4 w-4 text-primary" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-title-md text-on-surface leading-tight">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint leading-tight">Web3-native inference</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {(
              [
                { href: "#features", label: "Features" },
                { href: "#for-agents", label: "For agents" },
                { href: "#models", label: "Models" },
                { href: "#how-it-works", label: "How it works" },
                { href: "#try-chat", label: "Live demo" },
              ] as const
            ).map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-body-sm text-on-surface-muted transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface"
              >
                {item.label}
              </a>
            ))}
            {(
              [
                { to: "/docs", label: "Docs" },
                { to: "/status", label: "Status" },
              ] as const
            ).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-2 text-body-sm text-on-surface-muted transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <SignedOut>
              <Button to="/sign-in" variant="tertiary" size="sm">
                Sign in
              </Button>
              <Button to="/sign-up" size="sm">
                Get started
              </Button>
            </SignedOut>
            <SignedIn>
              <Button to="/console/overview" size="sm">
                Open console
              </Button>
            </SignedIn>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            aria-hidden
            style={{
              backgroundImage: `
                linear-gradient(to right, var(--color-border) 1px, transparent 1px),
                linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
              `,
              backgroundSize: "64px 64px",
            }}
          />
          <div className="relative mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)] py-16 sm:py-20 lg:py-24">
            <div className="grid items-start gap-12 lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_460px]">
              <div className="max-w-xl">
                <div className="mb-5 flex flex-wrap gap-2">
                  <Chip tone="primary">OpenAI-compatible</Chip>
                  <Chip tone="info">DePIN routing</Chip>
                  <Chip tone="success">x402 · USDC on Base</Chip>
                </div>
                <h1 className="text-display font-semibold text-on-surface">
                  Inference infrastructure
                </h1>
                <p className="mt-2 text-headline-md font-semibold text-on-surface-muted">
                  for <span className="text-primary">developers</span> and{" "}
                  <span className="text-primary">autonomous agents</span>
                </p>
                <p className="mt-6 max-w-lg text-body-md text-on-surface-muted">
                  LMX Cloud routes chat completions across io.net and Akash with automatic fallback.
                  Human developers get a dashboard, wallet auth, and USDC funding. Agents pay per
                  call via x402 — no signup, no API key. Drop in your OpenAI SDK or try the live
                  demo below.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button to="/sign-up" size="lg">
                    Get started free
                    <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  <Button to="/docs#pricing" variant="secondary" size="lg">
                    Agent payments (x402)
                  </Button>
                  <Button to="/docs#mcp" variant="secondary" size="lg">
                    Use via MCP
                  </Button>
                </div>

                <div className="mt-10 grid min-w-0 gap-3.5 sm:grid-cols-3">
                  {HERO_STATS.map((stat) => (
                    <HeroStat key={stat.label} {...stat} />
                  ))}
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label-sm text-on-surface-faint">Routed via</span>
                    <Chip tone="default">io.net</Chip>
                    <Chip tone="default">AkashML</Chip>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label-sm text-on-surface-faint">Payments</span>
                    <Chip tone="success">x402</Chip>
                    <Chip tone="success">USDC on Base</Chip>
                  </div>
                </div>
              </div>

              <div id="try-chat" className="w-full lg:sticky lg:top-24">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-label-sm text-on-surface-muted">Live demo</p>
                  <Chip tone="success" className="gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    No signup
                  </Chip>
                </div>
                <LandingChat />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <SectionHeader
              eyebrow="Platform"
              title="Web3-native inference, DePIN-backed"
              description="OpenAI-compatible routing across decentralized compute — with stablecoin payments, wallet identity, and independently verifiable usage receipts."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        {/* For agents / developers */}
        <section id="for-agents" className="border-b border-border py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <SectionHeader
              eyebrow="Two ways in"
              title="Built for humans and headless agents"
              description="The same routed inference endpoint — whether you manage keys in a dashboard or pay per call with zero prior relationship."
            />
            <div className="mt-12 grid gap-4 md:grid-cols-2">
              {AUDIENCES.map((audience) => (
                <AudienceCard key={audience.title} {...audience} />
              ))}
            </div>
            <p className="mt-8 max-w-3xl text-body-sm text-on-surface-muted">
              <span className="text-label-sm text-on-surface-faint">Coming soon — Phase 1 distribution</span>
              <span className="mt-2 block">
                Listings on x402 Bazaar, Agentic.Market, an MCP server, and an ElizaOS plugin — so
                agents can discover and pay for inference without a manual integration.
              </span>
            </p>
          </div>
        </section>

        {/* Models */}
        <section id="models" className="border-b border-border py-12 sm:py-16">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <SectionHeader
                  eyebrow="Model catalog"
                  title={`${SUPPORTED_MODEL_LIST.length} models on DePIN`}
                  description={`Default ${DEFAULT_MODEL_ALIAS}. Short aliases route across io.net and AkashML with automatic failover.`}
                />
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button to="/docs#models" variant="secondary" size="sm">
                  Full reference
                </Button>
                <Button to="/status" variant="tertiary" size="sm">
                  Provider status
                </Button>
              </div>
            </div>

            <Card className="mt-8 p-5 sm:p-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {CATEGORY_ORDER.map((category) => (
                  <ModelCategoryBlock
                    key={category}
                    category={category}
                    models={MODELS_BY_CATEGORY[category]}
                  />
                ))}
              </div>
            </Card>
          </div>
        </section>

        {/* Code snippet */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <SectionHeader
                  eyebrow="Integration"
                  title="Three lines to switch"
                  description="Keep your OpenAI SDK. Change the base URL and API key — routing, metering, fallback, and receipts happen automatically."
                />
                <ul className="mt-8 space-y-3">
                  {[
                    "Same /v1/chat/completions endpoint",
                    "Streaming supported (Bearer auth path)",
                    "x402 per-call payments for agent workflows",
                    "Verifiable receipts anchored on Base",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-body-sm text-on-surface-muted">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-success/30 bg-success/10">
                        <Code2 className="h-3 w-3 text-success" strokeWidth={1.75} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <Button to="/docs" variant="secondary" className="mt-8">
                  Read the docs
                </Button>
              </div>
              <Card variant="elevated" className="overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-error/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
                  <span className="ml-2 text-mono-sm text-on-surface-faint">openai_client.py</span>
                </div>
                <pre className="overflow-x-auto p-5 text-mono-sm leading-relaxed text-on-surface-muted">
                  <code>{CODE_EXAMPLE}</code>
                </pre>
              </Card>
            </div>
          </div>
        </section>

        {/* MCP onboarding */}
        <section className="border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <SectionHeader
              eyebrow="MCP quickstart"
              title="Connect agents in 3 steps"
              description="Use the hosted MCP endpoint as the default integration path. Keep local --dir config for development only."
              centered
            />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {MCP_ONBOARDING_STEPS.map((step) => (
                <Card key={step.step} accent="info">
                  <p className="text-metric text-info/30">{step.step}</p>
                  <h3 className="mt-3 text-title-md text-on-surface">{step.title}</h3>
                  <p className="mt-2 text-body-sm text-on-surface-muted">{step.body}</p>
                </Card>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button to="/docs#mcp" size="lg">
                MCP quickstart
              </Button>
              <Button to="/console/keys" variant="secondary" size="lg">
                Get API key
              </Button>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <SectionHeader
              eyebrow="Workflow"
              title="From wallet to first request"
              description="Developers and agents share the same inference layer — only the payment and identity path differs."
              centered
            />
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <Card key={step.step} accent="primary" className="relative">
                  {index < STEPS.length - 1 && (
                    <div
                      className="pointer-events-none absolute top-1/2 -right-2 hidden h-px w-4 bg-border-strong md:block lg:-right-3 lg:w-6"
                      aria-hidden
                    />
                  )}
                  <p className="text-metric text-primary/30">{step.step}</p>
                  <h3 className="mt-3 text-title-md text-on-surface">{step.title}</h3>
                  <p className="mt-2 text-body-sm text-on-surface-muted">{step.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <Card accent="success" className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-label-sm text-success">Ready to route</p>
                <h2 className="mt-2 text-headline-md text-on-surface">
                  Start building on Web3-native inference
                </h2>
                <p className="mt-2 max-w-md text-body-sm text-on-surface-muted">
                  Developers: create an account with $1.00 in credits, or connect a wallet and fund
                  with USDC. Agents: read the x402 docs and pay per call — no signup required.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button to="/sign-up" size="lg">
                  Get started free
                </Button>
                <Button to="/docs#pricing" variant="secondary" size="lg">
                  x402 for agents
                </Button>
              </div>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-[clamp(20px,4vw,48px)] py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-elevated">
              <Layers className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-body-sm font-medium text-on-surface">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint">Web3-native inference infrastructure</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-body-sm text-on-surface-muted">
            <a href="#features" className="hover:text-on-surface">
              Features
            </a>
            <a href="#for-agents" className="hover:text-on-surface">
              For agents
            </a>
            <a href="#models" className="hover:text-on-surface">
              Models
            </a>
            <a href="#how-it-works" className="hover:text-on-surface">
              How it works
            </a>
            <a href="#try-chat" className="hover:text-on-surface">
              Live demo
            </a>
            <Link to="/docs" className="hover:text-on-surface">
              Docs
            </Link>
            <Link to="/status" className="hover:text-on-surface">
              Status
            </Link>
            <Link to="/legal/terms" className="hover:text-on-surface">
              Terms
            </Link>
            <Link to="/legal/privacy" className="hover:text-on-surface">
              Privacy
            </Link>
            <Link to="/sign-up" className="hover:text-on-surface">
              Console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const CODE_EXAMPLE = `from openai import OpenAI

client = OpenAI(
    base_url="https://api.lmxcloud.io/v1",
    api_key="lmx_...",
)

response = client.chat.completions.create(
    model="llama-3-70b",
    messages=[{"role": "user", "content": "Hello!"}],
)`;

function SectionHeader({
  eyebrow,
  title,
  description,
  centered,
}: {
  eyebrow: string;
  title: string;
  description: string;
  centered?: boolean;
}) {
  return (
    <div className={cn(centered && "mx-auto max-w-2xl text-center")}>
      <p className="text-label-sm text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-headline-lg text-on-surface">{title}</h2>
      <p className="mt-3 text-body-md text-on-surface-muted">{description}</p>
    </div>
  );
}

function HeroStat({
  label,
  value,
  unit,
  tone,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: "success" | "info" | "primary";
  hint: string;
}) {
  const hairline = {
    success: "bg-success",
    info: "bg-info",
    primary: "bg-primary",
  }[tone];

  return (
    <div className="relative flex min-h-[6.75rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface px-5 py-4">
      <div className={cn("absolute inset-x-0 top-0 h-0.5", hairline)} aria-hidden />
      <p className="text-label-sm text-on-surface-muted">{label}</p>
      <div className="mt-2.5 flex min-h-[2.125rem] flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-hero-stat text-on-surface">{value}</span>
        {unit ? (
          <span className="text-title-md font-medium text-on-surface-muted">{unit}</span>
        ) : null}
      </div>
      <p className="mt-auto pt-2.5 text-body-sm leading-snug text-on-surface-faint">{hint}</p>
    </div>
  );
}

function AudienceCard({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon: typeof Code2;
  title: string;
  body: string;
  cta: { label: string; to: string };
}) {
  return (
    <Card accent="primary" className="flex h-full flex-col">
      <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
        <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
      </span>
      <h3 className="text-title-md text-on-surface">{title}</h3>
      <p className="mt-2 flex-1 text-body-sm text-on-surface-muted">{body}</p>
      <Button to={cta.to} variant="secondary" size="sm" className="mt-6 w-fit">
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Button>
    </Card>
  );
}

function ModelCategoryBlock({
  category,
  models,
}: {
  category: ModelCategory;
  models?: SupportedModel[];
}) {
  if (!models?.length) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-label-sm font-medium text-on-surface">{MODEL_CATEGORIES[category]}</h3>
        <span className="text-mono-sm text-on-surface-faint">{models.length}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {models.map((model) => (
          <span
            key={model.alias}
            title={`${model.label} · ${model.providers.map((p) => (p === "ionet" ? "io.net" : p === "akash" ? "AkashML" : "Nosana")).join(" + ")}`}
            className="rounded border border-border bg-background px-2 py-0.5 text-mono-sm text-on-surface-muted"
          >
            {model.alias}
          </span>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: typeof Plug;
  title: string;
  description: string;
  accent: "primary" | "info" | "success" | "warning";
}) {
  const iconTone = {
    primary: "text-primary border-primary/30 bg-primary/10",
    info: "text-info border-info/30 bg-info/10",
    success: "text-success border-success/30 bg-success/10",
    warning: "text-warning border-warning/30 bg-warning/10",
  }[accent];

  return (
    <Card
      accent={accent}
      className="transition-colors duration-base ease-standard hover:bg-elevated"
    >
      <span
        className={cn(
          "mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md border",
          iconTone,
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="text-title-md text-on-surface">{title}</h3>
      <p className="mt-2 text-body-sm text-on-surface-muted">{description}</p>
    </Card>
  );
}
