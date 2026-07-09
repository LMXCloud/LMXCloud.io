import "dotenv/config";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

type LmxChatResponse = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type LmxModelsResponse = {
  object: "list";
  data: Array<{
    id: string;
    owned_by: string;
  }>;
};

const API_BASE_URL =
  process.env.LMX_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
const API_KEY = process.env.LMX_API_KEY;
const DEFAULT_MODEL = process.env.LMX_DEFAULT_MODEL ?? "deepseek-v3.2";
const MCP_TRANSPORT = process.env.LMX_MCP_TRANSPORT ?? "stdio";
const MCP_HOST = process.env.LMX_MCP_HOST ?? "127.0.0.1";
const MCP_PORT = Number(process.env.LMX_MCP_PORT ?? 3334);

function authHeaders(): Record<string, string> {
  if (!API_KEY) {
    return {};
  }

  return {
    Authorization: `Bearer ${API_KEY}`,
  };
}

function normalizeMessageContent(content: LmxChatResponse["choices"]): string {
  const raw = content?.[0]?.message?.content;
  if (!raw) {
    return "";
  }

  if (typeof raw === "string") {
    return raw;
  }

  return raw
    .map((part) => (part?.type === "text" && part?.text ? part.text : ""))
    .join("");
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `LMX API returned ${response.status}: ${text || response.statusText}`,
      };
    }

    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}

async function getSupportedModels(): Promise<
  { ok: true; models: LmxModelsResponse["data"]; ids: Set<string> } | { ok: false; error: string }
> {
  const response = await fetchJson<LmxModelsResponse>("/v1/models", {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  const models = response.data.data ?? [];
  return {
    ok: true,
    models,
    ids: new Set(models.map((item) => item.id)),
  };
}

function createLmxMcpServer(): McpServer {
  const server = new McpServer({
    name: "lmxcloud-mcp",
    version: "0.1.0",
  });

  server.tool(
    "get_pricing",
    "Fetch current LMX Cloud per-call pricing catalog.",
    {},
    async () => {
      const pricing = await fetchJson<unknown>("/v1/pricing", {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders(),
        },
      });

      if (!pricing.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: pricing.error }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(pricing.data, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "list_models",
    "List currently supported LMX model aliases and providers.",
    {},
    async () => {
      const models = await getSupportedModels();
      if (!models.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to fetch models: ${models.error}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                object: "list",
                default_model: DEFAULT_MODEL,
                count: models.models.length,
                data: models.models,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "chat_completion",
    "Call LMX Cloud OpenAI-compatible chat completions endpoint.",
    {
      prompt: z
        .string()
        .min(1)
        .describe("User prompt to send to the selected model."),
      model: z
        .string()
        .optional()
        .describe("Optional model name or alias. Uses default if omitted."),
      max_tokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .describe("Optional max completion tokens."),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Optional sampling temperature."),
    },
    async ({ prompt, model, max_tokens, temperature }) => {
      const selectedModel = model ?? DEFAULT_MODEL;
      const models = await getSupportedModels();
      if (!models.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Model validation failed because /v1/models was unavailable: ${models.error}`,
            },
          ],
        };
      }
      if (!models.ids.has(selectedModel)) {
        const suggestions = models.models.slice(0, 12).map((entry) => entry.id);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: [
                `Model "${selectedModel}" is not currently supported.`,
                "Use `list_models` to see the full live list.",
                `Try one of: ${suggestions.join(", ")}`,
              ].join("\n"),
            },
          ],
        };
      }

      const payload = {
        model: selectedModel,
        messages: [{ role: "user", content: prompt }],
        ...(max_tokens ? { max_tokens } : {}),
        ...(typeof temperature === "number" ? { temperature } : {}),
        stream: false,
      };

      const completion = await fetchJson<LmxChatResponse>("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!completion.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: completion.error }],
        };
      }

      const text = normalizeMessageContent(completion.data.choices);
      return {
        content: [
          {
            type: "text",
            text:
              text ||
              "LMX API returned a completion response without text content.",
          },
          {
            type: "text",
            text: JSON.stringify(
              {
                id: completion.data.id,
                model: completion.data.model,
                usage: completion.data.usage,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

async function startStdioServer() {
  const server = createLmxMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer() {
  const server = createLmxMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          transport: "http",
          endpoint: "/mcp",
        }),
      );
      return;
    }

    if (url.pathname === "/mcp") {
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(MCP_PORT, MCP_HOST, () => resolve());
  });
  process.stderr.write(
    `[lmxcloud-mcp] Streamable HTTP listening on http://${MCP_HOST}:${MCP_PORT}/mcp\n`,
  );
}

if (MCP_TRANSPORT === "http") {
  await startHttpServer();
} else {
  await startStdioServer();
}
