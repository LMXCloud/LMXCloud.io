import { Chip } from "./ui/Chip";

const PARTNERS = [
  "io.net",
  "AkashML",
  "Aethir Mesh",
  "Base",
  "x402",
  "USDC",
  "OpenAI-compatible",
  "MCP Registry",
  "ElizaOS",
  "Coinbase Bazaar",
  "Llama",
  "DeepSeek",
  "Qwen",
] as const;

function MarqueeTrack() {
  return (
    <div className="flex shrink-0 items-center gap-3 pr-3">
      {PARTNERS.map((partner) => (
        <Chip key={partner} tone="default" className="shrink-0">
          {partner}
        </Chip>
      ))}
    </div>
  );
}

export function PartnerMarquee() {
  return (
    <section className="border-b border-border bg-surface/50 py-3" aria-label="Ecosystem partners">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,4vw,48px)]">
        <p className="mb-3 text-center text-label-sm text-on-surface-faint">
          Routed across DePIN · paid on Base · compatible everywhere
        </p>
        <div className="overflow-hidden mask-[linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="partner-marquee-track flex w-max items-center">
            <MarqueeTrack />
            <MarqueeTrack />
          </div>
        </div>
      </div>
    </section>
  );
}
