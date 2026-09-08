import type {
  ConsolidationCluster,
  ConsolidationInput,
  ConsolidationOutput,
  ConsolidationProvider,
} from "./provider.js";

export const DEFAULT_LMX_API_URL = "https://api.lmxcloud.io";
export const DEFAULT_LMX_MODEL = "mistral-nemo";

const GRID_TIMEOUT_MS = 90_000;

export class ConsolidationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsolidationConfigError";
  }
}

export type GridConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

export function getGridConfig(): GridConfig {
  const apiKey = process.env.LMX_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new ConsolidationConfigError(
      [
        "Consolidation requires LMX_API_KEY in this package's own .env (apps/tools/lmx-tool-storage/.env).",
        "That key is this vault's Grid credential — not an agent's, and this service does not mint one.",
        "LMX_API_URL defaults to https://api.lmxcloud.io.",
        "PUT, GET, query, and search keep working without these vars.",
      ].join(" "),
    );
  }

  return {
    apiUrl: (process.env.LMX_API_URL?.trim() || DEFAULT_LMX_API_URL).replace(/\/+$/, ""),
    apiKey,
    model: process.env.LMX_MODEL?.trim() || DEFAULT_LMX_MODEL,
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => yamlScalar(item)).join(", ")}]`;
  return JSON.stringify(value);
}

function formatNote(note: { key: string; frontmatter: Record<string, unknown>; body: string }): string {
  const fields = Object.entries(note.frontmatter)
    .map(([key, value]) => `  ${key}: ${yamlScalar(value)}`)
    .join("\n");
  return [`- key: ${note.key}`, fields, "  body:", note.body.trim() || "(empty)"]
    .filter(Boolean)
    .join("\n");
}

function formatCluster(cluster: ConsolidationCluster, index: number): string {
  if (cluster.notes.length === 1) {
    return `Note ${index + 1}:\n${formatNote(cluster.notes[0])}`;
  }

  return [
    `Near-duplicate group ${index + 1} (locally clustered via embeddings — treat as one claim unless the bodies actually disagree):`,
    ...cluster.notes.map((note) => formatNote(note)),
  ].join("\n");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function stripFrontmatterFence(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const close = trimmed.indexOf("\n---", 3);
  if (close === -1) return trimmed;
  return trimmed.slice(close + 4).trim();
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export class GridConsolidationProvider implements ConsolidationProvider {
  get modelId(): string {
    return process.env.LMX_MODEL?.trim() || DEFAULT_LMX_MODEL;
  }

  async consolidate(input: ConsolidationInput): Promise<ConsolidationOutput> {
    const config = getGridConfig();
    const notesBlock = input.clusters.map((cluster, i) => formatCluster(cluster, i)).join("\n\n");

    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          temperature: 0.2,
          max_tokens: 2048,
          messages: [
            {
              role: "system",
              content: [
                "You consolidate an agent's vault notes into one durable reflection.",
                "Identify what still holds, and what contradicts what.",
                "When claims conflict, say so explicitly and prefer the more recent or better-supported one.",
                "Do not invent facts that are not in the notes.",
                "Near-duplicate groups were already clustered locally; do not spend tokens rediscovering similarity.",
                "Every note in the batch will be marked superseded by your reflection — cover all of them.",
                "Return JSON only, no markdown fences, of the form:",
                '{"body":"markdown reflection with no YAML frontmatter"}',
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Namespace: ${input.namespace}`,
                "Raw notes to fold:",
                notesBlock,
              ].join("\n\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(GRID_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Grid consolidation call timed out after ${GRID_TIMEOUT_MS / 1000}s`);
      }
      const cause = err instanceof Error ? err.message : "network error";
      throw new Error(`Grid is not reachable at ${config.apiUrl} (${cause}).`);
    }

    if (res.status === 402) {
      throw new Error(
        [
          "Grid returned HTTP 402 Payment Required.",
          "This service authenticates with LMX_API_KEY (Bearer) and does not mint keys or sign x402 payments.",
          "Fund this key, or set a funded LMX_API_KEY in apps/tools/lmx-tool-storage/.env.",
        ].join(" "),
      );
    }

    if (!res.ok) {
      throw new Error(
        `Grid POST ${config.apiUrl}/v1/chat/completions failed (${res.status}): ${await parseError(res)}`,
      );
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new Error("Grid returned an empty consolidation response");
    }

    const json = extractJsonObject(content);
    const rawBody =
      json && typeof json.body === "string" && json.body.trim()
        ? json.body
        : content;
    const body = stripFrontmatterFence(rawBody);
    if (!body) {
      throw new Error("Grid returned a reflection with an empty body");
    }

    return { body };
  }
}
