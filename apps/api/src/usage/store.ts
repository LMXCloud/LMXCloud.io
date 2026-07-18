import crypto from "crypto";
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
  apiKeyId?: string;
  payerWallet?: string;
  paymentEventId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
  cost?: number;
  /** Resource kind — chat, embeddings, image, etc. Defaults to "chat". */
  resourceType?: string;
  /** False for failed provider attempts. Defaults to true. */
  success?: boolean;
  /** Machine-readable failure reason when success is false. */
  errorCode?: string | null;
  /**
   * Provider list price at call time (e.g. cost-per-1k-tokens for chat).
   * Recorded on both success and failure so price can be tracked over time.
   */
  unitPrice?: number | null;
}

export interface UsageDayBucket {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageLogEntry {
  id: string;
  apiKeyId: string;
  route: string;
  resourceType: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  success: boolean;
  status: number;
  createdAt: string;
}

export interface UsageLogsQuery {
  limit: number;
  cursor?: string;
  days?: number;
}

export interface UsageLogsResult {
  data: UsageLogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UsageStore {
  recordUsage(input: RecordUsageInput): Promise<string | null>;
  getUsage(apiKeyId: string): Promise<KeyUsageStats | null>;
  getUsageHistory(apiKeyIds: string[], days: number): Promise<UsageDayBucket[]>;
  getUsageLogs(apiKeyIds: string[], query: UsageLogsQuery): Promise<UsageLogsResult>;
}

interface UsageEvent {
  id: string;
  apiKeyId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  fallbackUsed: boolean;
  resourceType: string;
  success: boolean;
  errorCode: string | null;
  unitPrice: number | null;
  createdAt: string;
}

function routeForResourceType(resourceType: string): string {
  if (resourceType === "chat") return "/v1/chat/completions";
  if (resourceType === "web_search") return "/v1/web/search";
  return `/v1/${resourceType}`;
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
      const parsed = JSON.parse(raw) as Array<Partial<UsageEvent>>;
      this.events = parsed.map((event) => ({
        id: event.id ?? crypto.randomUUID(),
        apiKeyId: event.apiKeyId!,
        provider: event.provider!,
        model: event.model!,
        promptTokens: event.promptTokens ?? 0,
        completionTokens: event.completionTokens ?? 0,
        totalTokens: event.totalTokens ?? 0,
        cost: event.cost ?? 0,
        latencyMs: event.latencyMs ?? 0,
        fallbackUsed: event.fallbackUsed ?? false,
        resourceType: event.resourceType ?? "chat",
        success: event.success ?? true,
        errorCode: event.errorCode ?? null,
        unitPrice: event.unitPrice ?? null,
        createdAt: event.createdAt!,
      }));
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

  async recordUsage(input: RecordUsageInput): Promise<string | null> {
    await this.ensureLoaded();

    const promptTokens = input.promptTokens;
    const completionTokens = input.completionTokens;
    const success = input.success !== false;
    const resourceType = input.resourceType ?? "chat";

    if (input.apiKeyId && success) {
      const existing = this.stats.get(input.apiKeyId);
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
    }

    const id = crypto.randomUUID();
    this.events.push({
      id,
      apiKeyId: input.apiKeyId ?? "anonymous",
      provider: input.provider,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: input.cost ?? 0,
      latencyMs: input.latencyMs,
      fallbackUsed: input.fallbackUsed,
      resourceType,
      success,
      errorCode: input.errorCode ?? null,
      unitPrice: input.unitPrice ?? null,
      createdAt: new Date().toISOString(),
    });

    if (this.events.length > 10_000) {
      this.events = this.events.slice(-10_000);
    }

    await this.persist();
    await this.persistEvents();
    return id;
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
      if (!event.success) continue;
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

  async getUsageLogs(apiKeyIds: string[], query: UsageLogsQuery): Promise<UsageLogsResult> {
    await this.ensureLoaded();

    const keySet = new Set(apiKeyIds);
    const cutoff =
      query.days !== undefined ? Date.now() - query.days * 86_400_000 : null;

    let filtered = this.events.filter((event) => {
      if (!keySet.has(event.apiKeyId)) return false;
      if (!event.success) return false;
      if (cutoff !== null && Date.parse(event.createdAt) < cutoff) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    if (query.cursor) {
      const cursorIndex = filtered.findIndex((event) => event.id === query.cursor);
      if (cursorIndex >= 0) {
        filtered = filtered.slice(cursorIndex + 1);
      }
    }

    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      data: page.map(toUsageLogEntry),
      hasMore,
      nextCursor,
    };
  }
}

function toUsageLogEntry(event: UsageEvent): UsageLogEntry {
  return {
    id: event.id,
    apiKeyId: event.apiKeyId,
    route: routeForResourceType(event.resourceType),
    resourceType: event.resourceType,
    provider: event.provider,
    model: event.model,
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    totalTokens: event.totalTokens,
    cost: event.cost,
    latencyMs: event.latencyMs,
    fallbackUsed: event.fallbackUsed,
    success: event.success,
    status: event.success ? 200 : 502,
    createdAt: event.createdAt,
  };
}
