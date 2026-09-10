import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import { DEFAULT_MODEL_ALIAS } from "@lmxcloud/shared";
import {
  createOpsNotification,
  fetchOpsNotifications,
  fetchOpsOverview,
  getEnvOpsGridKey,
  resolveOpsGridKey,
  setStoredOpsGridKey,
} from "./api";
import { formatTime } from "./format";
import { Button } from "./components/Button";
import { PageHeader } from "./components/PageHeader";
import {
  UnparsedDraftError,
  draftFailureMessage,
} from "./notification-draft";
import { draftNotificationCopy } from "./notification-grid-draft";
import {
  collectNotificationSuggestions,
  type ComposeBroadcastKind,
  type NotificationSuggestion,
} from "./notification-suggestions";
import type { OpsNotification, OpsOverview } from "./types";

const COMPOSE_KINDS: Array<{ id: ComposeBroadcastKind; label: string }> = [
  { id: "product_update", label: "Product update" },
  { id: "company_update", label: "Company update" },
];

function kindLabel(kind: string): string {
  if (kind === "product_update") return "Product update";
  if (kind === "company_update") return "Company update";
  if (kind === "welcome") return "Welcome";
  return kind;
}

export function NotificationsPage({ opsKey }: { opsKey: string }) {
  const [history, setHistory] = useState<OpsNotification[]>([]);
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState<ComposeBroadcastKind>("product_update");
  const [writer, setWriter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const writerRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!opsKey) {
      setHistory([]);
      setOverview(null);
      setError(null);
      setReady(false);
      return;
    }
    setLoading(true);
    try {
      const [notificationsResult, overviewResult] = await Promise.allSettled([
        fetchOpsNotifications(opsKey),
        fetchOpsOverview(opsKey, { days: 7, limit: 50 }),
      ]);
      if (notificationsResult.status === "fulfilled") {
        setHistory(notificationsResult.value.data);
        setError(null);
      } else {
        const err = notificationsResult.reason;
        setError(err instanceof Error ? err.message : "Failed to load notifications");
      }
      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      }
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [opsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggestions = useMemo(() => {
    if (!ready) return [];
    return collectNotificationSuggestions({
      history,
      irregularities: overview?.irregularities,
      usageHistory: overview?.usage.history,
      recentSignups: overview?.signups.recent,
    });
  }, [ready, history, overview]);

  function applySuggestion(card: NotificationSuggestion) {
    setKind(card.kind);
    setWriter(card.writerInstruction);
    setSelectedId(card.id);
    queueMicrotask(() => writerRef.current?.focus());
  }

  return (
    <>
      <PageHeader
        eyebrow="Ops"
        title="Notifications"
        description="Broadcast to every signed-in console. Sends immediately — no targeting or scheduling in this pass."
        className="mb-4"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={loading || !opsKey}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {!opsKey ? (
        <p className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-muted)]">
          Connect an ops API key on the{" "}
          <Link to="/" className="text-[var(--color-accent)] underline-offset-2 hover:underline">
            overview
          </Link>{" "}
          first.
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded border border-[var(--color-danger)]/40 bg-[rgba(232,93,108,0.1)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      {opsKey ? (
        <>
          <SuggestedList
            suggestions={suggestions}
            selectedId={selectedId}
            loading={!ready}
            onSelect={applySuggestion}
          />
          <ComposeForm
            opsKey={opsKey}
            kind={kind}
            onKindChange={setKind}
            writer={writer}
            onWriterChange={setWriter}
            writerRef={writerRef}
            onSent={() => {
              setWriter("");
              setSelectedId(null);
              void load();
            }}
          />
          <HistoryList history={history} loading={loading} />
        </>
      ) : null}
    </>
  );
}

function SuggestedList({
  suggestions,
  selectedId,
  loading,
  onSelect,
}: {
  suggestions: NotificationSuggestion[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (card: NotificationSuggestion) => void;
}) {
  return (
    <section className="mb-4 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="border-b border-[var(--color-line)] px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Suggested</h2>
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          From overview alerts, send history, and recent signups/usage. Click to prefill
          compose — nothing is sent.
        </p>
      </div>
      {suggestions.length === 0 ? (
        <p className="px-3 py-4 text-sm text-[var(--color-muted)]">
          {loading ? "Checking…" : "Nothing to suggest right now."}
        </p>
      ) : (
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {suggestions.map((card) => {
            const selected = card.id === selectedId;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onSelect(card)}
                className={`rounded-md border px-3 py-2.5 text-left transition ${
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                    : "border-[var(--color-line)] bg-[var(--color-panel-raised)] hover:border-[var(--color-accent)]/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--color-ink)]">{card.title}</p>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-[var(--color-faint)]">
                    {kindLabel(card.kind)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
                  {card.reason}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ComposeForm({
  opsKey,
  kind,
  onKindChange,
  writer,
  onWriterChange,
  writerRef,
  onSent,
}: {
  opsKey: string;
  kind: ComposeBroadcastKind;
  onKindChange: (kind: ComposeBroadcastKind) => void;
  writer: string;
  onWriterChange: (next: string) => void;
  writerRef: RefObject<HTMLTextAreaElement | null>;
  onSent: () => void;
}) {
  const hasEnvGridKey = Boolean(getEnvOpsGridKey());
  const [gridKey, setGridKey] = useState(() => resolveOpsGridKey());
  const [gridDraft, setGridDraft] = useState(() => resolveOpsGridKey());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [hrefLabel, setHrefLabel] = useState("");
  const [visibleFrom, setVisibleFrom] = useState("");
  const [timeoutId, setTimeoutId] = useState<"1d" | "7d" | "30d" | "never">("7d");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function saveGridKey() {
    const next = gridDraft.trim();
    setStoredOpsGridKey(next);
    setGridKey(resolveOpsGridKey());
  }

  function clearGridKey() {
    setStoredOpsGridKey("");
    const next = resolveOpsGridKey();
    setGridKey(next);
    setGridDraft(next);
  }

  async function onDraft() {
    if (drafting) return;
    setDrafting(true);
    setDraftError(null);
    setResult(null);
    try {
      const draft = await draftNotificationCopy({
        apiKey: gridKey,
        kind,
        notes: writer,
        model: DEFAULT_MODEL_ALIAS,
      });
      setTitle(draft.title);
      setBody(draft.body);
    } catch (err) {
      if (err instanceof UnparsedDraftError) {
        setBody(err.raw);
        setDraftError(err.message);
      } else {
        setDraftError(draftFailureMessage(err));
      }
    } finally {
      setDrafting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setResult(null);
    try {
      const start = visibleFrom.trim() ? new Date(visibleFrom) : new Date();
      if (!Number.isFinite(start.getTime())) {
        throw new Error("Show-from time is invalid");
      }
      const timeoutMs =
        timeoutId === "1d"
          ? 24 * 60 * 60 * 1000
          : timeoutId === "7d"
            ? 7 * 24 * 60 * 60 * 1000
            : timeoutId === "30d"
              ? 30 * 24 * 60 * 60 * 1000
              : null;
      const scheduled = Boolean(visibleFrom.trim()) && start.getTime() > Date.now();
      await createOpsNotification(opsKey, {
        kind,
        title: title.trim(),
        body: body.trim(),
        href: href.trim() || undefined,
        hrefLabel: hrefLabel.trim() || undefined,
        visibleAt: visibleFrom.trim() ? start.toISOString() : undefined,
        expiresAt: timeoutMs
          ? new Date(start.getTime() + timeoutMs).toISOString()
          : undefined,
      });
      setResult(
        scheduled
          ? `Scheduled — appears ${start.toLocaleString()}`
          : "Sent to every console session",
      );
      setTitle("");
      setBody("");
      setHref("");
      setHrefLabel("");
      setVisibleFrom("");
      onSent();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="border-b border-[var(--color-line)] px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Compose</h2>
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          Product or company update. Click expands the full message; an optional link sits
          under the body.
        </p>
      </div>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-2 p-3">
        <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Kind
          <select
            value={kind}
            onChange={(e) => onKindChange(e.target.value as ComposeBroadcastKind)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)] sm:max-w-xs"
          >
            {COMPOSE_KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded border border-[var(--color-line)] bg-[var(--color-bg)] p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            AI writer
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
            Suggestions drop notes here, or write your own. Draft fills title and body via
            Grid ({DEFAULT_MODEL_ALIAS}) — it never sends.
          </p>
          {!gridKey ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={gridDraft}
                onChange={(e) => setGridDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveGridKey();
                  }
                }}
                placeholder="funded lmx_ key (not the ops secret)"
                className="min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
              />
              <button
                type="button"
                onClick={saveGridKey}
                className="rounded border border-[var(--color-line)] bg-[var(--color-panel-raised)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)]"
              >
                Save key
              </button>
            </div>
          ) : hasEnvGridKey ? (
            <p className="mt-1 font-mono text-[10px] text-[var(--color-faint)]">
              auto-connected via VITE_OPS_GRID_API_KEY
            </p>
          ) : (
            <button
              type="button"
              onClick={clearGridKey}
              className="mt-1 text-[10px] text-[var(--color-faint)] underline-offset-2 hover:underline"
            >
              Disconnect Grid key
            </button>
          )}
          <textarea
            ref={writerRef}
            value={writer}
            onChange={(e) => onWriterChange(e.target.value)}
            rows={3}
            placeholder="Click a suggestion above, or write rough notes."
            className="mt-2 w-full rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1.5 text-xs text-[var(--color-ink)]"
          />
          <button
            type="button"
            onClick={() => void onDraft()}
            disabled={drafting || !writer.trim() || !gridKey}
            className="mt-2 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent-dim)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] disabled:opacity-40"
          >
            {drafting ? "Drafting…" : "Draft"}
          </button>
          {draftError ? (
            <p className="mt-1.5 text-[11px] text-[var(--color-danger)]">{draftError}</p>
          ) : null}
        </div>

        <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink)]"
          />
        </label>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          Body
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={4}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink)]"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            Link (optional)
            <input
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="/docs"
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            Link label
            <input
              value={hrefLabel}
              onChange={(e) => setHrefLabel(e.target.value)}
              placeholder="Docs"
              disabled={!href.trim()}
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink)] disabled:opacity-40"
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            Show from
            <input
              type="datetime-local"
              value={visibleFrom}
              onChange={(e) => setVisibleFrom(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
            />
            <span className="mt-0.5 block normal-case tracking-normal text-[10px] text-[var(--color-faint)]">
              Blank = now.
            </span>
          </label>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
            Timeout
            <select
              value={timeoutId}
              onChange={(e) =>
                setTimeoutId(e.target.value as "1d" | "7d" | "30d" | "never")
              }
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-ink)]"
            >
              <option value="1d">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="never">Never</option>
            </select>
            <span className="mt-0.5 block normal-case tracking-normal text-[10px] text-[var(--color-faint)]">
              Leaves the console when it expires.
            </span>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || drafting || !title.trim() || !body.trim()}
          className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[#06110c] disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send"}
        </button>
        {formError ? (
          <p className="text-[11px] text-[var(--color-danger)]">{formError}</p>
        ) : null}
        {result ? (
          <p className="text-[11px] text-[var(--color-accent)]">{result}</p>
        ) : null}
      </form>
    </section>
  );
}

function HistoryList({
  history,
  loading,
}: {
  history: OpsNotification[];
  loading: boolean;
}) {
  return (
    <section className="mt-4 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="border-b border-[var(--color-line)] px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Send history</h2>
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          Newest first. What went out, and when.
        </p>
      </div>
      {history.length === 0 ? (
        <p className="px-3 py-4 text-sm text-[var(--color-muted)]">
          {loading ? "Loading…" : "No notifications sent yet."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {history.map((row) => (
            <li key={row.id} className="px-3 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-[var(--color-ink)]">{row.title}</p>
                <p className="font-mono text-[10px] text-[var(--color-faint)]">
                  {formatTime(row.createdAt)}
                </p>
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{row.body}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-[var(--color-faint)]">
                <span>{kindLabel(row.kind)}</span>
                {row.href ? (
                  <span>
                    {row.hrefLabel ? `${row.hrefLabel} · ` : ""}
                    {row.href}
                  </span>
                ) : null}
                {row.visibleAt &&
                new Date(row.visibleAt).getTime() - new Date(row.createdAt).getTime() >
                  60_000 ? (
                  <span>from {formatTime(row.visibleAt)}</span>
                ) : null}
                {row.expiresAt ? <span>until {formatTime(row.expiresAt)}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
