/**
 * Fire-and-forget Telegram notifications. Never throws; never blocks callers.
 */

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

let cachedConfig: TelegramConfig | null | undefined;

export function getTelegramConfig(): TelegramConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  cachedConfig = botToken && chatId ? { botToken, chatId } : null;
  return cachedConfig;
}

export function isTelegramEnabled(): boolean {
  return getTelegramConfig() !== null;
}

/** Escape Telegram MarkdownV2 special characters in user-controlled text. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatMessage(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon <= 0) return escapeMarkdown(line);
      const label = line.slice(0, colon);
      const value = line.slice(colon + 1).trimStart();
      return `*${escapeMarkdown(label)}:* ${escapeMarkdown(value)}`;
    })
    .join("\n");
}

async function sendTelegramMessage(text: string): Promise<void> {
  const config = getTelegramConfig();
  if (!config) return;

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const body = {
    chat_id: config.chatId,
    text: formatMessage(text),
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn(
      `[notify] Telegram send failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
}

/** Queue a Telegram message; errors are logged and swallowed. */
export function notifyTelegram(text: string): void {
  if (!getTelegramConfig()) return;
  void sendTelegramMessage(text).catch((err) => {
    console.warn("[notify] Telegram error:", err instanceof Error ? err.message : err);
  });
}
