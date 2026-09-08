import { usePostgres } from "./backend.js";
import { getPool } from "./pool.js";
import { getSqlite } from "./sqlite.js";

const POSTGRES_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS documents (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    markdown TEXT NOT NULL,
    frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (namespace, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents (namespace)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_frontmatter ON documents USING GIN (frontmatter)`,
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS document_embeddings (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    PRIMARY KEY (namespace, key)
  )`,
  `CREATE INDEX IF NOT EXISTS document_embeddings_hnsw
     ON document_embeddings USING hnsw (embedding vector_cosine_ops)`,
];

const SQLITE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS documents (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    markdown TEXT NOT NULL,
    frontmatter TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (namespace, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents (namespace)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS document_embeddings USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[384] distance_metric=cosine,
    namespace TEXT
  )`,
];

function runSqliteMigrations(): void {
  const sqlite = getSqlite();
  for (const sql of SQLITE_MIGRATIONS) {
    sqlite.exec(sql);
  }
}

export async function runMigrations(): Promise<void> {
  if (!usePostgres()) {
    runSqliteMigrations();
    return;
  }

  const client = await getPool().connect();
  try {
    for (const sql of POSTGRES_MIGRATIONS) {
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}
