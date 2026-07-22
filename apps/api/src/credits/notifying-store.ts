import { notifyCreditsAdded } from "../notify/events.js";
import type { CreditMeta } from "./store.js";
import type { CreditStore } from "./store.js";

export class NotifyingCreditStore implements CreditStore {
  constructor(private readonly inner: CreditStore) {}

  getBalance(apiKeyId: string): Promise<number> {
    return this.inner.getBalance(apiKeyId);
  }

  hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean> {
    return this.inner.hasMinimumBalance(apiKeyId, minimum);
  }

  deduct(apiKeyId: string, amount: number): Promise<boolean> {
    return this.inner.deduct(apiKeyId, amount);
  }

  async credit(
    apiKeyId: string,
    amount: number,
    meta?: CreditMeta,
  ): Promise<number> {
    const balance = await this.inner.credit(apiKeyId, amount);
    if (amount > 0) {
      notifyCreditsAdded({
        apiKeyId,
        amount,
        balance,
        source: meta?.source ?? "initial",
        detail: meta?.detail,
      });
    }
    return balance;
  }
}
