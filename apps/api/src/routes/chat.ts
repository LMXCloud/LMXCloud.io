import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ChatCompletionRequest } from "@lmxcloud/shared";
import { AllProvidersDownError, ProviderError } from "../providers/types.js";
import { parseRoutingPreference } from "../routing/strategies.js";
import type { InferenceRouter } from "../routing/router.js";
import type { UsageStore } from "../usage/store.js";

interface ChatRouteDeps {
  router: InferenceRouter;
  authenticate: preHandlerHookHandler;
  usageStore: UsageStore;
}

function isValidMessage(
  msg: unknown,
): msg is ChatCompletionRequest["messages"][number] {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.role === "string" &&
    ["system", "user", "assistant", "tool"].includes(m.role) &&
    typeof m.content === "string"
  );
}

function validateRequest(body: unknown): ChatCompletionRequest | string {
  if (typeof body !== "object" || body === null) {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;

  if (typeof b.model !== "string" || b.model.trim() === "") {
    return "Field 'model' is required and must be a non-empty string";
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return "Field 'messages' is required and must be a non-empty array";
  }

  for (const msg of b.messages) {
    if (!isValidMessage(msg)) {
      return "Each message must have a valid 'role' and string 'content'";
    }
  }

  if (b.stream === true) {
    return "Streaming is not supported in MVP v1.0. Set stream to false or omit it.";
  }

  return {
    model: b.model,
    messages: b.messages,
    temperature: typeof b.temperature === "number" ? b.temperature : undefined,
    max_tokens: typeof b.max_tokens === "number" ? b.max_tokens : undefined,
    max_completion_tokens:
      typeof b.max_completion_tokens === "number"
        ? b.max_completion_tokens
        : undefined,
    stream: false,
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function registerChatRoutes(
  app: FastifyInstance,
  deps: ChatRouteDeps,
): Promise<void> {
  app.post<{ Body: unknown }>(
    "/v1/chat/completions",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateRequest(request.body);

      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const preference = parseRoutingPreference(headerValue(request.headers["x-lmx-prefer"]));

      try {
        const result = await deps.router.route(validated, preference);

        reply.header("x-lmx-provider", result.provider);
        reply.header("x-lmx-fallback", result.fallbackUsed ? "true" : "false");
        reply.header("x-lmx-latency", String(result.latencyMs));

        void deps.usageStore.recordUsage({
          apiKeyId: request.apiKey!.id,
          provider: result.provider,
          model: validated.model,
          promptTokens: result.response.usage?.prompt_tokens ?? 0,
          completionTokens: result.response.usage?.completion_tokens ?? 0,
          latencyMs: result.latencyMs,
          fallbackUsed: result.fallbackUsed,
        });

        return reply.send(result.response);
      } catch (err) {
        if (err instanceof AllProvidersDownError) {
          return reply.status(503).send({
            error: {
              message: err.message,
              type: "service_unavailable",
              code: "all_providers_down",
            },
          });
        }

        if (err instanceof ProviderError) {
          request.log.error({ err, provider: err.provider }, "Provider request failed");

          const status = err.statusCode === 429 ? 429 : err.statusCode === 401 ? 502 : 504;
          return reply.status(status).send({
            error: {
              message: err.message,
              type: "provider_error",
              code: err.provider,
            },
          });
        }

        request.log.error({ err }, "Unexpected error during chat completion");
        return reply.status(500).send({
          error: {
            message: "Internal server error",
            type: "internal_error",
          },
        });
      }
    },
  );
}

