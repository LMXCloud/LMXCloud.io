import fs from "fs/promises";
import path from "path";

export interface KeyUsageStats {
  apiKeyId: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastRequestAt: string | null;
}

export interface RecordUsageInput {
  apiKeyId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

export interface UsageStore {
  recordUsage(input: RecordUsageInput): Promise<void>;
  getUsage(apiKeyId: string): Promise<KeyUsageStats | null>;
}

export class FileUsageStore implements UsageStore {
  private stats = new Map<string, KeyUsageStats>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const records = JSON.parse(raw) as KeyUsageStats[];
      this.stats = new Map(records.map((entry) => [entry.apiKeyId, entry]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.stats = new Map();
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify([...this.stats.values()], null, 2),
      "utf-8",
    );
  }

  async recordUsage(input: RecordUsageInput): Promise<void> {
    await this.ensureLoaded();

    const existing = this.stats.get(input.apiKeyId);
    const promptTokens = input.promptTokens;
    const completionTokens = input.completionTokens;

    const updated: KeyUsageStats = {
      apiKeyId: input.apiKeyId,
      requestCount: (existing?.requestCount ?? 0) + 1,
      promptTokens: (existing?.promptTokens ?? 0) + promptTokens,
      completionTokens: (existing?.completionTokens ?? 0) + completionTokens,
      totalTokens:
        (existing?.totalTokens ?? 0) + promptTokens + completionTokens,
      lastRequestAt: new Date().toISOString(),
    };

    this.stats.set(input.apiKeyId, updated);
    await this.persist();
  }

  async getUsage(apiKeyId: string): Promise<KeyUsageStats | null> {
    await this.ensureLoaded();
    return this.stats.get(apiKeyId) ?? null;
  }
}
