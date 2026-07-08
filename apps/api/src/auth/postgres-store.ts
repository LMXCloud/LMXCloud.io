import crypto from "crypto";
import { getPool } from "../db/pool.js";
import { generateApiKey, hashApiKey } from "./keys.js";
import { normalizeWalletAddress } from "./wallet.js";
import type {
  ApiKeyRecord,
  ApiKeyStore,
  CreateApiKeyInput,
  LinkWalletResult,
} from "./store.js";

interface ApiKeyRow {
  id: string;
  key_hash: string;
  email: string | null;
  wallet: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    keyHash: row.key_hash,
    email: row.email ?? undefined,
    wallet: row.wallet ?? undefined,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
  };
}

export class PostgresApiKeyStore implements ApiKeyStore {
  async create(
    input: CreateApiKeyInput,
  ): Promise<{ record: ApiKeyRecord; plainKey: string }> {
    const plainKey = generateApiKey();
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      keyHash: hashApiKey(plainKey),
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      createdAt: new Date().toISOString(),
    };

    await getPool().query(
      `INSERT INTO api_keys (id, key_hash, email, wallet, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.id,
        record.keyHash,
        record.email ?? null,
        record.wallet ?? null,
        record.createdAt,
      ],
    );

    return { record, plainKey };
  }

  async findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashApiKey(plainKey);
    const result = await getPool().query<ApiKeyRow>(
      `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const result = await getPool().query<ApiKeyRow>(
      `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null> {
    const result = await getPool().query<ApiKeyRow>(
      `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [email.trim()],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findPrimaryKeyForWallet(wallet: string): Promise<ApiKeyRecord | null> {
    const result = await getPool().query<ApiKeyRow>(
      `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE LOWER(wallet) = LOWER($1) AND revoked_at IS NULL
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [wallet.trim()],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async linkWallet(apiKeyId: string, wallet: string): Promise<LinkWalletResult> {
    const pool = getPool();
    const ownerResult = await pool.query<ApiKeyRow>(
      `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL`,
      [apiKeyId],
    );
    const owner = ownerResult.rows[0];
    if (!owner) {
      return { ok: false, code: "not_found", message: "API key not found" };
    }
    if (!owner.email?.trim()) {
      return {
        ok: false,
        code: "email_required",
        message: "Only email accounts can link a funding wallet from this session",
      };
    }

    const normalized = normalizeWalletAddress(wallet);
    if (owner.wallet) {
      if (owner.wallet.toLowerCase() === normalized) {
        return { ok: true, record: rowToRecord(owner) };
      }
      return {
        ok: false,
        code: "wallet_already_linked",
        message: "This account already has a different funding wallet linked",
      };
    }

    const email = owner.email.trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const conflict = await client.query<{ id: string }>(
        `SELECT id FROM api_keys
         WHERE LOWER(wallet) = LOWER($1)
           AND revoked_at IS NULL
           AND (email IS NULL OR LOWER(email) <> LOWER($2))
         LIMIT 1
         FOR UPDATE`,
        [normalized, email],
      );
      if (conflict.rows[0]) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: "wallet_taken",
          message: "This wallet is already linked to another LMX account",
        };
      }

      await client.query(
        `UPDATE api_keys
         SET wallet = $1, last_used_at = NOW()
         WHERE LOWER(email) = LOWER($2) AND revoked_at IS NULL`,
        [normalized, email],
      );

      const updated = await client.query<ApiKeyRow>(
        `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE id = $1 AND revoked_at IS NULL`,
        [apiKeyId],
      );
      await client.query("COMMIT");

      const row = updated.rows[0];
      return row
        ? { ok: true, record: rowToRecord(row) }
        : { ok: false, code: "not_found", message: "API key not found" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async touchLastUsed(id: string): Promise<void> {
    await getPool().query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
  }

  async listForRecord(record: ApiKeyRecord): Promise<ApiKeyRecord[]> {
    let result;

    if (record.email) {
      result = await getPool().query<ApiKeyRow>(
        `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [record.email],
      );
    } else if (record.wallet) {
      result = await getPool().query<ApiKeyRow>(
        `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE LOWER(wallet) = LOWER($1) AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [record.wallet],
      );
    } else {
      result = await getPool().query<ApiKeyRow>(
        `SELECT id, key_hash, email, wallet, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE id = $1 AND revoked_at IS NULL`,
        [record.id],
      );
    }

    return result.rows.map(rowToRecord);
  }

  async revoke(id: string, owner: ApiKeyRecord): Promise<boolean> {
    const allowed = await this.listForRecord(owner);
    if (!allowed.some((entry) => entry.id === id)) {
      return false;
    }

    const result = await getPool().query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async emailHasAccount(email: string): Promise<boolean> {
    const result = await getPool().query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM api_keys
         WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL
       ) AS exists`,
      [email.trim()],
    );
    return result.rows[0]?.exists ?? false;
  }

  async walletHasAccount(wallet: string): Promise<boolean> {
    const result = await getPool().query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM api_keys
         WHERE LOWER(wallet) = LOWER($1) AND revoked_at IS NULL
       ) AS exists`,
      [wallet.trim()],
    );
    return result.rows[0]?.exists ?? false;
  }
}
