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
];

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
