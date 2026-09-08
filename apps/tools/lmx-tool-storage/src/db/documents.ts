import { usePostgres } from "./backend.js";
import { getPool } from "./pool.js";
import { getSqlite } from "./sqlite.js";

export type DocumentRow = {
  key: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
};

export type StoredDocument = DocumentRow & {
  namespace: string;
};

function asFrontmatter(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseSqliteFrontmatter(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return asFrontmatter(raw);
  try {
    return asFrontmatter(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function upsertDocument(
  namespace: string,
  key: string,
  markdown: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  if (!usePostgres()) {
    getSqlite()
      .prepare(
        `INSERT INTO documents (namespace, key, markdown, frontmatter, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT (namespace, key) DO UPDATE SET
           markdown = excluded.markdown,
           frontmatter = excluded.frontmatter,
           updated_at = datetime('now')`,
      )
      .run(namespace, key, markdown, JSON.stringify(frontmatter));
    return;
  }

  await getPool().query(
    `INSERT INTO documents (namespace, key, markdown, frontmatter, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (namespace, key) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       frontmatter = EXCLUDED.frontmatter,
       updated_at = NOW()`,
    [namespace, key, markdown, JSON.stringify(frontmatter)],
  );
}

export async function getDocumentMarkdown(
  namespace: string,
  key: string,
): Promise<string | null> {
  if (!usePostgres()) {
    const row = getSqlite()
      .prepare(`SELECT markdown FROM documents WHERE namespace = ? AND key = ?`)
      .get(namespace, key) as { markdown: string } | undefined;
    return row?.markdown ?? null;
  }

  const result = await getPool().query<{ markdown: string }>(
    `SELECT markdown FROM documents WHERE namespace = $1 AND key = $2`,
    [namespace, key],
  );
  return result.rows[0]?.markdown ?? null;
}

export async function listDocuments(namespace: string): Promise<DocumentRow[]> {
  if (!usePostgres()) {
    const rows = getSqlite()
      .prepare(
        `SELECT key, markdown, frontmatter FROM documents
         WHERE namespace = ?
         ORDER BY updated_at DESC`,
      )
      .all(namespace) as Array<{ key: string; markdown: string; frontmatter: unknown }>;

    return rows.map((row) => ({
      key: row.key,
      markdown: row.markdown,
      frontmatter: parseSqliteFrontmatter(row.frontmatter),
    }));
  }

  const result = await getPool().query<{
    key: string;
    markdown: string;
    frontmatter: unknown;
  }>(
    `SELECT key, markdown, frontmatter FROM documents
     WHERE namespace = $1
     ORDER BY updated_at DESC`,
    [namespace],
  );

  return result.rows.map((row) => ({
    key: row.key,
    markdown: row.markdown,
    frontmatter: asFrontmatter(row.frontmatter),
  }));
}

export async function listAllDocuments(): Promise<StoredDocument[]> {
  if (!usePostgres()) {
    const rows = getSqlite()
      .prepare(`SELECT namespace, key, markdown, frontmatter FROM documents`)
      .all() as Array<{
      namespace: string;
      key: string;
      markdown: string;
      frontmatter: unknown;
    }>;

    return rows.map((row) => ({
      namespace: row.namespace,
      key: row.key,
      markdown: row.markdown,
      frontmatter: parseSqliteFrontmatter(row.frontmatter),
    }));
  }

  const result = await getPool().query<{
    namespace: string;
    key: string;
    markdown: string;
    frontmatter: unknown;
  }>(`SELECT namespace, key, markdown, frontmatter FROM documents`);

  return result.rows.map((row) => ({
    namespace: row.namespace,
    key: row.key,
    markdown: row.markdown,
    frontmatter: asFrontmatter(row.frontmatter),
  }));
}

export async function getDocumentsByKeys(
  namespace: string,
  keys: string[],
): Promise<DocumentRow[]> {
  if (keys.length === 0) return [];

  const byKey = new Map<string, DocumentRow>();

  if (!usePostgres()) {
    const placeholders = keys.map(() => "?").join(", ");
    const rows = getSqlite()
      .prepare(
        `SELECT key, markdown, frontmatter FROM documents
         WHERE namespace = ? AND key IN (${placeholders})`,
      )
      .all(namespace, ...keys) as Array<{
      key: string;
      markdown: string;
      frontmatter: unknown;
    }>;

    for (const row of rows) {
      byKey.set(row.key, {
        key: row.key,
        markdown: row.markdown,
        frontmatter: parseSqliteFrontmatter(row.frontmatter),
      });
    }
  } else {
    const result = await getPool().query<{
      key: string;
      markdown: string;
      frontmatter: unknown;
    }>(
      `SELECT key, markdown, frontmatter FROM documents
       WHERE namespace = $1 AND key = ANY($2::text[])`,
      [namespace, keys],
    );

    for (const row of result.rows) {
      byKey.set(row.key, {
        key: row.key,
        markdown: row.markdown,
        frontmatter: asFrontmatter(row.frontmatter),
      });
    }
  }

  return keys.flatMap((key) => {
    const row = byKey.get(key);
    return row ? [row] : [];
  });
}
