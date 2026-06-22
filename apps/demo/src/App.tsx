import { useCallback, useEffect, useState } from "react";
import { fetchStatus, fetchUsage, generateApiKey, sendChatCompletion } from "./api";
import type { RequestLogEntry, RouteOption, StatusResponse, UsageResponse } from "./types";

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL ?? "";
const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? "";
const POLL_INTERVAL_MS = 30_000;

const ROUTE_OPTIONS: { value: RouteOption; label: string }[] = [
  { value: "default", label: "default" },
  { value: "cheapest", label: "cheapest" },
  { value: "fastest", label: "fastest" },
  { value: "depin-only", label: "depin-only" },
  { value: "provider:ionet", label: "provider:ionet" },
  { value: "provider:akash", label: "provider:akash" },
];

const MODELS = ["llama-3-70b", "llama-3-8b", "mistral-7b"];

function maskKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatIsoTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function UsagePanel({ usage, loading }: { usage: UsageResponse | null; loading?: boolean }) {
  if (!usage && !loading) return null;

  return (
    <div className="mt-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        Key Usage
      </h3>
      {loading ? (
        <p className="font-mono text-xs text-[var(--color-muted)] animate-pulse">Loading…</p>
      ) : usage ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-muted)]">Requests</dt>
            <dd className="text-[#e6edf3]">{usage.requests}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Prompt tokens</dt>
            <dd className="text-[#e6edf3]">{usage.prompt_tokens}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Completion tokens</dt>
            <dd className="text-[#e6edf3]">{usage.completion_tokens}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Last request</dt>
            <dd className="text-[#e6edf3]">{formatIsoTime(usage.last_request_at)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function HealthDot({ healthy, loading }: { healthy: boolean; loading?: boolean }) {
  if (loading) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-warn)] animate-pulse" />;
  }
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        healthy ? "bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)]" : "bg-[var(--color-danger)]"
      }`}
    />
  );
}

function ProviderHealthPanel({
  status,
  loading,
  error,
  lastUpdated,
}: {
  status: StatusResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}) {
  const chain = status?.fallback_chain ?? [];

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5 order-1 lg:order-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Live Network
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <HealthDot healthy={!error && !loading} loading={loading} />
          {loading ? "polling…" : error ? "offline" : "live"}
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {status
          ? Object.entries(status.providers).map(([name, p]) => (
              <li key={name} className="flex items-center justify-between font-mono text-sm">
                <span className="flex items-center gap-2.5">
                  <HealthDot healthy={p.healthy} />
                  <span className="text-[#e6edf3]">{name}</span>
                  {p.is_depin && (
                    <span className="rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-accent)]">
                      depin
                    </span>
                  )}
                </span>
                <span className="text-[var(--color-muted)]">
                  {p.healthy ? "healthy" : "down"}
                  {p.latency != null && ` · ${p.latency}ms`}
                </span>
              </li>
            ))
          : !error &&
            Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="h-6 animate-pulse rounded bg-[var(--color-border)]/40" />
            ))}
      </ul>

      {chain.length > 0 && (
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 font-mono text-xs text-[var(--color-muted)]">
          Fallback: {chain.join(" → ")}
        </p>
      )}

      {lastUpdated && !error && (
        <p className="mt-2 text-[10px] text-[var(--color-muted)]/70">
          Updated {formatTime(lastUpdated)}
        </p>
      )}
    </section>
  );
}

function RequestLog({ entries }: { entries: RequestLogEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        Request Log
      </h3>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-[var(--color-muted)]"
          >
            <span>{formatTime(entry.time)}</span>
            {entry.error ? (
              <span className="text-[var(--color-danger)]">{entry.error}</span>
            ) : (
              <>
                <span className="text-[#e6edf3]">{entry.provider}</span>
                <span>{entry.latencyMs}ms</span>
                <span>{entry.fallback ? "fallback" : "direct"}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [model, setModel] = useState(MODELS[0]);
  const [route, setRoute] = useState<RouteOption>("default");
  const [message, setMessage] = useState("Hello from LMX Cloud");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [responseText, setResponseText] = useState<string | null>(null);
  const [responseMeta, setResponseMeta] = useState<{
    provider: string;
    fallback: boolean;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
  } | null>(null);

  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const refreshUsage = useCallback(async (key: string) => {
    setUsageLoading(true);
    try {
      setUsage(await fetchUsage(key));
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setStatusError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshStatus]);

  async function handleGenerateKey() {
    setKeyLoading(true);
    setKeyError(null);
    try {
      const key = await generateApiKey(email || undefined);
      setApiKey(key);
      void refreshUsage(key);
      try {
        await navigator.clipboard.writeText(key);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard optional */
      }
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setKeyLoading(false);
    }
  }

  async function handleCopyKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function pushLog(entry: Omit<RequestLogEntry, "id">) {
    setRequestLog((prev) => [{ ...entry, id: crypto.randomUUID() }, ...prev].slice(0, 5));
  }

  async function handleSend() {
    if (!apiKey) {
      setSendError("Generate an API key first");
      return;
    }
    if (!message.trim()) {
      setSendError("Enter a message");
      return;
    }

    setSendLoading(true);
    setSendError(null);
    setResponseText(null);
    setResponseMeta(null);

    try {
      const { response, headers } = await sendChatCompletion(apiKey, model, message.trim(), route);
      const text = response.choices[0]?.message?.content ?? "(empty response)";
      setResponseText(text);
      setResponseMeta({
        provider: headers.provider,
        fallback: headers.fallback,
        latencyMs: headers.latencyMs,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      });
      pushLog({
        time: new Date(),
        provider: headers.provider,
        latencyMs: headers.latencyMs,
        fallback: headers.fallback,
      });
      void refreshUsage(apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setSendError(msg);
      pushLog({
        time: new Date(),
        provider: "—",
        latencyMs: 0,
        fallback: false,
        error: msg,
      });
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 border-b border-[var(--color-border)] pb-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">LMX Cloud</h1>
            <p className="text-sm text-[var(--color-muted)]">DePIN Inference Router</p>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-muted)] sm:mt-0">
            <HealthDot healthy={!statusError && !statusLoading} loading={statusLoading} />
            Provider Health · {statusError ? "unreachable" : statusLoading ? "connecting" : "live"}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="order-2 flex flex-col gap-5 lg:order-1">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Get Started
            </h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-[var(--color-muted)]">
                Email <span className="text-[var(--color-muted)]/60">(optional — early access list)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleGenerateKey()}
              disabled={keyLoading}
              className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent)] disabled:opacity-50"
            >
              {keyLoading ? "Generating…" : "Generate API Key"}
            </button>

            {keyError && (
              <p className="mt-3 text-sm text-[var(--color-danger)]">{keyError}</p>
            )}

            {apiKey && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs text-[var(--color-muted)]">Your key:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-accent)]">
                    {maskKey(apiKey)}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyKey()}
                    className="shrink-0 rounded border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-white"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {apiKey && <UsagePanel usage={usage} loading={usageLoading} />}

            <hr className="my-5 border-[var(--color-border)]" />

            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Try Inference
            </h2>

            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Model</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
                >
                  {MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Route</span>
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value as RouteOption)}
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[var(--color-accent)]"
                >
                  {ROUTE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="mb-3 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
              placeholder="Your message…"
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sendLoading || !apiKey}
              className="rounded-md bg-[var(--color-accent-dim)] px-5 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent)] disabled:opacity-50"
            >
              {sendLoading ? "Sending…" : "Send"}
            </button>

            {!apiKey && (
              <p className="mt-2 text-xs text-[var(--color-muted)]">Generate a key to send requests.</p>
            )}
            {sendError && (
              <p className="mt-2 text-sm text-[var(--color-danger)]">{sendError}</p>
            )}
          </section>
        </div>

        <ProviderHealthPanel
          status={status}
          loading={statusLoading}
          error={statusError}
          lastUpdated={lastUpdated}
        />
      </div>

      <section className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Response
        </h2>

        {responseMeta && (
          <p className="mb-3 font-mono text-sm text-[var(--color-muted)]">
            Provider:{" "}
            <span className="text-[var(--color-accent)]">{responseMeta.provider}</span>
            {"   "}Fallback:{" "}
            <span className={responseMeta.fallback ? "text-[var(--color-warn)]" : "text-[#e6edf3]"}>
              {responseMeta.fallback ? "yes" : "no"}
            </span>
            {"   "}Latency:{" "}
            <span className="text-[#e6edf3]">{responseMeta.latencyMs}ms</span>
          </p>
        )}

        <div className="min-h-[80px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm leading-relaxed text-[#e6edf3]">
          {sendLoading ? (
            <span className="text-[var(--color-muted)] animate-pulse">Waiting for provider…</span>
          ) : responseText ? (
            responseText
          ) : (
            <span className="text-[var(--color-muted)]">
              Send a message to see the routed response and provider headers.
            </span>
          )}
        </div>

        {responseMeta?.promptTokens != null && (
          <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">
            Tokens: {responseMeta.promptTokens} prompt · {responseMeta.completionTokens ?? 0} completion
          </p>
        )}

        <RequestLog entries={requestLog} />
      </section>

      <footer className="mt-8 text-center text-xs text-[var(--color-muted)]">
        OpenAI-compatible DePIN routing
        {DOCS_URL && (
          <>
            {" · "}
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--color-border)] underline-offset-2 hover:text-white"
            >
              Docs
            </a>
          </>
        )}
        {GITHUB_URL && (
          <>
            {" · "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--color-border)] underline-offset-2 hover:text-white"
            >
              GitHub
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
