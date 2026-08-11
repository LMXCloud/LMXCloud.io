import { roundCredits } from "./pricing.js";
import type { CreditMeta } from "./store.js";

type CreditOps = {
  deduct(apiKeyId: string, amount: number): Promise<boolean>;
  credit(apiKeyId: string, amount: number, meta?: CreditMeta): Promise<number>;
};

/** True up a prior reserve against actual usage; refunds unused hold or deducts overrun. */
export async function settleReservation(
  store: CreditOps,
  apiKeyId: string,
  reservedAmount: number,
  actualAmount: number,
  meta?: CreditMeta,
): Promise<boolean> {
  const reserved = roundCredits(reservedAmount);
  const actual = roundCredits(actualAmount);

  if (reserved <= 0) {
    if (actual <= 0) return true;
    return store.deduct(apiKeyId, actual);
  }

  if (actual <= reserved) {
    const refund = roundCredits(reserved - actual);
    if (refund > 0) {
      await store.credit(apiKeyId, refund, meta);
    }
    return true;
  }

  const extra = roundCredits(actual - reserved);
  return store.deduct(apiKeyId, extra);
}

/** Return a reserve in full when delivery never completed or was aborted. */
export async function releaseReservation(
  store: Pick<CreditOps, "credit">,
  apiKeyId: string,
  reservedAmount: number,
  meta?: CreditMeta,
): Promise<void> {
  const amount = roundCredits(reservedAmount);
  if (amount > 0) {
    await store.credit(apiKeyId, amount, meta);
  }
}
