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
  pricingQuotePath,
  validateApiKey,
  type LmxChatResponse,
} from "./lmx-client.js";
import { enforceOriginLock } from "./origin-lock.js";
import { runWithRequestContext } from "./request-context.js";
import { loadMcpX402Config, runX402ChatCompletion, type McpX402Config } from "./x402.js";

const DEFAULT_MODEL = process.env.LMX_DEFAULT_MODEL ?? "llama-3-70b";
const MCP_TRANSPORT = (process.env.LMX_MCP_TRANSPORT ?? "stdio") as "stdio" | "http";
const MCP_HOST = process.env.LMX_MCP_HOST ?? "0.0.0.0";
const MCP_PORT = Number(process.env.PORT ?? process.env.LMX_MCP_PORT ?? 3334);

let mcpX402: McpX402Config | null = null;

const optionalApiKeySchema = z
  .string()
  .regex(/^lmx_[0-9a-f]{32}$/i)
  .optional()
  .describe(
    "Optional LMX API key (lmx_...). Prefer MCP client Authorization header or env; use this to override per call.",
  );

function jsonToolContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

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
    version: "0.4.0",
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

      return jsonToolContent(pricing.data);
    },
  );

  server.tool(
    "quote_price",
    "Estimate USDC cost for a single model call. Uses GET /v1/pricing with model and token params.",
    {
      model: z.string().min(1).describe("Model alias to quote (e.g. llama-3-70b)."),
      max_tokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .describe("Optional max completion tokens for the quote."),
      prompt_tokens: z
        .number()
        .int()
        .positive()
        .max(128_000)
        .optional()
        .describe("Optional estimated prompt tokens (default: 1)."),
      api_key: optionalApiKeySchema,
    },
    async ({ model, max_tokens, prompt_tokens, api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "quote_price",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: false,
      });
      if (!access.ok) {
        return toolError(access.message);
      }

      const quote = await fetchJson<unknown>(
        pricingQuotePath({ model, max_tokens, prompt_tokens }),
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
      );

      logToolEvent({
        tool: "quote_price",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok: quote.ok,
        latencyMs: Date.now() - started,
        detail: quote.ok ? undefined : quote.error,
      });

      if (!quote.ok) {
        return toolError(quote.error);
      }

      return jsonToolContent(quote.data);
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
      return jsonToolContent({
        object: "list",
        default_model: DEFAULT_MODEL,
        count: data.length,
        data,
      });
    },
  );

  server.tool(
    "get_status",
    "Fetch LMX Cloud provider health, fallback chain, and anchoring status.",
    {
      api_key: optionalApiKeySchema,
    },
    async ({ api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "get_status",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: false,
      });
      if (!access.ok) {
        return toolError(access.message);
      }

      const status = await fetchJson<unknown>("/v1/status", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      logToolEvent({
        tool: "get_status",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok: status.ok,
        latencyMs: Date.now() - started,
        detail: status.ok ? undefined : status.error,
      });

      if (!status.ok) {
        return toolError(status.error);
      }

      return jsonToolContent(status.data);
    },
  );

  server.tool(
    "get_balance",
    "Fetch USD credit balance for the caller API key. Requires authentication.",
    {
      api_key: optionalApiKeySchema,
    },
    async ({ api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "get_balance",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: true,
      });
      if (!access.ok) {
        return toolError(access.message);
      }

      const balance = await fetchJson<unknown>("/v1/balance", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${access.auth.apiKey}`,
        },
      });

      logToolEvent({
        tool: "get_balance",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok: balance.ok,
        latencyMs: Date.now() - started,
        detail: balance.ok ? undefined : balance.error,
      });

      if (!balance.ok) {
        return toolError(balance.error);
      }

      return jsonToolContent(balance.data);
    },
  );

  server.tool(
    "get_usage",
    "Fetch request and token usage totals for the caller API key. Requires authentication.",
    {
      api_key: optionalApiKeySchema,
    },
    async ({ api_key }) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "get_usage",
        transport: transportMode,
        toolApiKey: api_key,
        requireApiKey: true,
      });
      if (!access.ok) {
        return toolError(access.message);
      }

      const usage = await fetchJson<unknown>("/v1/usage", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${access.auth.apiKey}`,
        },
      });

      logToolEvent({
        tool: "get_usage",
        callerId: access.auth.callerId,
        source: access.auth.source,
        ok: usage.ok,
        latencyMs: Date.now() - started,
        detail: usage.ok ? undefined : usage.error,
      });

      if (!usage.ok) {
        return toolError(usage.error);
      }

      return jsonToolContent(usage.data);
    },
  );

  server.tool(
    "chat_completion",
    "Call LMX Cloud OpenAI-compatible chat completions. Prefers a pre-funded API key (Bearer / api_key); when omitted and x402 is enabled, requires a USDC pay-per-call payment.",
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
    async ({ prompt, model, max_tokens, temperature, api_key }, extra) => {
      const started = Date.now();
      const access = guardToolAccess({
        tool: "chat_completion",
        transport: transportMode,
        toolApiKey: api_key,
        // Dual path: Bearer/balance when a key is present; otherwise x402 fallback.
        requireApiKey: false,
        // Never treat server admin/fulfillment keys as the caller's balance key.
        allowAdminFallback: false,
      });
      if (!access.ok) {
        return { isError: true, content: [{ type: "text", text: access.message }] };
      }

      const hasBalanceKey = Boolean(access.auth.apiKey);
      if (!hasBalanceKey) {
        if (!mcpX402) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: [
                  "LMX API key is required for this tool (x402 pay-per-call is not enabled on this MCP server).",
                  "Provide one of:",
                  "- api_key tool argument",
                  "- Authorization: Bearer lmx_... header (hosted MCP)",
                  "- LMX_API_KEY in your MCP client env (local stdio)",
                  "Create a key at https://lmxcloud.io/console/keys",
                ].join("\n"),
              },
            ],
          };
        }

        return runX402ChatCompletion({
          args: { prompt, model, max_tokens, temperature, api_key },
          extra,
          defaultModel: DEFAULT_MODEL,
          x402: mcpX402,
          started,
        });
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

