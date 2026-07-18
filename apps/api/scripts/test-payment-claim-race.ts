/**
 * Concurrent claim race for x402 payment fulfillment.
 *
 * Creates a verified payment_events row, then fires many tryClaimForFulfillment
 * calls in parallel. Exactly one must win; the rest must get null.
 *
 * Usage: pnpm --filter @lmxcloud/api exec tsx scripts/test-payment-claim-race.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createPaymentStore } from "../src/payments/store.js";
import { getPool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const CONCURRENCY = 40;

async function main(): Promise<void> {
  const store = createPaymentStore();
  if (!store) {
    throw new Error("payment store unavailable (DATABASE_URL missing?)");
  }

  const hash = `claim-race-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const event = await store.createQuoted({
    payerWallet: "0xb0857656f30991ca5c901faa329681ebb69b89e6",
    quotedAmount: 0.001,
    chainId: 84532,
    paymentPayloadHash: hash,
    model: "llama-3-70b",
    estimatedTokens: 23,
  });
  await store.markVerified(event.id);

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => store.tryClaimForFulfillment(hash)),
  );

  const winners = results.filter((row) => row !== null);
  const losers = results.filter((row) => row === null);

  console.log(
    JSON.stringify(
      {
        concurrency: CONCURRENCY,
        winners: winners.length,
        losers: losers.length,
        winnerStatus: winners[0]?.status ?? null,
        winnerId: winners[0]?.id ?? null,
      },
      null,
      2,
    ),
  );

  await store.markFailed(event.id, "test-payment-claim-race cleanup");
  await getPool().end();

  if (winners.length !== 1) {
    throw new Error(`Expected exactly 1 winner, got ${winners.length}`);
  }
  if (winners[0]!.status !== "fulfilling") {
    throw new Error(`Expected winner status fulfilling, got ${winners[0]!.status}`);
  }
  if (losers.length !== CONCURRENCY - 1) {
    throw new Error(`Expected ${CONCURRENCY - 1} losers, got ${losers.length}`);
  }

  console.log("claim race: OK");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await getPool().end();
  } catch {
    // ignore
  }
  process.exit(1);
});
