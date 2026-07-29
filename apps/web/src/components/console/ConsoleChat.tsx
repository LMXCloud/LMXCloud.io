import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL_ALIAS, formatModelProviders, listUniqueModelAliases } from "@lmxcloud/shared";
import {
  sendChatCompletion,
  streamChatCompletion,
  type ChatMessage,
} from "../../api";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Input } from "../ui/Input";

const SUPPORTED_MODELS = listUniqueModelAliases();

interface MessageMeta {
  model: string;
  provider: string;
  latencyMs: number;
  cost: number;
  fallback: boolean;
  balance: number;
  promptTokens: number;
  completionTokens: number;
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

interface ConsoleChatProps {
  apiKey: string;
  defaultModel?: string;
}

export function ConsoleChat({ apiKey, defaultModel = DEFAULT_MODEL_ALIAS }: ConsoleChatProps) {
  const [model, setModel] = useState(defaultModel);
  const [entries, setEntries] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Test inference against your account key. Responses stream when supported — check provider, latency, and cost on each reply.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

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

    const assistantEntryId = crypto.randomUUID();
    let assistantContent = "";

    setEntries((prev) => [
      ...prev,
      { id: assistantEntryId, role: "assistant", content: "" },
    ]);

    try {
      let usedStreaming = true;

      try {
        await streamChatCompletion(apiKey, model, nextHistory, {
          onToken: (token) => {
            assistantContent += token;
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === assistantEntryId
                  ? { ...entry, content: assistantContent }
                  : entry,
              ),
            );
          },
          onMeta: (meta) => {
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === assistantEntryId
                  ? {
                      ...entry,
                      content: assistantContent || "(empty response)",
                      meta: {
                        model,
                        provider: meta.provider,
                        latencyMs: meta.latencyMs,
                        cost: meta.cost,
                        fallback: meta.fallback,
                        balance: meta.balance,
                        promptTokens: meta.usage.prompt_tokens,
                        completionTokens: meta.usage.completion_tokens,
                      },
                    }
                  : entry,
              ),
            );
          },
        });
      } catch {
        usedStreaming = false;
        const { response, headers } = await sendChatCompletion(apiKey, model, nextHistory);
        assistantContent = response.choices[0]?.message?.content ?? "(empty response)";

        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === assistantEntryId
              ? {
                  ...entry,
                  content: assistantContent,
                  meta: {
                    model,
                    provider: headers.provider,
                    latencyMs: headers.latencyMs,
                    cost: headers.cost,
                    fallback: headers.fallback,
                    balance: headers.balance,
                    promptTokens: response.usage?.prompt_tokens ?? 0,
                    completionTokens: response.usage?.completion_tokens ?? 0,
                  },
                }
              : entry,
          ),
        );
      }

      if (usedStreaming && !assistantContent) {
        assistantContent = "(empty response)";
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === assistantEntryId ? { ...entry, content: assistantContent } : entry,
          ),
        );
      }

      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: assistantContent || "(empty response)" },
      ]);
    } catch (err) {
      setHistory(nextHistory.slice(0, -1));
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === assistantEntryId
            ? {
                ...entry,
                content: "",
                error: err instanceof Error ? err.message : "Request failed",
              }
            : entry,
        ),
      );
    } finally {
      setSending(false);
    }
  }

  function handleClear() {
    setEntries([
      {
        id: "welcome",
        role: "assistant",
        content: "Conversation cleared. Send a new message to test routing.",
      },
    ]);
    setHistory([]);
  }

  return (
    <div className="flex h-[min(560px,72vh)] flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-body-sm font-medium text-on-surface">Live inference</p>
          <p className="text-body-sm text-on-surface-muted">
            Bills your session key · OpenAI-compatible
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="console-model">
            Model
          </label>
          <select
            id="console-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={sending}
            className="max-w-[14rem] rounded-md border border-border bg-background px-2 py-1.5 text-body-sm text-on-surface"
          >
            {SUPPORTED_MODELS.map((entry) => (
              <option key={entry.alias} value={entry.alias}>
                {entry.label} ({formatModelProviders(entry)})
              </option>
            ))}
          </select>
          <Button type="button" variant="tertiary" size="sm" onClick={handleClear} disabled={sending}>
            Clear
          </Button>
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
                  ? "bg-primary-pressed text-background"
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
                  <Chip tone="info">{entry.meta.provider}</Chip>
                  {entry.meta.fallback && <Chip tone="warning">fallback</Chip>}
                  <Chip tone="default">{`${entry.meta.latencyMs}ms`}</Chip>
                  <Chip tone="info">{formatUsd(entry.meta.cost)}</Chip>
                  <Chip tone="default">
                    {entry.meta.promptTokens}+{entry.meta.completionTokens} tok
                  </Chip>
                  <Chip tone="success">bal {formatUsd(entry.meta.balance)}</Chip>
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
            placeholder="Type a test prompt…"
            disabled={sending}
            className="min-w-0 flex-1"
            aria-label="Chat message"
          />
          <Button type="submit" disabled={sending || !input.trim()} className="shrink-0">
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
