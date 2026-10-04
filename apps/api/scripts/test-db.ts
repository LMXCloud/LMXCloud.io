import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getPool } from "../src/db/pool.js";
import { createPaymentStore } from "../src/payments/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`${label}: ${Date.now() - start}ms`);
  return result;
}

async function main(): Promise<void> {
  await timed("SELECT 1", () => getPool().query("SELECT 1 AS ok"));

  const store = createPaymentStore();
  if (!store) {
    throw new Error("payment store unavailable (DATABASE_URL missing?)");
  }

  const hash = `test-${Date.now()}`;
  const event = await timed("createQuoted", () =>
    store.createQuoted({
      payerWallet: "0xb0857656f30991ca5c901faa329681ebb69b89e6",
      quotedAmount: 0.001,
      chainId: 84532,
      paymentPayloadHash: hash,
      model: "llama-3-70b",
      estimatedTokens: 23,
    }),
  );

  await timed("markVerified", () => store.markVerified(event.id));
  await timed("markFailed (cleanup)", () =>
    store.markFailed(event.id, "test-db cleanup"),
  );

  console.log("DB payment store: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
