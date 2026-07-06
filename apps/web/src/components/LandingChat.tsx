import { useCallback, useEffect, useRef, useState } from "react";
import { createApiKey, sendChatCompletion, type ChatMessage } from "../api";
import { clearDemoApiKey, readDemoApiKey, writeDemoApiKey } from "../lib/demo-storage";
import {
  estimateOpenAiCost,
  getOpenAiBenchmark,
  savingsVsOpenAi,
} from "../lib/openai-benchmark";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Input } from "./ui/Input";

const DEFAULT_MODEL = "llama-3-70b";

interface MessageMeta {
  model: string;
  provider: string;
  latencyMs: number;
  cost: number;
  openAiCost: number;
  savingsPercent: number;
  openAiLabel: string;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: MessageMeta;
  error?: string;
}

function formatUsd(amount: number): string {
  if (amount < 0.0001) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}

function formatSavings(percent: number, label: string): string {
  const rounded = Math.abs(Math.round(percent));
  if (rounded === 0) return `Same price as OpenAI ${label}`;
  if (percent > 0) return `${rounded}% cheaper vs OpenAI ${label}`;
  return `${rounded}% more vs OpenAI ${label}`;
}

export function LandingChat() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Try LMX Cloud live — I route through decentralized compute. Ask anything to see latency, model, and savings vs OpenAI.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const initDemoKey = useCallback(async () => {
    setKeyLoading(true);
    setKeyError(null);

    const cached = readDemoApiKey();
    if (cached) {
      setApiKey(cached);
      setKeyLoading(false);
      return;
    }

    try {
      const created = await createApiKey();
      writeDemoApiKey(created.api_key);
      setApiKey(created.api_key);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not start demo");
    } finally {
      setKeyLoading(false);
    }
  }, []);

  useEffect(() => {
    void initDemoKey();
  }, [initDemoKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !apiKey || sending) return;

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const nextHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setEntries((prev) => [...prev, userEntry]);
    setHistory(nextHistory);
    setInput("");
    setSending(true);

    try {
      const { response, headers } = await sendChatCompletion(apiKey, DEFAULT_MODEL, nextHistory);
      const content = response.choices[0]?.message?.content ?? "(empty response)";
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      const openAiCost = estimateOpenAiCost(promptTokens, completionTokens, DEFAULT_MODEL);
      const bench = getOpenAiBenchmark(DEFAULT_MODEL);

      setHistory((prev) => [...prev, { role: "assistant", content }]);
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          meta: {
            model: DEFAULT_MODEL,
            provider: headers.provider,
            latencyMs: headers.latencyMs,
            cost: headers.cost,
            openAiCost,
            savingsPercent: savingsVsOpenAi(headers.cost, openAiCost),
            openAiLabel: bench.label,
          },
        },
      ]);
    } catch (err) {
      setHistory(nextHistory.slice(0, -1));
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          error: err instanceof Error ? err.message : "Request failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleResetKey() {
    clearDemoApiKey();
    setApiKey(null);
    setHistory([]);
    await initDemoKey();
  }

  return (
    <div className="flex h-[min(520px,70vh)] flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-body-sm font-medium text-on-surface">Live chat demo</p>
          <p className="text-body-sm text-on-surface-muted">
            Throwaway key · {DEFAULT_MODEL} · metered usage
          </p>
        </div>
        <div className="flex items-center gap-2">
          {keyLoading ? (
            <span className="text-body-sm text-on-surface-muted">Connecting…</span>
          ) : keyError ? (
            <Button type="button" variant="tertiary" size="sm" onClick={() => void initDemoKey()}>
              Retry
            </Button>
          ) : (
            <Chip tone="success" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Ready
            </Chip>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-body-sm ${
                entry.role === "user"
                  ? "bg-primary-pressed text-white"
                  : "border border-border bg-background text-on-surface"
              }`}
            >
              {entry.error ? (
                <p className="text-error">{entry.error}</p>
              ) : (
                <p className="whitespace-pre-wrap">{entry.content}</p>
              )}

              {entry.meta && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                  <Chip tone="default">{entry.meta.model}</Chip>
                  <Chip tone="default">{entry.meta.provider}</Chip>
                  <Chip tone="default">{`${entry.meta.latencyMs}ms`}</Chip>
                  <Chip tone="info">{formatUsd(entry.meta.cost)}</Chip>
                  <Chip
                    tone={entry.meta.savingsPercent > 0 ? "success" : "default"}
                  >
                    {formatSavings(entry.meta.savingsPercent, entry.meta.openAiLabel)}
                  </Chip>
                </div>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-body-sm text-on-surface-muted">
              Routing request…
            </div>
          </div>
        )}
      </div>

      {keyError && (
        <p className="border-t border-border px-4 py-2 text-body-sm text-error">{keyError}</p>
      )}

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            disabled={!apiKey || sending || keyLoading}
            className="min-w-0 flex-1"
            aria-label="Chat message"
          />
          <Button
            type="submit"
            disabled={!apiKey || sending || keyLoading || !input.trim()}
            className="shrink-0"
          >
            Send
          </Button>
        </div>
        <p className="mt-2 text-body-sm text-on-surface-faint">
          Demo uses a session throwaway key.{" "}
          <button
            type="button"
            onClick={() => void handleResetKey()}
            className="text-primary hover:text-primary-hover"
          >
            New key
          </button>
          {" · "}
          OpenAI comparison uses {getOpenAiBenchmark(DEFAULT_MODEL).label} list pricing for the same
          token counts.
        </p>
      </form>
    </div>
  );
}
