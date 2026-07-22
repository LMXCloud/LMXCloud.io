import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";

const FAQ_ITEMS = [
  {
    id: "wallet",
    question: "Do I need a wallet to get started?",
    answer:
      "No. Developers can sign in with email, get $1.00 in credits, and use an API key immediately. Wallet auth (SIWE) and USDC on Base are optional for funding — agents can skip accounts entirely and pay per call via x402.",
  },
  {
    id: "x402",
    question: "How does x402 work for autonomous agents?",
    answer:
      "Agents call /v1/chat/completions directly. The API responds with HTTP 402 and per-model pricing in USDC on Base. After payment settles, inference is routed across DePIN providers — no API key or pre-funded balance required.",
  },
  {
    id: "failover",
    question: "What happens when a DePIN provider fails?",
    answer:
      "LMX Cloud measures provider reliability and automatically fails over to the next network in the route. Response headers show which provider served each call and whether fallback was used.",
  },
  {
    id: "receipts",
    question: "Are usage claims independently verifiable?",
    answer:
      "Yes. Every request gets a cryptographic receipt, batched into Merkle roots anchored on Base. You can verify routing and billing claims outside the dashboard — not just trust reported numbers.",
  },
  {
    id: "openai",
    question: "Is it really OpenAI-compatible?",
    answer:
      "Same /v1/chat/completions endpoint and request format. Point your OpenAI SDK at api.lmxcloud.io with an lmx_ API key — streaming, tool calls, and existing agents work with minimal changes.",
  },
] as const;

export function LandingFaq() {
  const [openId, setOpenId] = useState<string | null>(FAQ_ITEMS[0]?.id ?? null);

  return (
    <section id="faq" className="border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-label-sm text-primary">FAQ</p>
          <h2 className="mt-2 text-headline-lg text-on-surface">Common questions</h2>
          <p className="mt-3 text-body-md text-on-surface-muted">
            Routing, payments, and verification — the essentials before your first request.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl divide-y divide-border rounded-lg border border-border bg-surface">
          {FAQ_ITEMS.map((item) => {
            const open = openId === item.id;
            return (
              <div key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-elevated/60"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  <span className="text-body-md font-medium text-on-surface">{item.question}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-on-surface-muted transition-transform duration-200",
                      open && "rotate-180",
                    )}
                    strokeWidth={1.75}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-4 text-body-sm leading-relaxed text-on-surface-muted">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
