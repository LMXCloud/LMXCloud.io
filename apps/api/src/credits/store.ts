export type CreditMeta = {
  source?: "initial" | "dev_topup" | "usdc_deposit";
  detail?: string;
};

export interface CreditStore {
  getBalance(apiKeyId: string): Promise<number>;
  hasMinimumBalance(apiKeyId: string, minimum: number): Promise<boolean>;
  deduct(apiKeyId: string, amount: number): Promise<boolean>;
  credit(apiKeyId: string, amount: number, meta?: CreditMeta): Promise<number>;
}
