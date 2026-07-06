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
  cost?: number;
}

export interface UsageDayBucket {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageStore {
  recordUsage(input: RecordUsageInput): Promise<void>;
  getUsage(apiKeyId: string): Promise<KeyUsageStats | null>;
  getUsageHistory(apiKeyIds: string[], days: number): Promise<UsageDayBucket[]>;
}

interface UsageEvent {
  apiKeyId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  createdAt: string;
}

export class FileUsageStore implements UsageStore {
  private stats = new Map<string, KeyUsageStats>();
  private events: UsageEvent[] = [];
  private loaded = false;

  constructor(
    private readonly filePath: string,
    private readonly eventsPath: string,
  ) {}

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

    try {
      const raw = await fs.readFile(this.eventsPath, "utf-8");
      this.events = JSON.parse(raw) as UsageEvent[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.events = [];
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

  private async persistEvents(): Promise<void> {
    await fs.mkdir(path.dirname(this.eventsPath), { recursive: true });
    await fs.writeFile(this.eventsPath, JSON.stringify(this.events, null, 2), "utf-8");
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

    this.events.push({
      apiKeyId: input.apiKeyId,
      provider: input.provider,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: input.cost ?? 0,
      latencyMs: input.latencyMs,
      fallbackUsed: input.fallbackUsed,
      createdAt: new Date().toISOString(),
    });

    if (this.events.length > 10_000) {
      this.events = this.events.slice(-10_000);
    }

    await this.persist();
    await this.persistEvents();
  }

  async getUsage(apiKeyId: string): Promise<KeyUsageStats | null> {
    await this.ensureLoaded();
    return this.stats.get(apiKeyId) ?? null;
  }

  async getUsageHistory(apiKeyIds: string[], days: number): Promise<UsageDayBucket[]> {
    await this.ensureLoaded();

    const keySet = new Set(apiKeyIds);
    const cutoff = Date.now() - days * 86_400_000;
    const buckets = new Map<string, UsageDayBucket>();

    for (const event of this.events) {
      if (!keySet.has(event.apiKeyId)) continue;
      const created = Date.parse(event.createdAt);
      if (created < cutoff) continue;

      const date = event.createdAt.slice(0, 10);
      const existing = buckets.get(date) ?? {
        date,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      };

      existing.requests += 1;
      existing.promptTokens += event.promptTokens;
      existing.completionTokens += event.completionTokens;
      existing.totalTokens += event.totalTokens;
      existing.cost += event.cost;
      buckets.set(date, existing);
    }

    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}
