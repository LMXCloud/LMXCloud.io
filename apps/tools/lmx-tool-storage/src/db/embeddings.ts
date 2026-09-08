import { usePostgres } from "./backend.js";
import { getDocumentsByKeys } from "./documents.js";
import { getPool } from "./pool.js";
import { getSqlite } from "./sqlite.js";

export type SimilarHit = {
  key: string;
  distance: number;
};

export function embeddingId(namespace: string, key: string): string {
  return `${namespace}/${key}`;
}

export function keyFromEmbeddingId(namespace: string, id: string): string {
  const prefix = `${namespace}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function toVecBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function toPgVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

export async function upsertEmbedding(
  namespace: string,
  key: string,
  vector: Float32Array,
): Promise<void> {
  if (!usePostgres()) {
    const sqlite = getSqlite();
    const id = embeddingId(namespace, key);
    const blob = toVecBlob(vector);
    sqlite.prepare(`DELETE FROM document_embeddings WHERE id = ?`).run(id);
    sqlite
      .prepare(`INSERT INTO document_embeddings (id, embedding, namespace) VALUES (?, ?, ?)`)
      .run(id, blob, namespace);
    return;
  }

  await getPool().query(
    `INSERT INTO document_embeddings (namespace, key, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (namespace, key) DO UPDATE SET embedding = EXCLUDED.embedding`,
    [namespace, key, toPgVector(vector)],
  );
}

export async function listEmbeddedIds(): Promise<Set<string>> {
  if (!usePostgres()) {
    const rows = getSqlite()
      .prepare(`SELECT id FROM document_embeddings`)
      .all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  const result = await getPool().query<{ namespace: string; key: string }>(
    `SELECT namespace, key FROM document_embeddings`,
  );
  return new Set(result.rows.map((row) => embeddingId(row.namespace, row.key)));
}

export async function searchSimilar(
  namespace: string,
  queryVector: Float32Array,
  topK: number,
): Promise<SimilarHit[]> {
  if (topK < 1) return [];

  if (!usePostgres()) {
    try {
      const rows = getSqlite()
        .prepare(
          `SELECT id, distance FROM document_embeddings
           WHERE embedding MATCH ? AND k = ? AND namespace = ?`,
        )
        .all(toVecBlob(queryVector), topK, namespace) as Array<{
        id: string;
        distance: number;
      }>;

      return rows.map((row) => ({
        key: keyFromEmbeddingId(namespace, row.id),
        distance: Number(row.distance),
      }));
    } catch {
      return [];
    }
  }

  const result = await getPool().query<{ key: string; distance: number }>(
    `SELECT key, (embedding <=> $1::vector) AS distance
     FROM document_embeddings
     WHERE namespace = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toPgVector(queryVector), namespace, topK],
  );

  return result.rows.map((row) => ({
    key: row.key,
    distance: Number(row.distance),
  }));
}

export async function searchDocuments(
  namespace: string,
  queryVector: Float32Array,
  topK: number,
): Promise<Array<{ key: string; markdown: string; frontmatter: Record<string, unknown>; score: number }>> {
  const hits = await searchSimilar(namespace, queryVector, topK);
  const docs = await getDocumentsByKeys(
    namespace,
    hits.map((hit) => hit.key),
  );
  const byKey = new Map(docs.map((doc) => [doc.key, doc]));

  return hits.flatMap((hit) => {
    const doc = byKey.get(hit.key);
    if (!doc) return [];
    return [
      {
        key: doc.key,
        markdown: doc.markdown,
        frontmatter: doc.frontmatter,
        score: 1 - hit.distance,
      },
    ];
  });
}
