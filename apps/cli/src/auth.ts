import type * as readline from "node:readline/promises";

import { fetchBalance, generateDemoKey, loginWithEmail } from "./api.js";
import { clearSession, loadSession, saveSession, type SavedSession } from "./storage.js";
import type { CliAuth } from "./types.js";

const SESSION_PREFIX = "lmx_sess_";

function maskToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function authLabel(mode: CliAuth["mode"], token: string, email?: string): string {
  if (mode === "account" && email) return `Signed in as ${email}`;
  if (mode === "demo") return `Demo key ${maskToken(token)}`;
  if (token.startsWith(SESSION_PREFIX)) return `Session ${maskToken(token)}`;
  return `API key ${maskToken(token)}`;
}

function toCliAuth(session: SavedSession): CliAuth {
  return {
    mode: session.mode,
    token: session.token,
    email: session.email,
    label: authLabel(session.mode, session.token, session.email),
  };
}

async function promptChoice(
  rl: readline.Interface,
  question: string,
  choices: string[],
): Promise<string> {
  console.log(question);
  choices.forEach((choice, index) => {
    console.log(`  [${index + 1}] ${choice}`);
  });

  while (true) {
    const answer = (await rl.question("\nChoice: ")).trim();
    const index = Number(answer) - 1;
    if (index >= 0 && index < choices.length) {
      return String(index + 1);
    }
    if (choices.some((_, i) => answer === String(i + 1))) {
      return answer;
    }
    console.log("Invalid choice — try again.");
  }
}

async function startDemoMode(
  apiUrl: string,
  rl: readline.Interface,
): Promise<CliAuth> {
  const emailAnswer = (await rl.question("Email (optional, press Enter to skip): ")).trim();
  console.log("\nGenerating demo API key...");
  const { apiKey, balance } = await generateDemoKey(apiUrl, emailAnswer || undefined);

  const session: SavedSession = {
    mode: "demo",
    token: apiKey,
    email: emailAnswer || undefined,
  };
  saveSession(session);

  console.log(`Demo key: ${maskToken(apiKey)}`);
  console.log(`Starting balance: $${balance.toFixed(4)} USD`);
  console.log("Usage is metered to this key. Revoke it anytime from the dashboard.\n");

  return toCliAuth(session);
}

async function startAccountMode(apiUrl: string, rl: readline.Interface): Promise<CliAuth> {
  while (true) {
    const email = (await rl.question("Account email: ")).trim();
    if (!email) {
      console.log("Email is required.\n");
      continue;
    }

    try {
      console.log("Signing in...");
      const login = await loginWithEmail(apiUrl, email);
      const session: SavedSession = {
        mode: "account",
        token: login.session_token,
        email: login.email,
      };
      saveSession(session);

      const balance = await fetchBalance(apiUrl, login.session_token);
      console.log(`Signed in as ${login.email}`);
      console.log(`Balance: $${balance.balance.toFixed(4)} ${balance.currency}\n`);

      return toCliAuth(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Sign in failed: ${message}\n`);
      const retry = (await rl.question("Try again? [Y/n]: ")).trim().toLowerCase();
      if (retry === "n" || retry === "no") {
        throw new Error("Sign in cancelled");
      }
    }
  }
}

export async function resolveAuth(
  apiUrl: string,
  rl: readline.Interface,
  forced?: "demo" | "account",
): Promise<CliAuth> {
  if (forced === "demo") {
    return startDemoMode(apiUrl, rl);
  }
  if (forced === "account") {
    return startAccountMode(apiUrl, rl);
  }

  const envKey = process.env.LMX_API_KEY?.trim();
  const envSession = process.env.LMX_SESSION_TOKEN?.trim();
  const envToken = envKey ?? envSession;

  if (envToken) {
    const auth: CliAuth = {
      mode: "env",
      token: envToken,
      email: process.env.LMX_EMAIL?.trim(),
      label: authLabel("env", envToken, process.env.LMX_EMAIL?.trim()),
    };
    console.log(`${auth.label} (from environment)\n`);
    return auth;
  }

  const saved = loadSession();
  if (saved) {
    const resume = (await rl.question(
      `Resume ${authLabel(saved.mode, saved.token, saved.email)}? [Y/n]: `,
    ))
      .trim()
      .toLowerCase();

    if (resume !== "n" && resume !== "no") {
      try {
        await fetchBalance(apiUrl, saved.token);
        return toCliAuth(saved);
      } catch {
        console.log("Saved session expired or invalid — starting fresh.\n");
        clearSession();
      }
    } else {
      clearSession();
    }
  }

  const choice = await promptChoice(rl, "How do you want to connect?", [
    "Demo — free throwaway API key (metered usage)",
    "Sign in — use your account email",
    "Exit",
  ]);

  if (choice === "3") {
    throw new Error("exit");
  }

  if (choice === "1") {
    return startDemoMode(apiUrl, rl);
  }

  return startAccountMode(apiUrl, rl);
}

export function persistAuth(auth: CliAuth): void {
  if (auth.mode === "env") return;
  saveSession({
    mode: auth.mode,
    token: auth.token,
    email: auth.email,
  });
}

export function logout(): void {
  clearSession();
}

export function maskTokenForDisplay(token: string): string {
  return maskToken(token);
}
