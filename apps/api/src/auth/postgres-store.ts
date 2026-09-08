import crypto from "crypto";
import { getPool } from "../db/pool.js";
import {
  DEFAULT_API_KEY_ENVIRONMENT,
  isApiKeyEnvironment,
  type ApiKeyEnvironment,
} from "./environment.js";
import { generateApiKey, hashApiKey } from "./keys.js";
import { normalizeWalletAddress } from "./wallet.js";
import type {
  ApiKeyRecord,
  ApiKeyStore,
  CreateApiKeyInput,
  DeleteProjectResult,
  LinkWalletResult,
  ProjectRecord,
  UpdateApiKeyPatch,
} from "./store.js";
import { DEFAULT_PROJECT_NAME } from "./store.js";

const KEY_COLUMNS =
  "id, key_hash, email, wallet, environment, project_id, name, created_at, last_used_at, revoked_at";

const PROJECT_COLUMNS = "id, name, email, wallet, is_default, created_at";

interface ApiKeyRow {
  id: string;
  key_hash: string;
  email: string | null;
  wallet: string | null;
  environment: string;
  project_id: string | null;
  name: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface ProjectRow {
  id: string;
  name: string;
  email: string | null;
  wallet: string | null;
  is_default: boolean;
  created_at: Date;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    keyHash: row.key_hash,
    email: row.email ?? undefined,
    wallet: row.wallet ?? undefined,
    environment: isApiKeyEnvironment(row.environment)
      ? row.environment
      : DEFAULT_API_KEY_ENVIRONMENT,
    projectId: row.project_id ?? undefined,
    name: row.name ?? undefined,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
  };
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? undefined,
    wallet: row.wallet ?? undefined,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}

export class PostgresApiKeyStore implements ApiKeyStore {
  async create(
    input: CreateApiKeyInput,
  ): Promise<{ record: ApiKeyRecord; plainKey: string }> {
    const ownerHint: ApiKeyRecord = {
      id: "pending",
      keyHash: "",
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      environment: input.environment ?? DEFAULT_API_KEY_ENVIRONMENT,
      createdAt: new Date().toISOString(),
    };

    let projectId = input.projectId;
    if (projectId) {
      const project = await this.findProjectForOwner(projectId, ownerHint);
      if (!project) {
        projectId = undefined;
      }
    }
    if (!projectId && (ownerHint.email || ownerHint.wallet)) {
      const fallback = await this.ensureDefaultProject(ownerHint);
      projectId = fallback?.id;
    }

    const plainKey = generateApiKey();
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      keyHash: hashApiKey(plainKey),
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      environment: input.environment ?? DEFAULT_API_KEY_ENVIRONMENT,
      projectId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };

