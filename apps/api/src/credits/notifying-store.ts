import { notifyCreditsAdded } from "../notify/events.js";
import type { CreditMeta } from "./store.js";
import type { CreditStore } from "./store.js";

export class NotifyingCreditStore implements CreditStore {
  constructor(private readonly inner: CreditStore) {}

  getBalance(apiKeyId: string): Promise<number> {
    return this.inner.getBalance(apiKeyId);
  }

  getBalances(apiKeyIds: string[]): Promise<Map<string, number>> {
    return this.inner.getBalances(apiKeyIds);
  }

  hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean> {
    return this.inner.hasMinimumBalance(apiKeyId, minimum);
  }

  deduct(apiKeyId: string, amount: number): Promise<boolean> {
    return this.inner.deduct(apiKeyId, amount);
  }

  reserve(apiKeyId: string, amount: number): Promise<boolean> {
    return this.inner.reserve(apiKeyId, amount);
  }

  settleReservation(
    apiKeyId: string,
    reservedAmount: number,
    actualAmount: number,
    meta?: CreditMeta,
  ): Promise<boolean> {
    return this.inner.settleReservation(
      apiKeyId,
      reservedAmount,
      actualAmount,
      meta,
    );
  }

  releaseReservation(
    apiKeyId: string,
    reservedAmount: number,
    meta?: CreditMeta,
  ): Promise<void> {
    return this.inner.releaseReservation(apiKeyId, reservedAmount, meta);
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
