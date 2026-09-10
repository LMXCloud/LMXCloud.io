import { DEFAULT_MODEL_ALIAS } from "@lmxcloud/shared";
import {
  CHAT_TIMEOUT_MS,
  sendChatCompletion,
} from "./api";
import {
  UnparsedDraftError,
  buildDraftMessages,
  parseNotificationDraft,
  type NotificationDraft,
} from "./notification-draft";
import type { ComposeBroadcastKind } from "./notification-suggestions";

export async function draftNotificationCopy(input: {
  apiKey: string;
  kind: ComposeBroadcastKind;
  notes: string;
  model?: string;
}): Promise<NotificationDraft> {
  const notes = input.notes.trim();
  if (!input.apiKey) {
    throw new Error("Set a funded ops Grid API key (VITE_OPS_GRID_API_KEY) first.");
  }
  if (!notes) {
    throw new Error("Add notes or click a suggestion first.");
  }

  const model = input.model ?? DEFAULT_MODEL_ALIAS;
  const messages = buildDraftMessages(input.kind, notes);
  const content = await completeDraft(input.apiKey, model, messages);
  if (!content.trim()) {
    throw new Error("Grid returned an empty draft. Title and body are still yours to write.");
  }

  const parsed = parseNotificationDraft(content);
  if (parsed) return parsed;

  throw new UnparsedDraftError(content.trim());
}

async function completeDraft(
  apiKey: string,
  model: string,
  messages: ReturnType<typeof buildDraftMessages>,
): Promise<string> {
  // Drafts need a complete JSON object. Same endpoint and balance key as
  // ConsoleChat; non-stream so we can parse title/body in one shot.
  const { response } = await sendChatCompletion(
    apiKey,
    model,
    messages,
    AbortSignal.timeout(CHAT_TIMEOUT_MS),
  );
  return response.choices[0]?.message?.content ?? "";
}
