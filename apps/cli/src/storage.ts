import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AuthMode } from "./types.js";

export interface SavedSession {
  mode: AuthMode;
  token: string;
  email?: string;
}

const SESSION_DIR = path.join(os.homedir(), ".lmxcloud");
const SESSION_FILE = path.join(SESSION_DIR, "cli-session.json");

export function loadSession(): SavedSession | null {
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const data = JSON.parse(raw) as SavedSession;
    if (!data.token || !data.mode) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
}

export function clearSession(): void {
  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {
    /* no saved session */
  }
}
