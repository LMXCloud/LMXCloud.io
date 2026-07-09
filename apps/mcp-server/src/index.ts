import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { logToolEvent } from "./log.js";
import {
  fetchJson,
  getSupportedModels,
  guardToolAccess,
  normalizeMessageContent,
  validateApiKey,
  type LmxChatResponse,
} from "./lmx-client.js";
import { runWithRequestContext } from "./request-context.js";

const DEFAULT_MODEL = process.env.LMX_DEFAULT_MODEL ?? "deepseek-v3.2";
const MCP_TRANSPORT = (process.env.LMX_MCP_TRANSPORT ?? "stdio") as "stdio" | "http";
const MCP_HOST = process.env.LMX_MCP_HOST ?? "0.0.0.0";
const MCP_PORT = Number(process.env.PORT ?? process.env.LMX_MCP_PORT ?? 3334);

const optionalApiKeySchema = z
  .string()
  .regex(/^lmx_[0-9a-f]{32}$/i)
  .optional()
  .describe(
    "Optional LMX API key (lmx_...). Prefer MCP client Authorization header or env; use this to override per call.",
  );

function requestContextFromHttp(req: IncomingMessage) {
  const authorizationHeader = req.headers.authorization;
  return {
    authorizationHeader: Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader,
  };
}

function createLmxMcpServer(transportMode: "stdio" | "http"): McpServer {
  const server = new McpServer({
    name: "lmxcloud-mcp",
    version: "0.2.0",
  });

  server.tool(
    "get_pricing",
    "Fetch current LMX Cloud per-call pricing catalog.",
    {
      api_key: optionalApiKeySchema,
    },
    async ({ api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "get_pricing",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: false,
      });
      if (!access.ok) {
        return { isError: true, content: [{ type: "text", text: access.message }] };
      }

      const pricing = await fetchJson<unknown>("/v1/pricing", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const ok = pricing.ok;
      logToolEvent({
        tool: "get_pricing",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? undefined : pricing.error,
      });

      if (!pricing.ok) {
        return { isError: true, content: [{ type: "text", text: pricing.error }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(pricing.data, null, 2) }],
      };
    },
  );

  server.tool(
    "list_models",
    "List currently supported LMX model aliases and providers.",
    {
      api_key: optionalApiKeySchema,
    },
    async ({ api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "list_models",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: false,
      });
      if (!access.ok) {
        return { isError: true, content: [{ type: "text", text: access.message }] };
      }

      const models = await getSupportedModels(
        access.auth.apiKey || undefined,
      );
      const ok = models.ok;
      logToolEvent({
        tool: "list_models",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? undefined : models.error,
      });

      if (!models.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to fetch models: ${models.error}` }],
        };
      }

      const data = models.data.data ?? [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                object: "list",
                default_model: DEFAULT_MODEL,
                count: data.length,
                data,
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
    "Call LMX Cloud OpenAI-compatible chat completions endpoint. Requires a user API key.",
    {
      prompt: z.string().min(1).describe("User prompt to send to the selected model."),
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
      api_key: optionalApiKeySchema,
    },
    async ({ prompt, model, max_tokens, temperature, api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "chat_completion",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: true,
      });
      if (!access.ok) {
        return { isError: true, content: [{ type: "text", text: access.message }] };
      }

      const authError = await validateApiKey(access.auth.apiKey);
      if (authError) {
        logToolEvent({
          tool: "chat_completion",
          callerId: access.auth.callerId,
          source: access.auth.source,
          ok: false,
          latencyMs: Date.now() - started,
          detail: authError,
        });
        return { isError: true, content: [{ type: "text", text: authError }] };
      }

      const selectedModel = model ?? DEFAULT_MODEL;
      const models = await getSupportedModels(access.auth.apiKey);
      if (!models.ok) {
        logToolEvent({
          tool: "chat_completion",
          callerId: access.auth.callerId,
          source: access.auth.source,
          ok: false,
          latencyMs: Date.now() - started,
          detail: models.error,
        });
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

      const ids = new Set((models.data.data ?? []).map((entry) => entry.id));
      if (!ids.has(selectedModel)) {
        const suggestions = (models.data.data ?? []).slice(0, 12).map((entry) => entry.id);
        const message = [
          `Model "${selectedModel}" is not currently supported.`,
          "Use `list_models` to see the full live list.",
          `Try one of: ${suggestions.join(", ")}`,
        ].join("\n");
        logToolEvent({
          tool: "chat_completion",
          callerId: access.auth.callerId,
          source: access.auth.source,
          ok: false,
          latencyMs: Date.now() - started,
          detail: message,
        });
        return { isError: true, content: [{ type: "text", text: message }] };
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
          Authorization: `Bearer ${access.auth.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const ok = completion.ok;
      logToolEvent({
        tool: "chat_completion",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? undefined : completion.error,
      });

      if (!completion.ok) {
        return { isError: true, content: [{ type: "text", text: completion.error }] };
      }

      const text = normalizeMessageContent(completion.data.choices);
      return {
        content: [
          {
            type: "text",
            text: text || "LMX API returned a completion response without text content.",
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
  const server = createLmxMcpServer("stdio");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer() {
  const server = createLmxMcpServer("http");
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
          auth: "Bearer lmx_... required for chat_completion",
        }),
      );
      return;
    }

    if (url.pathname === "/mcp") {
      await runWithRequestContext(requestContextFromHttp(req), async () => {
        await transport.handleRequest(req, res);
      });
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
