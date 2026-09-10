import type { ComposeBroadcastKind } from "./notification-suggestions";

export type NotificationDraft = {
  title: string;
  body: string;
};

export type DraftChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const KIND_LABEL: Record<ComposeBroadcastKind, string> = {
  product_update: "product update",
  company_update: "company update",
};

export function buildDraftMessages(
  kind: ComposeBroadcastKind,
  notes: string,
): DraftChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You draft short console notifications for LMX Cloud, a DePIN inference router. " +
        "Return JSON only: {\"title\":\"...\",\"body\":\"...\"}. " +
        "Title under 80 characters. Body is 1–3 sentences for signed-in users. " +
        "No markdown fences, no ops jargon, no Telegram, no internal IDs. " +
        "Do not send or schedule anything — this is a draft for a human to edit.",
    },
    {
      role: "user",
      content: `Kind: ${KIND_LABEL[kind]}\n\nNotes:\n${notes.trim()}`,
    },
  ];
}

export function parseNotificationDraft(raw: string): NotificationDraft | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [unfenced];
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(unfenced.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { title?: unknown; body?: unknown };
      if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
        continue;
      }
      const title = parsed.title.trim();
      const body = parsed.body.trim();
      if (title && body) return { title, body };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function draftFailureMessage(err: unknown): string {
  if (isAbortError(err)) {
    return "Grid timed out. Title and body are still yours to write.";
  }
  const detail = err instanceof Error && err.message ? err.message : "routing hiccup";
  if (/invalid or expired|authentication|empty response/i.test(detail)) {
    return (
      "Grid rejected the key. VITE_OPS_GRID_API_KEY must be a funded lmx_ key " +
      "from this API (console → API keys), not LMX_OPS_API_KEY. Title and body are still yours to write."
    );
  }
  return `Grid couldn't draft this (${detail}). Title and body are still yours to write.`;
}

export class UnparsedDraftError extends Error {
  raw: string;
  constructor(raw: string) {
    super(
      "Grid returned a draft we couldn't parse. It's in the body field so you can edit it.",
    );
    this.name = "UnparsedDraftError";
    this.raw = raw;
  }
}
