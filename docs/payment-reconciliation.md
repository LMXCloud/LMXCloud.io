# Payment Failure Reconciliation

Decision record for payment-failure handling (2026-07-28).

## Summary

When a customer pays (x402 USDC or API-key balance) but does not receive a successful inference response, LMX Cloud now reconciles automatically where safe, and surfaces manual-approval cases in the ops hub.

Two channels:

| Channel | Money movement | Reconciliation |
|---------|----------------|----------------|
| **x402** | CDP facilitator settles USDC to treasury | On-chain `USDC.transfer` from treasury back to payer via `TREASURY_PRIVATE_KEY` |
| **Balance** | `CreditStore.deduct` after successful stream/completion | `CreditStore.credit` with `source: delivery_failure_refund` |

## Design: automatic vs manual

| Scenario | Behavior |
|----------|----------|
| x402 inference fails **before** on-chain settlement | `markFailed` only — no refund tx (funds never left payer) |
| x402 settled but no successful usage linked | Auto on-chain refund if amount ≤ `REFUND_AUTO_MAX_USDC` (default $5) and treasury wallet configured |
| x402 refund above auto threshold | `reconciliation_events.status = manual_required`; ops executes `POST /v1/ops/reconciliation/:id/execute` |
| Balance stream deduct then stream error | Immediate automatic credit-back (internal ledger) |
| Orphaned settled rows / stuck `fulfilling` | Background poller retries reconciliation after grace period |

**Rationale:** balance credit-backs are reversible ledger entries — always automatic. On-chain USDC refunds move real money; small amounts auto-execute to keep agent UX smooth, larger amounts require human approval in ops.

## Detection integration

Reuses the existing irregularities pipeline (`apps/api/src/ops/irregularities.ts`) instead of duplicating alerts:

| Irregularity ID | Meaning |
|-----------------|---------|
| `payments.stuck` | Pre-settlement rows (`quoted` / `verified` / `fulfilling` ≥15m) — unchanged |
| `payments.needs_refund` | Pending `reconciliation_events` (`manual_required`, `failed`, `pending`) |
| `payments.high_failure_rate` | Counts `failed` + `refunded` payment_events — now includes reconciled refunds |

The background poller (`ReconciliationPoller`) shares the same reconciliation service as inline chat failure hooks — detection and repair use one code path.

When settlement lands without a usage link, `onAfterSettle` creates a `pending` reconciliation row. The poller waits `RECONCILIATION_GRACE_MINUTES`, confirms usage never linked, then refunds. This avoids refunding successful responses where usage recording lagged.

## Flow

### x402 chat (non-streaming)

```
POST /v1/chat/completions + x402 payment
  → tryClaimForFulfillment
  → router.route()
  → [success] markCompleted + CDP settle
  → [failure] reconcileX402Failure()
       ├─ not settled → markFailed
       └─ settled → USDC refund + markRefunded
```

### Balance streaming

```
router.route(stream)
  → pipe SSE chunks
  → deduct credits
  → [stream error after deduct] reconcileBalanceCreditBack()
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `RECONCILIATION_ENABLED` | `true` | Master switch |
| `REFUND_AUTO_MAX_USDC` | `5` | Auto on-chain refund ceiling |
| `RECONCILIATION_POLL_INTERVAL_MS` | `60000` | Orphan scanner interval |
| `RECONCILIATION_GRACE_MINUTES` | `2` | Wait before poller acts on settled orphans |
| `TREASURY_PRIVATE_KEY` | — | Signs outbound USDC refunds (same treasury as deposits/x402 `payTo`) |
| `BASE_RPC_URL` | — | RPC for refund txs |
| `USDC_CONTRACT_ADDRESS` | chain default | USDC token contract |

`TREASURY_PRIVATE_KEY` is optional. Without it, sub-threshold refunds queue as `manual_required` until ops approves (or key is configured).

## Database

`reconciliation_events` table (migration in `apps/api/src/db/migrate.ts`):

- Idempotent via `idempotency_key` (`x402:{paymentId}` or `balance:{apiKeyId}:{requestId}`)
- Links to `payment_events`, `api_key_id`, optional `usage_event_id`
- Status: `pending` → `processing` → `completed` | `failed` | `manual_required`

`payment_events.markRefunded` now accepts `completed` status for race cases where settlement and completion diverged.

## Code touchpoints

| File | Role |
|------|------|
| `apps/api/src/payments/reconciliation/service.ts` | Core reconciler |
| `apps/api/src/payments/reconciliation/treasury-wallet.ts` | viem wallet client (anchor-poller pattern) |
| `apps/api/src/payments/reconciliation/poller.ts` | Orphan/stuck scanner |
| `apps/api/src/routes/chat.ts` | Inline failure hooks (x402 catch, stream credit-back) |
| `apps/api/src/routes/ops.ts` | Manual execute endpoint |
| `apps/api/src/ops/irregularities.ts` | `payments.needs_refund` alert |

## Ops API

```
GET  /v1/ops/reconciliation/:id
POST /v1/ops/reconciliation/:id/execute   # manual x402 refund approval
```

Overview payload includes `reconciliationsPending` and irregularity `payments.needs_refund`.

## Tests

```bash
cd apps/api && pnpm test
```

`apps/api/src/payments/reconciliation/service.test.ts` covers:

- `planX402Reconciliation` decision logic
- `markRefunded` called after treasury transfer
- `markFailed` when settlement never occurred
- Balance `credit()` on stream failure credit-back

## References

- [x402 verification](./x402-verification.md)
- [x402 pricing](./x402-pricing.md)
- Treasury receive path: `apps/api/src/deposits/poller.ts`
- Wallet signing pattern: `apps/api/src/anchors/poller.ts`
