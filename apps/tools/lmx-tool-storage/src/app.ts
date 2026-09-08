import { Hono } from "hono";
import matter from "gray-matter";
import { ConsolidationConfigError } from "./consolidation/index.js";
import { consolidateNamespace } from "./consolidation/run.js";
import {
  getDocumentMarkdown,
  listDocuments,
  upsertDocument,
} from "./db/documents.js";
import { searchDocuments, upsertEmbedding } from "./db/embeddings.js";
import { getEmbeddingProvider } from "./embeddings/index.js";
import { matchesFilter } from "./query.js";

const DEFAULT_QUERY_LIMIT = 100;
const DEFAULT_SEARCH_TOP_K = 10;
const MAX_SEARCH_TOP_K = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = jsonSafe(nested);
    }
    return out;
  }
  return value;
}

function asFrontmatter(data: unknown): Record<string, unknown> {
  const safe = jsonSafe(data);
  return isPlainObject(safe) ? safe : {};
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateSegment(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed === "." || trimmed === "..") return `${label} is invalid`;
  if (trimmed.includes("/") || trimmed.includes("\\")) return `${label} must be a single path segment`;
  return null;
}

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/:namespace/query", async (c) => {
  const namespace = decodeParam(c.req.param("namespace"));
  const nsError = validateSegment(namespace, "namespace");
  if (nsError) return c.json({ error: nsError }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }

  const raw = isPlainObject(body) ? body : {};
  if ("filter" in raw && raw.filter !== undefined && !isPlainObject(raw.filter)) {
    return c.json({ error: "filter must be an object" }, 400);
  }
  const filter = isPlainObject(raw.filter) ? raw.filter : {};

  const rows = await listDocuments(namespace);
  const documents = rows
    .filter((row) => matchesFilter(row.frontmatter, filter))
    .slice(0, DEFAULT_QUERY_LIMIT)
    .map((row) => ({
      key: row.key,
      frontmatter: row.frontmatter,
      body: matter(row.markdown).content,
    }));

  return c.json({ documents });
});

app.post("/:namespace/search", async (c) => {
  const namespace = decodeParam(c.req.param("namespace"));
  const nsError = validateSegment(namespace, "namespace");
  if (nsError) return c.json({ error: nsError }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }

  const raw = isPlainObject(body) ? body : {};
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (!query) return c.json({ error: "query must be a non-empty string" }, 400);

  let topK = DEFAULT_SEARCH_TOP_K;
  if (raw.top_k !== undefined) {
    if (typeof raw.top_k !== "number" || !Number.isInteger(raw.top_k) || raw.top_k < 1) {
      return c.json({ error: "top_k must be a positive integer" }, 400);
    }
    topK = Math.min(raw.top_k, MAX_SEARCH_TOP_K);
  }

  const vector = await getEmbeddingProvider().embed(query);
  const hits = await searchDocuments(namespace, vector, topK);
  const documents = hits.map((hit) => ({
    key: hit.key,
    frontmatter: hit.frontmatter,
    body: matter(hit.markdown).content,
    score: hit.score,
  }));

  return c.json({ documents });
});

app.post("/:namespace/consolidate", async (c) => {
  const namespace = decodeParam(c.req.param("namespace"));
  const nsError = validateSegment(namespace, "namespace");
  if (nsError) return c.json({ error: nsError }, 400);

  try {
    return c.json(await consolidateNamespace(namespace));
  } catch (err) {
    if (err instanceof ConsolidationConfigError) {
      return c.json({ error: err.message }, 503);
    }
    const message = err instanceof Error ? err.message : "Consolidation failed";
    return c.json({ error: message }, 502);
  }
});

app.put("/:namespace/:key", async (c) => {
  const namespace = decodeParam(c.req.param("namespace"));
  const key = decodeParam(c.req.param("key"));
  const nsError = validateSegment(namespace, "namespace");
  if (nsError) return c.json({ error: nsError }, 400);
  const keyError = validateSegment(key, "key");
  if (keyError) return c.json({ error: keyError }, 400);

  let markdown: string;
  try {
    markdown = await c.req.text();
  } catch {
    return c.json({ error: "Unreadable body" }, 400);
  }

  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    const parsed = matter(markdown);
    frontmatter = asFrontmatter(parsed.data);
    body = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse markdown frontmatter";
    return c.json({ error: message }, 400);
  }

  let vector: Float32Array;
  try {
    vector = await getEmbeddingProvider().embed(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to embed document";
    return c.json({ error: message }, 500);
  }

  await upsertDocument(namespace, key, markdown, frontmatter);
  try {
    await upsertEmbedding(namespace, key, vector);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to store embedding";
    return c.json({ error: message }, 500);
  }
  return c.json({ ok: true, namespace, key });
});

app.get("/:namespace/:key", async (c) => {
  const namespace = decodeParam(c.req.param("namespace"));
  const key = decodeParam(c.req.param("key"));
  const nsError = validateSegment(namespace, "namespace");
  if (nsError) return c.json({ error: nsError }, 400);
  const keyError = validateSegment(key, "key");
  if (keyError) return c.json({ error: keyError }, 400);

  const markdown = await getDocumentMarkdown(namespace, key);
  if (markdown === null) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.body(markdown, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
  });
});
