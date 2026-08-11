export type CreditMeta = {
  source?: "initial" | "dev_topup" | "usdc_deposit" | "delivery_failure_refund";
  detail?: string;
};

export interface CreditStore {
  getBalance(apiKeyId: string): Promise<number>;
  hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean>;
  deduct(apiKeyId: string, amount: number): Promise<boolean>;
  credit(apiKeyId: string, amount: number, meta?: CreditMeta): Promise<number>;
  /** Atomically hold credits before delivery; returns false when balance is insufficient. */
  reserve(apiKeyId: string, amount: number): Promise<boolean>;
  /** Charge actual usage against a prior reserve and refund any unused hold. */
  settleReservation(
    apiKeyId: string,
    reservedAmount: number,
    actualAmount: number,
    meta?: CreditMeta,
  ): Promise<boolean>;
  /** Release a prior reserve without charging (e.g. stream aborted before settlement). */
  releaseReservation(
    apiKeyId: string,
    reservedAmount: number,
    meta?: CreditMeta,
  ): Promise<void>;
}
