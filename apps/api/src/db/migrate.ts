import { getPool } from "./pool.js";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    email TEXT,
    wallet TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_email
    ON api_keys (email) WHERE email IS NOT NULL AND revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_wallet
    ON api_keys (wallet) WHERE wallet IS NOT NULL AND revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS key_usage (
    api_key_id UUID PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
    request_count INTEGER NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    last_request_at TIMESTAMPTZ
  )`,
  `ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(18, 8) NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost NUMERIC(18, 8) NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    fallback_used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_api_key_created
    ON usage_events (api_key_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS wallet_auth_nonces (
    address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deposit_scan_state (
    id TEXT PRIMARY KEY DEFAULT 'base_usdc',
    last_scanned_block BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS usdc_deposits (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount_usdc NUMERIC(18, 8) NOT NULL,
    block_number BIGINT NOT NULL,
    confirmations INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    api_key_id UUID REFERENCES api_keys(id),
    credited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usdc_deposits_from
    ON usdc_deposits (from_address) WHERE status = 'pending'`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS receipt_hash TEXT`,
  `CREATE TABLE IF NOT EXISTS anchor_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merkle_root TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitting',
    tx_hash TEXT,
    block_number BIGINT,
    chain_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    anchored_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_batches_merkle_root
    ON anchor_batches (merkle_root)`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS anchor_batch_id UUID REFERENCES anchor_batches(id)`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS leaf_index INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_unanchored
    ON usage_events (created_at)
    WHERE receipt_hash IS NOT NULL AND anchor_batch_id IS NULL`,
  `CREATE TABLE IF NOT EXISTS payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_event_id UUID REFERENCES usage_events(id),
    api_key_id UUID REFERENCES api_keys(id),
    payer_wallet TEXT NOT NULL,
    quoted_amount NUMERIC(18, 8) NOT NULL,
    settled_amount NUMERIC(18, 8),
    refunded_amount NUMERIC(18, 8) NOT NULL DEFAULT 0,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT,
    payment_payload_hash TEXT NOT NULL,
    facilitator_ref TEXT,
    model TEXT NOT NULL,
    route TEXT NOT NULL DEFAULT 'chat/completions',
    estimated_tokens INTEGER,
    status TEXT NOT NULL DEFAULT 'quoted',
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_payload_hash
    ON payment_events (payment_payload_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_events_payer_created
    ON payment_events (payer_wallet, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_events_status
    ON payment_events (status)
    WHERE status IN ('verified', 'settled', 'fulfilling')`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS payer_wallet TEXT`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS payment_event_id UUID REFERENCES payment_events(id)`,
  `ALTER TABLE usage_events
    ALTER COLUMN api_key_id DROP NOT NULL`,
  // Reliability telemetry (Goal 0): success/failure + resource type + unit price over time
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'chat'`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS error_code TEXT`,
  `ALTER TABLE usage_events
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18, 8)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_reliability
    ON usage_events (resource_type, provider, model, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_success_created
    ON usage_events (success, created_at DESC)`,
  // Provider health poll history (uptime / latency time series)
  `CREATE TABLE IF NOT EXISTS provider_health_checks (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    healthy BOOLEAN NOT NULL,
    latency_ms INTEGER,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_health_checks_provider_checked
    ON provider_health_checks (provider, checked_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_health_checks_checked
    ON provider_health_checks (checked_at)`,
  // Distinguish gateway ping vs synthetic completion (real_traffic is merged at query time)
  `ALTER TABLE provider_health_checks
    ADD COLUMN IF NOT EXISTS check_type TEXT NOT NULL DEFAULT 'gateway'`,
  `CREATE INDEX IF NOT EXISTS idx_provider_health_checks_provider_type_checked
    ON provider_health_checks (provider, check_type, checked_at DESC)`,
  `ALTER TABLE provider_health_checks
    ADD COLUMN IF NOT EXISTS error_detail TEXT`,
  `CREATE TABLE IF NOT EXISTS reconciliation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,
    payment_event_id UUID REFERENCES payment_events(id),
    api_key_id UUID REFERENCES api_keys(id),
    usage_event_id UUID REFERENCES usage_events(id),
    amount NUMERIC(18, 8) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL,
    failure_detail TEXT,
    refund_tx_hash TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_events_status_created
    ON reconciliation_events (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_events_payment
    ON reconciliation_events (payment_event_id)
    WHERE payment_event_id IS NOT NULL`,
  // Vendor spend LMX pays (hosting/db/observability/inference) — not customer-usage cost
  `CREATE TABLE IF NOT EXISTS infra_spend_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service TEXT NOT NULL,
    amount NUMERIC(18, 8) NOT NULL,
    occurred_on DATE NOT NULL,
    note TEXT,
    kind TEXT NOT NULL DEFAULT 'spend'
      CHECK (kind IN ('spend', 'balance', 'note')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_infra_spend_entries_service_date
    ON infra_spend_entries (service, occurred_on DESC)`,
  // First log from the 2026-08-22 funding pass. ON CONFLICT keeps this idempotent.
  `INSERT INTO infra_spend_entries (id, service, amount, occurred_on, note, kind) VALUES
    ('a1000000-0000-4000-8000-000000000001', 'neon', 0, '2026-08-22',
      'Upgraded Free → Launch (usage-based, $0.106/CU-hr)', 'note'),
    ('a1000000-0000-4000-8000-000000000002', 'railway', 0.68, '2026-08-22',
      'Hobby plan, $0.68 of $5 included monthly credit used this cycle', 'spend'),
    ('a1000000-0000-4000-8000-000000000003', 'ionet', 10.00, '2026-08-22',
      'Account balance $10.00 after funding pass', 'balance'),
    ('a1000000-0000-4000-8000-000000000004', 'akash', 0.00, '2026-08-22',
      'Account balance was $0.00 at the 2026-08-22 seed — historical snapshot, not a live alarm', 'balance'),
    ('a1000000-0000-4000-8000-000000000005', 'aethir', 3.53, '2026-08-22',
      'Account balance $3.53 after funding pass', 'balance')
    ON CONFLICT (id) DO NOTHING`,
  `UPDATE infra_spend_entries
    SET note = 'Account balance was $0.00 at the 2026-08-22 seed — historical snapshot, not a live alarm'
    WHERE id = 'a1000000-0000-4000-8000-000000000004'
      AND note ILIKE '%needs funding%'`,
  `ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'development'`,
  `UPDATE api_keys
    SET environment = 'development'
    WHERE environment IS NULL
       OR environment NOT IN ('development', 'staging', 'production')`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_environment_check'
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_environment_check
      CHECK (environment IN ('development', 'staging', 'production'));
  END IF;
END $$`,
  `CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    wallet TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_email
    ON projects (email) WHERE email IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_projects_wallet
    ON projects (wallet) WHERE wallet IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_default_email
    ON projects (LOWER(email)) WHERE is_default AND email IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_default_wallet
    ON projects (LOWER(wallet)) WHERE is_default AND wallet IS NOT NULL`,
  `ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_project
    ON api_keys (project_id) WHERE project_id IS NOT NULL`,
  // One Default project per email account; copy a representative wallet if present.
  `INSERT INTO projects (id, name, email, wallet, is_default, created_at)
   SELECT gen_random_uuid(),
          'Default',
          MIN(email),
          MIN(wallet) FILTER (WHERE wallet IS NOT NULL),
          true,
          MIN(created_at)
   FROM api_keys
   WHERE email IS NOT NULL
   GROUP BY LOWER(email)
   ON CONFLICT DO NOTHING`,
  // Wallet-only accounts (no email) get their own Default project.
  `INSERT INTO projects (id, name, email, wallet, is_default, created_at)
   SELECT gen_random_uuid(),
          'Default',
          NULL,
          MIN(wallet),
          true,
          MIN(created_at)
   FROM api_keys
   WHERE email IS NULL AND wallet IS NOT NULL
   GROUP BY LOWER(wallet)
   ON CONFLICT DO NOTHING`,
  `UPDATE api_keys k
   SET project_id = p.id
   FROM projects p
   WHERE k.project_id IS NULL
     AND p.is_default
     AND k.email IS NOT NULL
     AND p.email IS NOT NULL
     AND LOWER(k.email) = LOWER(p.email)`,
  `UPDATE api_keys k
   SET project_id = p.id
   FROM projects p
   WHERE k.project_id IS NULL
     AND p.is_default
     AND k.email IS NULL
     AND k.wallet IS NOT NULL
     AND p.wallet IS NOT NULL
     AND LOWER(k.wallet) = LOWER(p.wallet)`,
  `ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS name TEXT`,
]

export async function runMigrations(): Promise<void> {
  const client = await getPool().connect();
  try {
    for (const sql of MIGRATIONS) {
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}