    await getPool().query(
      `INSERT INTO api_keys (id, key_hash, email, wallet, environment, project_id, name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.keyHash,
        record.email ?? null,
        record.wallet ?? null,
        record.environment,
        record.projectId ?? null,
        record.name ?? null,
        record.createdAt,
      ],
    );

    return { record, plainKey };
  }

  async findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashApiKey(plainKey);
    const result = await getPool().query<ApiKeyRow>(
      `SELECT ${KEY_COLUMNS}
       FROM api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const result = await getPool().query<ApiKeyRow>(
      `SELECT ${KEY_COLUMNS}
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null> {
    const result = await getPool().query<ApiKeyRow>(
      `SELECT ${KEY_COLUMNS}
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
      `SELECT ${KEY_COLUMNS}
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
      `SELECT ${KEY_COLUMNS}
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
      await client.query(
        `UPDATE projects
         SET wallet = $1
         WHERE email IS NOT NULL AND LOWER(email) = LOWER($2)`,
        [normalized, email],
      );

      const updated = await client.query<ApiKeyRow>(
        `SELECT ${KEY_COLUMNS}
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

  async listForRecord(
    record: ApiKeyRecord,
    options?: { projectId?: string },
  ): Promise<ApiKeyRecord[]> {
    let result;

    if (record.email) {
      result = options?.projectId
        ? await getPool().query<ApiKeyRow>(
            `SELECT ${KEY_COLUMNS}
             FROM api_keys
             WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL AND project_id = $2
             ORDER BY created_at DESC`,
            [record.email, options.projectId],
          )
        : await getPool().query<ApiKeyRow>(
            `SELECT ${KEY_COLUMNS}
             FROM api_keys
             WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [record.email],
          );
    } else if (record.wallet) {
      result = options?.projectId
        ? await getPool().query<ApiKeyRow>(
            `SELECT ${KEY_COLUMNS}
             FROM api_keys
             WHERE LOWER(wallet) = LOWER($1) AND revoked_at IS NULL AND project_id = $2
             ORDER BY created_at DESC`,
            [record.wallet, options.projectId],
          )
        : await getPool().query<ApiKeyRow>(
            `SELECT ${KEY_COLUMNS}
             FROM api_keys
             WHERE LOWER(wallet) = LOWER($1) AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [record.wallet],
          );
    } else {
      result = await getPool().query<ApiKeyRow>(
        `SELECT ${KEY_COLUMNS}
         FROM api_keys
         WHERE id = $1 AND revoked_at IS NULL`,
        [record.id],
      );
    }

    return result.rows.map(rowToRecord);
  }

  async updateEnvironment(
    id: string,
    owner: ApiKeyRecord,
    environment: ApiKeyEnvironment,
  ): Promise<ApiKeyRecord | null> {
    return this.updateKey(id, owner, { environment });
  }

  async updateKey(
    id: string,
    owner: ApiKeyRecord,
    patch: UpdateApiKeyPatch,
  ): Promise<ApiKeyRecord | null> {
    const allowed = await this.listForRecord(owner);
    if (!allowed.some((entry) => entry.id === id)) {
      return null;
    }

    if (patch.projectId) {
      const project = await this.findProjectForOwner(patch.projectId, owner);
      if (!project) {
        return null;
      }
    }

    const result = await getPool().query<ApiKeyRow>(
      `UPDATE api_keys
       SET environment = COALESCE($1, environment),
           project_id = COALESCE($2, project_id),
           name = COALESCE($3, name)
       WHERE id = $4 AND revoked_at IS NULL
       RETURNING ${KEY_COLUMNS}`,
      [patch.environment ?? null, patch.projectId ?? null, patch.name ?? null, id],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
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

  async listProjectsForRecord(record: ApiKeyRecord): Promise<ProjectRecord[]> {
    await this.ensureDefaultProject(record);
    return this.queryProjectsForOwner(record);
  }

  async findProjectForOwner(id: string, owner: ApiKeyRecord): Promise<ProjectRecord | null> {
    const projects = await this.queryProjectsForOwner(owner);
    return projects.find((project) => project.id === id) ?? null;
  }

  async ensureDefaultProject(owner: ApiKeyRecord): Promise<ProjectRecord | null> {
    if (!owner.email && !owner.wallet) {
      return null;
    }

    const existing = await this.findDefaultProject(owner);
    if (existing) {
      await this.backfillKeysToProject(owner, existing.id);
      return existing;
    }

    const id = crypto.randomUUID();
    try {
      const inserted = await getPool().query<ProjectRow>(
        `INSERT INTO projects (id, name, email, wallet, is_default, created_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         RETURNING ${PROJECT_COLUMNS}`,
        [id, DEFAULT_PROJECT_NAME, owner.email ?? null, owner.wallet ?? null],
      );
      const created = inserted.rows[0] ? rowToProject(inserted.rows[0]) : null;
      if (created) {
        await this.backfillKeysToProject(owner, created.id);
        return created;
      }
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
    }

    const raced = await this.findDefaultProject(owner);
    if (raced) {
      await this.backfillKeysToProject(owner, raced.id);
    }
    return raced;
  }

  async createProject(owner: ApiKeyRecord, name: string): Promise<ProjectRecord | null> {
    if (!owner.email && !owner.wallet) {
      return null;
    }

    await this.ensureDefaultProject(owner);
    const existing = await this.queryProjectsForOwner(owner);
    if (existing.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
      return null;
    }

    const inserted = await getPool().query<ProjectRow>(
      `INSERT INTO projects (id, name, email, wallet, is_default, created_at)
       VALUES ($1, $2, $3, $4, false, NOW())
       RETURNING ${PROJECT_COLUMNS}`,
      [crypto.randomUUID(), name, owner.email ?? null, owner.wallet ?? null],
    );
    const row = inserted.rows[0];
    return row ? rowToProject(row) : null;
  }

  async renameProject(
    id: string,
    owner: ApiKeyRecord,
    name: string,
  ): Promise<ProjectRecord | null> {
    const project = await this.findProjectForOwner(id, owner);
    if (!project) {
      return null;
    }

    const existing = await this.queryProjectsForOwner(owner);
    if (
      existing.some(
        (entry) => entry.id !== id && entry.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return null;
    }

    const updated = await getPool().query<ProjectRow>(
      `UPDATE projects
       SET name = $1
       WHERE id = $2
       RETURNING ${PROJECT_COLUMNS}`,
      [name, id],
    );
    const row = updated.rows[0];
    return row ? rowToProject(row) : null;
  }

  async deleteProject(id: string, owner: ApiKeyRecord): Promise<DeleteProjectResult> {
    const project = await this.findProjectForOwner(id, owner);
    if (!project) {
      return { ok: false, code: "not_found", message: "Project not found" };
    }
    if (project.isDefault) {
      return {
        ok: false,
        code: "default_project",
        message: "The Default project cannot be deleted",
      };
    }

    const fallback = await this.ensureDefaultProject(owner);
    if (!fallback) {
      return { ok: false, code: "not_found", message: "Project not found" };
    }

    const moved = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM api_keys
       WHERE project_id = $1 AND revoked_at IS NULL`,
      [id],
    );
    await getPool().query(`UPDATE api_keys SET project_id = $1 WHERE project_id = $2`, [
      fallback.id,
      id,
    ]);
    await getPool().query(`DELETE FROM projects WHERE id = $1`, [id]);

    return { ok: true, movedKeyCount: Number(moved.rows[0]?.count ?? 0) };
  }

  private async queryProjectsForOwner(owner: ApiKeyRecord): Promise<ProjectRecord[]> {
    const result = await getPool().query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects
       WHERE ($1::text IS NOT NULL AND email IS NOT NULL AND LOWER(email) = LOWER($1))
          OR ($2::text IS NOT NULL AND wallet IS NOT NULL AND LOWER(wallet) = LOWER($2))
       ORDER BY is_default DESC, created_at ASC`,
      [owner.email ?? null, owner.wallet ?? null],
    );
    return result.rows.map(rowToProject);
  }

  private async findDefaultProject(owner: ApiKeyRecord): Promise<ProjectRecord | null> {
    const projects = await this.queryProjectsForOwner(owner);
    return projects.find((project) => project.isDefault) ?? null;
  }

  private async backfillKeysToProject(owner: ApiKeyRecord, projectId: string): Promise<void> {
    await getPool().query(
      `UPDATE api_keys
       SET project_id = $1
       WHERE project_id IS NULL
         AND (
           ($2::text IS NOT NULL AND email IS NOT NULL AND LOWER(email) = LOWER($2))
           OR ($3::text IS NOT NULL AND wallet IS NOT NULL AND LOWER(wallet) = LOWER($3))
         )`,
      [projectId, owner.email ?? null, owner.wallet ?? null],
    );
  }
}
