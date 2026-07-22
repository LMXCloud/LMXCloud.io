/**
 * Smoke-test Telegram ops notifications.
 *
 * Usage (from repo root):
 *   pnpm --filter @lmxcloud/api exec tsx scripts/test-telegram.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  getTelegramConfig,
  notifyAccountCreated,
  notifyCreditsAdded,
  notifyTelegram,
} from "../src/notify/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function sendRaw(text: string): Promise<{ ok: boolean; status: number; body: string }> {
  const config = getTelegramConfig();
  if (!config) {
    return { ok: false, status: 0, body: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" };
  }

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 300) };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listChats(): Promise<void> {
  const config = getTelegramConfig();
  if (!config) return;

  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/getUpdates`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: Array<{
      message?: { chat?: { id: number; type: string; title?: string; username?: string; first_name?: string } };
      my_chat_member?: { chat?: { id: number; type: string; title?: string; username?: string; first_name?: string } };
    }>;
  };

  if (!data.ok) {
    console.warn("getUpdates failed:", JSON.stringify(data));
    return;
  }

  const chats = new Map<number, { id: number; type: string; title: string }>();
  for (const update of data.result ?? []) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat;
    if (!chat) continue;
    chats.set(chat.id, {
      id: chat.id,
      type: chat.type,
      title: chat.title ?? chat.username ?? chat.first_name ?? "?",
    });
  }

  if (chats.size === 0) {
    console.log("No chats in getUpdates — message your bot in Telegram, then re-run.");
    return;
  }

  console.log("Available chats (use id as TELEGRAM_CHAT_ID):");
  for (const chat of chats.values()) {
    console.log(`  ${chat.id} (${chat.type}) ${chat.title}`);
  }
  console.log("Configured TELEGRAM_CHAT_ID:", process.env.TELEGRAM_CHAT_ID?.trim());
}

async function main(): Promise<void> {
  const config = getTelegramConfig();
  if (!config) {
    console.error("FAIL: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in root .env");
    process.exit(1);
  }

  console.log("Telegram config OK (token + chat id present)");
  console.log("Sending connectivity ping…");

  const ping = await sendRaw("LMX Cloud — Telegram connectivity test");
  if (!ping.ok) {
    console.error(`FAIL: ping HTTP ${ping.status}`, ping.body);
    await listChats();
    process.exit(1);
  }
  console.log("OK: connectivity ping delivered");

  console.log("Sending formatted event samples via notify module…");

  notifyTelegram("LMX Cloud — notify module test\nStatus: ok");
  notifyAccountCreated({
    apiKeyId: "00000000-0000-4000-8000-000000000001",
    source: "public_key",
    email: "test@lmxcloud.io",
    isNewAccount: true,
  });
  notifyCreditsAdded({
    apiKeyId: "00000000-0000-4000-8000-000000000001",
    amount: 1,
    balance: 1,
    source: "initial",
    detail: "test script",
  });

  await wait(3000);
  console.log("OK: dispatched 3 sample notifications (check your Telegram chat)");
  console.log("If messages are missing, check API logs for [notify] Telegram send failed");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
