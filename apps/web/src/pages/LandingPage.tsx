import { SignedIn, SignedOut } from "@clerk/clerk-react";
import {
  ArrowRight,
  BarChart3,
  Code2,
  Globe2,
  Layers,
  Plug,
  Route,
  Shield,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { LandingChat } from "../components/LandingChat";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { cn } from "../lib/cn";
import { formatHeroSavings, getHeroSavingsHint } from "../lib/openai-benchmark";

const PROVIDERS = ["io.net", "AkashML", "RunPod", "Auto-fallback"];

const HERO_STATS = [
  {
    label: "Cost savings",
    value: formatHeroSavings(),
    hint: getHeroSavingsHint(),
    tone: "success" as const,
  },
  {
    label: "Zero lock-in",
    value: "3",
    unit: "networks",
    hint: "DePIN routing · auto-failover",
    tone: "info" as const,
  },
  {
    label: "Free to start",
    value: "$1",
    unit: "credits",
    hint: "Instant API key · no card",
    tone: "primary" as const,
  },
];

const FEATURES = [
  {
    icon: Plug,
    title: "Drop-in compatible",
    description: "Same endpoints and request format as OpenAI. Swap the base URL — keep your SDK.",
    accent: "primary" as const,
  },
  {
    icon: Route,
    title: "Smart routing",
    description: "Route by cost, latency, or DePIN-only. Automatic failover when a node goes dark.",
    accent: "info" as const,
  },
  {
    icon: Shield,
    title: "Resilient by design",
    description: "No single vendor lock-in. Requests fan across decentralized compute networks.",
    accent: "success" as const,
  },
  {
    icon: Zap,
    title: "Low-latency paths",
    description: "Provider selection weighs real-time latency so responses stay snappy under load.",
    accent: "warning" as const,
  },
  {
    icon: BarChart3,
    title: "Usage dashboard",
    description: "Track tokens, spend, and API keys from a unified console with per-key breakdowns.",
    accent: "primary" as const,
  },
  {
    icon: Globe2,
    title: "OpenAI benchmarks",
    description: "Every response shows cost and savings vs equivalent OpenAI models — live in the demo.",
    accent: "info" as const,
  },
];

const STEPS = [
  {
    step: "01",
    title: "Create account",
    body: "Sign up with email via Clerk. No password vault to manage — $1.00 credits included.",
  },
  {
    step: "02",
    title: "Generate API key",
    body: "Open the console, create a key, and copy it once. Session keys link to your account.",
  },
  {
    step: "03",
    title: "Send requests",
    body: "Point your OpenAI client at LMX Cloud and call /v1/chat/completions.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-[clamp(20px,4vw,48px)]">
          <Link to="/" className="group flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary bg-primary/10">
              <Layers className="h-4 w-4 text-primary" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-title-md text-on-surface leading-tight">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint leading-tight">Inference router</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {[
              { href: "#features", label: "Features" },
              { href: "#how-it-works", label: "How it works" },
              { href: "#try-chat", label: "Live demo" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-body-sm text-on-surface-muted transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface"
              >
                {item.label}
              </a>
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
                  <Chip tone="info">DePIN-powered</Chip>
                </div>
                <h1 className="text-display font-semibold text-on-surface">
                  Cheaper, resilient LLM inference
                </h1>
                <p className="mt-2 text-headline-md font-semibold text-on-surface-muted">
                  through decentralized compute
                </p>
                <p className="mt-6 max-w-lg text-body-md text-on-surface-muted">
                  LMX Cloud routes your requests across io.net, AkashML, and other providers with
                  automatic fallback. Drop in your existing OpenAI SDK — or try the live chat demo
                  with a free throwaway key.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button to="/sign-up" size="lg">
                    Create free account
                    <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  <Button href="#try-chat" variant="secondary" size="lg">
                    Try the chat
                  </Button>
                </div>

                <div className="mt-10 grid min-w-0 gap-3.5 sm:grid-cols-3">
                  {HERO_STATS.map((stat) => (
                    <HeroStat key={stat.label} {...stat} />
                  ))}
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-2">
                  <span className="text-label-sm text-on-surface-faint">Routed via</span>
                  {PROVIDERS.map((name) => (
                    <Chip key={name} tone="default">
                      {name}
                    </Chip>
                  ))}
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
              title="Built for production inference"
              description="Everything you need to ship LLM features without rebuilding your stack or betting on one provider."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
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
                  description="Keep your OpenAI SDK. Change the base URL and API key — routing, metering, and fallback happen automatically."
                />
                <ul className="mt-8 space-y-3">
                  {["Same /v1/chat/completions endpoint", "Streaming supported", "Usage headers on every response"].map(
                    (item) => (
                      <li key={item} className="flex items-center gap-3 text-body-sm text-on-surface-muted">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-success/30 bg-success/10">
                          <Code2 className="h-3 w-3 text-success" strokeWidth={1.75} />
                        </span>
                        {item}
                      </li>
                    ),
                  )}
                </ul>
                <Button to="/sign-up" className="mt-8">
                  Get your API key
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

        {/* How it works */}
        <section id="how-it-works" className="border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
            <SectionHeader
              eyebrow="Workflow"
              title="Get started in three steps"
              description="From signup to first request in under five minutes."
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
                  Start with $1.00 in free credits
                </h2>
                <p className="mt-2 max-w-md text-body-sm text-on-surface-muted">
                  Create an account, open the console, and send your first chat completion in minutes.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button to="/sign-up" size="lg">
                  Create free account
                </Button>
                <Button to="/sign-in" variant="secondary" size="lg">
                  Sign in
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
              <p className="text-body-sm text-on-surface-faint">Decentralized inference infrastructure</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-body-sm text-on-surface-muted">
            <a href="#features" className="hover:text-on-surface">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-on-surface">
              How it works
            </a>
            <a href="#try-chat" className="hover:text-on-surface">
              Live demo
            </a>
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
