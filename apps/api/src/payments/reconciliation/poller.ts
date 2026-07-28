import { getPool } from "../../db/pool.js";
import type { PaymentReconciler } from "./service.js";
import type { ReconciliationStore } from "./store.js";

export interface ReconciliationPollerConfig {
  pollIntervalMs: number;
  graceMinutes: number;
}

interface PaymentIdRow {
  id: string;
}

interface PendingReconciliationRow {
  id: string;
  payment_event_id: string | null;
  reason: string;
}

export class ReconciliationPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly reconciler: PaymentReconciler,
    private readonly reconciliationStore: ReconciliationStore,
    private readonly config: ReconciliationPollerConfig,
    private readonly log: (message: string) => void = console.log,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    this.log(
      `Payment reconciliation poller started (every ${this.config.pollIntervalMs}ms)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const pending = await listDuePendingReconciliations(
        this.config.graceMinutes,
      );
      for (const row of pending) {
        if (!row.payment_event_id) continue;
        await this.reconciler.reconcileX402Failure(
          row.payment_event_id,
          row.reason,
          true,
        );
      }

      const stuck = await listStuckFulfillingPayments(this.config.graceMinutes);
      for (const row of stuck) {
        await this.reconciler.reconcileX402Failure(
          row.id,
          "stuck_fulfilling_timeout",
          true,
        );
      }

      const failed = await this.reconciliationStore.listRecent(50);
      for (const row of failed.filter((r) => r.status === "failed" && r.kind === "x402_refund")) {
        if (!row.paymentEventId) continue;
        await this.reconciler.reconcileX402Failure(
          row.paymentEventId,
          row.reason,
          true,
        );
      }
    } catch (err) {
      this.log(
        `Reconciliation poller error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}

async function listDuePendingReconciliations(
  graceMinutes: number,
): Promise<PendingReconciliationRow[]> {
  if (!process.env.DATABASE_URL) return [];

  const result = await getPool().query<PendingReconciliationRow>(
    `SELECT id, payment_event_id, reason
     FROM reconciliation_events
     WHERE kind = 'x402_refund'
       AND status = 'pending'
       AND payment_event_id IS NOT NULL
       AND created_at < NOW() - ($1::int || ' minutes')::interval
     ORDER BY created_at ASC
     LIMIT 25`,
    [Math.max(1, graceMinutes)],
  );

  return result.rows;
}

async function listStuckFulfillingPayments(
  graceMinutes: number,
): Promise<PaymentIdRow[]> {
  if (!process.env.DATABASE_URL) return [];

  const result = await getPool().query<PaymentIdRow>(
    `SELECT p.id
     FROM payment_events p
     WHERE p.status = 'fulfilling'
       AND p.settled_amount IS NULL
       AND p.tx_hash IS NULL
       AND p.created_at < NOW() - ($1::int || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM reconciliation_events r
         WHERE r.payment_event_id = p.id
           AND r.status IN ('completed', 'processing', 'manual_required')
       )
     ORDER BY p.created_at ASC
     LIMIT 25`,
    [Math.max(1, graceMinutes)],
  );

  return result.rows;
}

export function loadReconciliationConfig() {
  const enabled = process.env.RECONCILIATION_ENABLED !== "false";
  const autoMaxUsdc = Number(process.env.REFUND_AUTO_MAX_USDC ?? "5");
  const pollIntervalMs = Number(process.env.RECONCILIATION_POLL_INTERVAL_MS ?? "60000");
  const graceMinutes = Number(process.env.RECONCILIATION_GRACE_MINUTES ?? "2");

  const privateKey = process.env.TREASURY_PRIVATE_KEY?.trim() as
    | `0x${string}`
    | undefined;

  return {
    enabled,
    autoMaxUsdc: Number.isFinite(autoMaxUsdc) && autoMaxUsdc > 0 ? autoMaxUsdc : 5,
    pollIntervalMs:
      Number.isFinite(pollIntervalMs) && pollIntervalMs >= 10_000
        ? pollIntervalMs
        : 60_000,
    graceMinutes:
      Number.isFinite(graceMinutes) && graceMinutes >= 1 ? graceMinutes : 2,
    treasuryPrivateKey: privateKey?.startsWith("0x") ? privateKey : undefined,
    rpcUrl: process.env.BASE_RPC_URL,
    usdcContractAddress: process.env.USDC_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined,
    chainId: Number(process.env.SIWE_CHAIN_ID ?? "8453"),
  };
}
