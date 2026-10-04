import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { lookupError, verifySettlement } from "./api";
import { BrandMark } from "./components/BrandMark";
import { Button } from "./components/Button";
import { Chip } from "./components/Chip";
import { formatTimestamp } from "./format";
import { cn } from "./lib/cn";
import type { AnchorView, CheckStatus, VerificationResult, VerdictId } from "./verify";

const SITE_URL = "https://lmxcloud.io";
const YEAR = new Date().getFullYear();

const CHECK_LABEL: Record<CheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  pending: "Pending",
};

const CHECK_TONE: Record<CheckStatus, "success" | "error" | "warning"> = {
  pass: "success",
  fail: "error",
  pending: "warning",
};

const VERDICT_TONE: Record<VerdictId, "success" | "error" | "warning"> = {
  verified: "success",
  pending: "warning",
  does_not_verify: "error",
};

function readQuery(): string {
  return new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
}

function rememberQuery(value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("id", value);
  window.history.replaceState(null, "", url);
}

export function App() {
  const [query, setQuery] = useState(readQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);

  const submit = useCallback(async (raw: string) => {
    const value = raw.trim();
    const invalid = lookupError(value);
    if (invalid) {
      setError(invalid);
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    rememberQuery(value);

    try {
      setResult(await verifySettlement(value));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify this receipt.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = readQuery();
    if (initial) void submit(initial);
  }, [submit]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(query);
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <a href={SITE_URL} className="flex min-h-11 items-center gap-3">
            <BrandMark />
            <span>
              <span className="block text-title-md leading-tight text-on-surface">LMX Cloud</span>
              <span className="block text-body-sm leading-tight text-on-surface-faint">
                Receipt verifier
              </span>
            </span>
          </a>
          <a
            href={SITE_URL}
            className="text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
          >
            lmxcloud.io
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10">
        <div>
          <p className="text-label-sm text-on-surface-faint">Settlement receipt</p>
          <h1 className="mt-2 text-headline-md text-on-surface">Verify a settlement</h1>
          <p className="mt-2 max-w-2xl text-body-sm text-on-surface-muted">
            Check a receipt against the hash LMX Grid recorded, the Merkle proof for its batch,
            and the anchor transaction. No account required.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5"
        >
          <label htmlFor="receipt-query" className="text-label-sm text-on-surface-faint">
            Settlement id or receipt hash
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="receipt-query"
              name="id"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or 0x…"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-mono-sm text-on-surface outline-none placeholder:text-on-surface-faint focus-visible:shadow-focus"
            />
            <Button type="submit" disabled={loading || !query.trim()}>
              {loading ? "Checking…" : "Verify"}
            </Button>
          </div>
        </form>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-error/40 bg-error/10 px-4 py-3 text-body-sm text-error"
          >
            {error}
          </p>
        )}

        {result && <Result result={result} />}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-on-surface-faint">© {YEAR} LMX Cloud. All rights reserved.</p>
          <a
            href={SITE_URL}
            className="text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
          >
            lmxcloud.io
          </a>
        </div>
      </footer>
    </div>
  );
}

function Result({ result }: { result: VerificationResult }) {
  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={VERDICT_TONE[result.verdict.id]}>{result.verdict.label}</Chip>
      </div>
      <p className="text-body-sm text-on-surface-muted">{result.summary}</p>

      <Field label="Trust tier">
        <p className="text-body-md font-semibold text-on-surface">{result.trustTier.label}</p>
        <p className="mt-1 text-mono-sm text-on-surface-faint">{result.receiptVersion}</p>
      </Field>

      <Field label="Settlement">
        <p className="break-all text-mono-sm text-on-surface">{result.settlementId}</p>
      </Field>

      <Check title="Receipt hash" status={result.hash.status}>
        <HashLine label="Claimed" value={result.hash.claimed} />
        <HashLine label="Recomputed" value={result.hash.recomputed} />
      </Check>

      <Check title="Merkle proof" status={result.merkle.status}>
        <HashLine label="Batch root" value={result.merkle.root} />
      </Check>

      <Anchor anchor={result.anchor} />

      {result.receipt && (
        <details className="rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-4 py-3 text-body-sm font-semibold text-on-surface">
            Receipt
          </summary>
          <pre className="overflow-x-auto border-t border-border px-4 py-3 text-mono-sm text-on-surface-muted">
            {JSON.stringify(result.receipt, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

function Anchor({ anchor }: { anchor: AnchorView }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <p className="text-label-sm text-on-surface-faint">On-chain anchor</p>
      <dl className="mt-3 flex flex-col gap-3">
        <AnchorRow label="Contract">
            {anchor.contractAddress ? (
              anchor.contractUrl ? (
                <ExplorerLink href={anchor.contractUrl} mono>
                  {anchor.contractAddress}
                </ExplorerLink>
              ) : (
                <span className="break-all text-mono-sm text-on-surface">{anchor.contractAddress}</span>
              )
            ) : (
              <Empty />
            )}
        </AnchorRow>
        <AnchorRow label="Chain">
          {anchor.chainLabel ? (
            <span className="text-body-sm text-on-surface">{anchor.chainLabel}</span>
          ) : (
            <Empty />
          )}
        </AnchorRow>
        <AnchorRow label="Anchored">
          {anchor.anchoredAt ? (
            <time dateTime={anchor.anchoredAt} className="text-body-sm text-on-surface">
              {formatTimestamp(anchor.anchoredAt)}
            </time>
          ) : (
            <Empty />
          )}
        </AnchorRow>
        <AnchorRow label="Transaction">
          {anchor.txUrl ? (
            <span className="flex flex-col items-start gap-1">
              <span className="break-all text-mono-sm text-on-surface">{anchor.txHash}</span>
              <ExplorerLink href={anchor.txUrl}>View on Basescan</ExplorerLink>
            </span>
          ) : anchor.txHash ? (
            <span className="break-all text-mono-sm text-on-surface">{anchor.txHash}</span>
          ) : (
            <Empty />
          )}
        </AnchorRow>
      </dl>
    </div>
  );
}

function AnchorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-label-sm text-on-surface-faint">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ExplorerLink({
  href,
  children,
  mono = false,
}: {
  href: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 break-all text-primary outline-none hover:text-primary-hover focus-visible:shadow-focus",
        mono ? "text-mono-sm" : "text-body-sm",
      )}
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    </a>
  );
}

function Check({
  title,
  status,
  children,
}: {
  title: string;
  status: CheckStatus;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-label-sm text-on-surface-faint">{title}</p>
        <Chip tone={CHECK_TONE[status]}>{CHECK_LABEL[status]}</Chip>
      </div>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}

function HashLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-body-sm text-on-surface-muted">{label}</p>
      <p className="mt-0.5 break-all text-mono-sm text-on-surface">{value ?? "—"}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-label-sm text-on-surface-faint">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Empty() {
  return <span className="text-body-sm text-on-surface-faint">—</span>;
}
