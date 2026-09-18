import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  docPath,
  type DocPage,
} from "../../content/docs/sections";
import { absoluteUrl } from "../../lib/seo";
import { Button } from "../ui/Button";

export function CopyPageButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(path));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" pill onClick={() => void handleCopy()}>
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {copied ? "Copied" : "Copy page"}
    </Button>
  );
}

export function DocsPager({
  prev,
  next,
  nextCta,
}: {
  prev: DocPage | null;
  next: DocPage | null;
  nextCta?: string;
}) {
  if (!prev && !next) return null;

  return (
    <div className="mt-16 border-t border-border pt-10">
      {prev ? (
        <Link
          to={docPath(prev.id)}
          className="inline-flex min-h-11 items-center gap-2 text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {prev.label}
        </Link>
      ) : null}

      {next ? (
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-label-sm text-on-surface-faint">Next</p>
            <h2 className="mt-2 text-headline-lg text-on-surface">{next.heading}</h2>
            <p className="mt-2 max-w-xl text-body-sm text-on-surface-muted">{next.description}</p>
          </div>
          <Button to={docPath(next.id)} size="lg" className="shrink-0">
            {nextCta ?? "Continue"}
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
