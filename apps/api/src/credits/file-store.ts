import fs from "fs/promises";
import path from "path";
import { roundCredits } from "./pricing.js";
import type { CreditStore } from "./store.js";

export class FileCreditStore implements CreditStore {
  private balances = new Map<string, number>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const records = JSON.parse(raw) as Array<{ apiKeyId: string; balance: number }>;
      this.balances = new Map(records.map((entry) => [entry.apiKeyId, entry.balance]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.balances = new Map();
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const records = [...this.balances.entries()].map(([apiKeyId, balance]) => ({
      apiKeyId,
      balance,
    }));
    await fs.writeFile(this.filePath, JSON.stringify(records, null, 2), "utf-8");
  }

  async getBalance(apiKeyId: string): Promise<number> {
    await this.ensureLoaded();
    return this.balances.get(apiKeyId) ?? 0;
  }

  async hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean> {
    const balance = await this.getBalance(apiKeyId);
    return balance >= roundCredits(minimum);
  }

  async deduct(apiKeyId: string, amount: number): Promise<boolean> {
    await this.ensureLoaded();
    const cost = roundCredits(amount);
    if (cost <= 0) return true;

    const current = this.balances.get(apiKeyId) ?? 0;
    if (current < cost) return false;

    this.balances.set(apiKeyId, roundCredits(current - cost));
    await this.persist();
    return true;
  }

  async credit(apiKeyId: string, amount: number, _meta?: unknown): Promise<number> {
    await this.ensureLoaded();
    const added = roundCredits(amount);
    const next = roundCredits((this.balances.get(apiKeyId) ?? 0) + added);
    this.balances.set(apiKeyId, next);
    await this.persist();
    return next;
  }
}
