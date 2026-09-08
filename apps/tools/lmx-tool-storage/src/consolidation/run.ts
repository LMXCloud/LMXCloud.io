import matter from "gray-matter";
import { listDocuments, upsertDocument } from "../db/documents.js";
import { upsertEmbedding } from "../db/embeddings.js";
import { getEmbeddingProvider } from "../embeddings/index.js";
import { getConsolidationProvider } from "./index.js";
import { getGridConfig } from "./grid.js";
import type { ConsolidationCluster, ConsolidationNote } from "./provider.js";

/** Reserved frontmatter.kind — reflection notes are never folded into a later pass. */
export const REFLECTION_KIND = "reflection";

/** Cosine similarity at or above this (MiniLM, already normalized) is a near-duplicate. */
export const NEAR_DUPLICATE_THRESHOLD = 0.85;

/** Cap so one Grid call stays inside a reasonable context window. Oldest notes first. */
export const MAX_CONSOLIDATION_BATCH = 40;

export type ConsolidateResult = {
  ok: true;
  namespace: string;
  reflection: {
    key: string;
    frontmatter: Record<string, unknown>;
    body: string;
  } | null;
  superseded: Array<{ key: string; superseded_by: string }>;
  clusters: Array<{ keys: string[]; near_duplicates: boolean }>;
  message?: string;
};

type Candidate = ConsolidationNote & { markdown: string; vector: Float32Array };

function asFrontmatter(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function isReflection(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.kind === REFLECTION_KIND;
}

function isAlreadyFolded(frontmatter: Record<string, unknown>): boolean {
  return typeof frontmatter.superseded_by === "string" && frontmatter.superseded_by.trim().length > 0;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

function clusterNearDuplicates(candidates: Candidate[]): Candidate[][] {
  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSimilarity(candidates[i].vector, candidates[j].vector) >= NEAR_DUPLICATE_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, Candidate[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(candidates[i]);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function reflectionKey(at: Date): string {
  return `reflection-${at.toISOString().replace(/[:.]/g, "-")}`;
}

function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(body, frontmatter);
}

function listUnfolded(rows: Awaited<ReturnType<typeof listDocuments>>) {
  const raw = rows.filter(
    (row) => !isReflection(row.frontmatter) && !isAlreadyFolded(row.frontmatter),
  );
  // listDocuments is updated_at DESC; fold oldest first so a large vault drains FIFO.
  raw.reverse();
  return raw.slice(0, MAX_CONSOLIDATION_BATCH);
}

async function embedCandidates(
  rows: ReturnType<typeof listUnfolded>,
): Promise<Candidate[]> {
  const embedder = getEmbeddingProvider();
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const parsed = matter(row.markdown);
    const body = parsed.content;
    const vector = await embedder.embed(body);
    candidates.push({
      key: row.key,
      frontmatter: row.frontmatter,
      body,
      markdown: row.markdown,
      vector,
    });
  }
  return candidates;
}

export async function consolidateNamespace(namespace: string): Promise<ConsolidateResult> {
  const unfolded = listUnfolded(await listDocuments(namespace));
  if (unfolded.length === 0) {
    return {
      ok: true,
      namespace,
      reflection: null,
      superseded: [],
      clusters: [],
      message: "No unconsolidated notes in this namespace",
    };
  }

  // Fail before embeddings+Grid (not at boot) so PUT/GET/query/search stay zero-config.
  getGridConfig();

  const candidates = await embedCandidates(unfolded);
  const grouped = clusterNearDuplicates(candidates);
  const clusters: ConsolidationCluster[] = grouped.map((notes) => ({
    notes: notes.map(({ key, frontmatter, body }) => ({ key, frontmatter, body })),
  }));

  const { body } = await getConsolidationProvider().consolidate({ namespace, clusters });

  const at = new Date();
  const key = reflectionKey(at);
  const supersededKeys = candidates.map((note) => note.key);
  const frontmatter: Record<string, unknown> = {
    kind: REFLECTION_KIND,
    timestamp: at.toISOString(),
    supersedes: supersededKeys,
  };
  const markdown = serializeMarkdown(frontmatter, body);
  const vector = await getEmbeddingProvider().embed(body);
  await upsertDocument(namespace, key, markdown, frontmatter);
  await upsertEmbedding(namespace, key, vector);

  const superseded: Array<{ key: string; superseded_by: string }> = [];
  for (const note of candidates) {
    const parsed = matter(note.markdown);
    const updatedFrontmatter = {
      ...asFrontmatter(parsed.data),
      ...note.frontmatter,
      superseded_by: key,
    };
    const updatedMarkdown = serializeMarkdown(updatedFrontmatter, parsed.content);
    await upsertDocument(namespace, note.key, updatedMarkdown, updatedFrontmatter);
    superseded.push({ key: note.key, superseded_by: key });
  }

  return {
    ok: true,
    namespace,
    reflection: { key, frontmatter, body },
    superseded,
    clusters: grouped.map((notes) => ({
      keys: notes.map((note) => note.key),
      near_duplicates: notes.length > 1,
    })),
  };
}