async function initX402() {
  const loaded = await loadMcpX402Config();
  if (loaded.ok) {
    mcpX402 = loaded.config;
    process.stderr.write(
      `[lmxcloud-mcp] x402 pay-per-call enabled (network=${loaded.config.networkId})\n`,
    );
  } else {
    mcpX402 = null;
    process.stderr.write(
      `[lmxcloud-mcp] x402 pay-per-call disabled (${loaded.reason})\n`,
    );
  }
}

async function startStdioServer() {
  await initX402();
  const server = createLmxMcpServer("stdio");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer() {
  await initX402();

  const httpServer = createServer(async (req, res) => {
    if (!enforceOriginLock(req, res)) return;

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          transport: "http",
          endpoint: "/mcp",
          auth: mcpX402
            ? "Bearer lmx_... (balance) or x402 pay-per-call when omitted"
            : "Bearer lmx_... required for chat_completion",
          x402: Boolean(mcpX402),
        }),
      );
      return;
    }

    if (url.pathname === "/mcp") {
      const started = Date.now();
      const server = createLmxMcpServer("http");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        await runWithRequestContext(requestContextFromHttp(req), async () => {
          await transport.handleRequest(req, res);
        });
      } catch (error) {
        const detail =
          error instanceof Error
            ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
            : String(error);
        logToolEvent({
          level: "error",
          tool: "transport.handleRequest",
          callerId: req.socket.remoteAddress ?? "unknown",
          source: "streamable-http",
          ok: false,
          latencyMs: Date.now() - started,
          detail,
        });

        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "MCP request failed" }));
        } else if (!res.writableEnded) {
          res.end();
        }
      } finally {
        await server.close().catch((error: unknown) => {
          const detail =
            error instanceof Error
              ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
              : String(error);
          logToolEvent({
            level: "error",
            tool: "transport.close",
            callerId: req.socket.remoteAddress ?? "unknown",
            source: "streamable-http",
            ok: false,
            latencyMs: Date.now() - started,
            detail,
          });
        });
      }
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
