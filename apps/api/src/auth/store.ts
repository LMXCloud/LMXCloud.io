import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { generateApiKey, hashApiKey } from "./keys.js";

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  email?: string;
  wallet?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface CreateApiKeyInput {
  email?: string;
  wallet?: string;
}

export interface ApiKeyStore {
  create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plainKey: string }>;
  findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null>;
  touchLastUsed(id: string): Promise<void>;
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
      wallet: input.wallet,
      createdAt: new Date().toISOString(),
    };

    this.records.push(record);
    await this.persist();

    return { record, plainKey };
  }

  async findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const keyHash = hashApiKey(plainKey);
    return this.records.find((record) => record.keyHash === keyHash) ?? null;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.ensureLoaded();
    const record = this.records.find((entry) => entry.id === id);
    if (!record) return;

    record.lastUsedAt = new Date().toISOString();
    await this.persist();
  }
}
