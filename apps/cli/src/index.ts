import dotenv from "dotenv";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { clearLine, cursorTo } from "node:readline";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import type { ChatMessage } from "@lmxcloud/shared";

import { fetchBalance, fetchUsage, sendChatCompletion } from "./api.js";
import { logout, persistAuth, resolveAuth } from "./auth.js";
import type { CliAuth } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_URL = process.env.LMX_API_URL ?? "http://localhost:3000";
let model = process.env.LMX_MODEL ?? "llama-3-70b";
const prefer = process.env.LMX_PREFER;

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════╗
║   LMX Cloud — Console Chat Demo      ║
╚══════════════════════════════════════╝
`);
}

function printHelp(): void {
  console.log(`
Commands:
  /help       Show this help
  /clear      Clear conversation history
  /model X    Switch model (e.g. /model llama-3-70b)
  /usage      Show metered usage for your key/account
  /balance    Show credit balance
  /login      Sign in with your account email
  /demo       Start a new demo API key
  /logout     Clear saved session and reconnect
  /exit       Quit

Env vars: LMX_API_URL, LMX_API_KEY, LMX_SESSION_TOKEN, LMX_EMAIL, LMX_MODEL, LMX_PREFER
`);
}

function printMeta(
  provider: string,
  fallback: boolean,
  latencyMs: number,
  cost: number,
  balance: number,
  promptTokens?: number,
  completionTokens?: number,
): void {
  const fallbackLabel = fallback ? ", fallback" : "";
  const tokens =
    promptTokens != null && completionTokens != null
      ? ` · ${promptTokens}+${completionTokens} tokens`
      : "";
  console.log(
    `\n[${provider}${fallbackLabel} · ${latencyMs}ms · $${cost.toFixed(6)} · balance $${balance.toFixed(4)}${tokens}]\n`,
  );
}

async function showUsage(auth: CliAuth): Promise<void> {
  const usage = await fetchUsage(API_URL, auth.token);
  console.log(`
Usage (${auth.label}):
  Requests:           ${usage.requests}
  Prompt tokens:      ${usage.prompt_tokens}
  Completion tokens:  ${usage.completion_tokens}
  Total tokens:       ${usage.total_tokens}
  Last request:       ${usage.last_request_at ?? "—"}
`);
}

async function showBalance(auth: CliAuth): Promise<void> {
  const balance = await fetchBalance(API_URL, auth.token);
  console.log(`\nBalance: $${balance.balance.toFixed(4)} ${balance.currency}\n`);
}

async function runChat(auth: CliAuth, rl: readline.Interface): Promise<"exit" | "reconnect" | "demo" | "account"> {
  const messages: ChatMessage[] = [];

  console.log(`API: ${API_URL}`);
  console.log(`Mode: ${auth.label}`);
  console.log(`Model: ${model}`);
  if (prefer) console.log(`Routing: ${prefer}`);
  console.log("Chat away — usage is metered to your key. /help for commands.\n");

  while (true) {
    let line: string;
    try {
      line = await rl.question("You: ");
    } catch {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "/exit" || trimmed === "/quit") break;

    if (trimmed === "/help") {
      printHelp();
      continue;
    }

    if (trimmed === "/clear") {
      messages.length = 0;
      console.log("Conversation cleared.\n");
      continue;
    }

    if (trimmed.startsWith("/model ")) {
      const nextModel = trimmed.slice("/model ".length).trim();
      if (!nextModel) {
        console.log(`Current model: ${model}\n`);
        continue;
      }
      model = nextModel;
      console.log(`Model set to ${model}\n`);
      continue;
    }

    if (trimmed === "/usage") {
      try {
        await showUsage(auth);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      continue;
    }

    if (trimmed === "/balance") {
      try {
        await showBalance(auth);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      continue;
    }

    if (trimmed === "/logout") {
      logout();
      return "reconnect";
    }

    if (trimmed === "/login") {
      logout();
      return "account";
    }

    if (trimmed === "/demo") {
      logout();
      return "demo";
    }

    messages.push({ role: "user", content: trimmed });

    try {
      process.stdout.write("Thinking...");
      const { response, headers } = await sendChatCompletion(
        API_URL,
        auth.token,
        model,
        messages,
        prefer,
      );
      clearLine(output, 0);
      cursorTo(output, 0);

      const content = response.choices[0]?.message?.content ?? "(no content)";
      messages.push({ role: "assistant", content });

      console.log(`Assistant: ${content}`);
      printMeta(
        headers.provider,
        headers.fallback,
        headers.latencyMs,
        headers.cost,
        headers.balance,
        response.usage?.prompt_tokens,
        response.usage?.completion_tokens,
      );
      persistAuth(auth);
    } catch (err) {
      clearLine(output, 0);
      cursorTo(output, 0);
      messages.pop();
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return "exit";
}

async function main(): Promise<void> {
  printBanner();
  console.log(`API: ${API_URL}\n`);

  const rl = readline.createInterface({ input, output });

  try {
    let nextMode: "demo" | "account" | undefined;

    while (true) {
      let auth: CliAuth;
      try {
        auth = await resolveAuth(API_URL, rl, nextMode);
        nextMode = undefined;
      } catch (err) {
        if (err instanceof Error && err.message === "exit") break;
        throw err;
      }

      const result = await runChat(auth, rl);
      if (result === "exit") break;
      if (result === "demo") nextMode = "demo";
      if (result === "account") nextMode = "account";
      console.log("Reconnecting...\n");
    }
  } finally {
    rl.close();
  }

  console.log("Goodbye!");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
