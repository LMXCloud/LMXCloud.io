import matter from "gray-matter";
import { listAllDocuments } from "../db/documents.js";
import { embeddingId, listEmbeddedIds, upsertEmbedding } from "../db/embeddings.js";
import { getEmbeddingProvider } from "./index.js";

export async function backfillMissingEmbeddings(): Promise<void> {
  const docs = await listAllDocuments();
  if (docs.length === 0) return;

  const existing = await listEmbeddedIds();
  const missing = docs.filter((doc) => !existing.has(embeddingId(doc.namespace, doc.key)));
  if (missing.length === 0) return;

  const provider = getEmbeddingProvider();
  for (const doc of missing) {
    const body = matter(doc.markdown).content;
    const vector = await provider.embed(body);
    await upsertEmbedding(doc.namespace, doc.key, vector);
  }
  console.log(`Backfilled embeddings for ${missing.length} document(s)`);
}
