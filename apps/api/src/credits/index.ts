import path from "path";
import { fileURLToPath } from "url";
import { FileCreditStore } from "./file-store.js";
import { NotifyingCreditStore } from "./notifying-store.js";
import { PostgresCreditStore } from "./postgres-store.js";
import type { CreditStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createCreditStore(): CreditStore {
  const inner = process.env.DATABASE_URL
    ? new PostgresCreditStore()
    : new FileCreditStore(
        process.env.CREDITS_FILE ??
          path.resolve(__dirname, "../../../../data/credits.json"),
      );

  return new NotifyingCreditStore(inner);
}

export { calculateRequestCost, roundCredits } from "./pricing.js";
export type { CreditStore } from "./store.js";
