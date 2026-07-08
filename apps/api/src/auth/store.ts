import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { generateApiKey, hashApiKey } from "./keys.js";
import { normalizeWalletAddress } from "./wallet.js";

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  email?: string;
  wallet?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreateApiKeyInput {
  email?: string;
  wallet?: string;
}

export type LinkWalletResult =
  | { ok: true; record: ApiKeyRecord }
  | {
      ok: false;
      code: "email_required" | "wallet_taken" | "wallet_already_linked" | "not_found";
      message: string;
    };

export interface ApiKeyStore {
  create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plainKey: string }>;
  findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null>;
  findPrimaryKeyForWallet(wallet: string): Promise<ApiKeyRecord | null>;
  /** Attach a verified wallet to an email account (all active keys). */
  linkWallet(apiKeyId: string, wallet: string): Promise<LinkWalletResult>;
  touchLastUsed(id: string): Promise<void>;
  listForRecord(record: ApiKeyRecord): Promise<ApiKeyRecord[]>;
  revoke(id: string, owner: ApiKeyRecord): Promise<boolean>;
  emailHasAccount(email: string): Promise<boolean>;
  walletHasAccount(wallet: string): Promise<boolean>;
}

export class FileApiKeyStore implements ApiKeyStore {
  private records: ApiKeyRecord[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      this.records = JSON.parse(raw) as ApiKeyRecord[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.records = [];
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.records, null, 2), "utf-8");
  }

  async create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plainKey: string }> {
    await this.ensureLoaded();

    const plainKey = generateApiKey();
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      keyHash: hashApiKey(plainKey),
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      createdAt: new Date().toISOString(),
    };

    this.records.push(record);
    await this.persist();

    return { record, plainKey };
  }

  async findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const keyHash = hashApiKey(plainKey);
    const record = this.records.find(
      (entry) => entry.keyHash === keyHash && !entry.revokedAt,
    );
    return record ?? null;
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const record = this.records.find((entry) => entry.id === id && !entry.revokedAt);
    return record ?? null;
  }

  async findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const normalized = email.trim().toLowerCase();
    const matches = this.records
      .filter(
        (entry) =>
          !entry.revokedAt && entry.email?.trim().toLowerCase() === normalized,
      )
      .sort((a, b) => {
        const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
        const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
        if (bUsed !== aUsed) return bUsed - aUsed;
        return b.createdAt.localeCompare(a.createdAt);
      });

    return matches[0] ?? null;
  }

  async findPrimaryKeyForWallet(wallet: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const normalized = wallet.trim().toLowerCase();
    const matches = this.records
      .filter(
        (entry) =>
          !entry.revokedAt && entry.wallet?.trim().toLowerCase() === normalized,
      )
      .sort((a, b) => {
        const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
        const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
        if (bUsed !== aUsed) return bUsed - aUsed;
        return b.createdAt.localeCompare(a.createdAt);
      });

    return matches[0] ?? null;
  }

  async linkWallet(apiKeyId: string, wallet: string): Promise<LinkWalletResult> {
    await this.ensureLoaded();
    const owner = this.records.find((entry) => entry.id === apiKeyId && !entry.revokedAt);
    if (!owner) {
      return { ok: false, code: "not_found", message: "API key not found" };
    }
    if (!owner.email?.trim()) {
      return {
        ok: false,
        code: "email_required",
        message: "Only email accounts can link a funding wallet from this session",
      };
    }

    const normalized = normalizeWalletAddress(wallet);
    if (owner.wallet) {
      if (owner.wallet === normalized) {
        return { ok: true, record: owner };
      }
      return {
        ok: false,
        code: "wallet_already_linked",
        message: "This account already has a different funding wallet linked",
      };
    }

    const email = owner.email.trim().toLowerCase();
    const conflict = this.records.find(
      (entry) =>
        !entry.revokedAt &&
        entry.wallet === normalized &&
        entry.email?.trim().toLowerCase() !== email,
    );
    if (conflict) {
      return {
        ok: false,
        code: "wallet_taken",
        message: "This wallet is already linked to another LMX account",
      };
    }

    const now = new Date().toISOString();
    for (const entry of this.records) {
      if (entry.revokedAt) continue;
      if (entry.email?.trim().toLowerCase() !== email) continue;
      entry.wallet = normalized;
      entry.lastUsedAt = now;
    }
    await this.persist();

    const updated = this.records.find((entry) => entry.id === apiKeyId && !entry.revokedAt);
    return updated
      ? { ok: true, record: updated }
      : { ok: false, code: "not_found", message: "API key not found" };
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.ensureLoaded();
    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.revokedAt) return;

    record.lastUsedAt = new Date().toISOString();
    await this.persist();
  }

  async listForRecord(record: ApiKeyRecord): Promise<ApiKeyRecord[]> {
    await this.ensureLoaded();
    const active = this.records.filter((entry) => !entry.revokedAt);

    if (record.email) {
      return active
        .filter((entry) => entry.email === record.email)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    if (record.wallet) {
      return active
        .filter((entry) => entry.wallet === record.wallet)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const current = active.find((entry) => entry.id === record.id);
    return current ? [current] : [];
  }

  async revoke(id: string, owner: ApiKeyRecord): Promise<boolean> {
    await this.ensureLoaded();
    const allowed = await this.listForRecord(owner);
    if (!allowed.some((entry) => entry.id === id)) {
      return false;
    }

    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.revokedAt) {
      return false;
    }

    record.revokedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  async emailHasAccount(email: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = email.trim().toLowerCase();
    return this.records.some(
      (entry) =>
        !entry.revokedAt &&
        entry.email?.trim().toLowerCase() === normalized,
    );
  }

  async walletHasAccount(wallet: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = wallet.trim().toLowerCase();
    return this.records.some(
      (entry) =>
        !entry.revokedAt &&
        entry.wallet?.trim().toLowerCase() === normalized,
    );
  }
}
