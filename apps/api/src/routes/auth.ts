import type { FastifyInstance } from "fastify";
import type { ApiKeyStore } from "../auth/store.js";
import type { RateLimitResult } from "../rate-limit.js";

interface AuthRouteDeps {
  store: ApiKeyStore;
  rateLimit: (key: string) => RateLimitResult;
}

interface CreateKeyBody {
  email?: string;
  wallet?: string;
}

function validateCreateKeyBody(body: unknown): CreateKeyBody | string {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  const result: CreateKeyBody = {};

  if (b.email !== undefined) {
    if (typeof b.email !== "string" || b.email.trim() === "") {
      return "Field 'email' must be a non-empty string";
    }
    result.email = b.email.trim();
  }

  if (b.wallet !== undefined) {
    if (typeof b.wallet !== "string" || b.wallet.trim() === "") {
      return "Field 'wallet' must be a non-empty string";
    }
    result.wallet = b.wallet.trim();
  }

  return result;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  app.post<{ Body: unknown }>("/v1/auth/key", async (request, reply) => {
    const clientIp = request.ip;
    const limit = deps.rateLimit(clientIp);

    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    const validated = validateCreateKeyBody(request.body);

    if (typeof validated === "string") {
      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    const { record, plainKey } = await deps.store.create(validated);

    return reply.status(201).send({
      object: "api_key",
      api_key: plainKey,
      id: record.id,
      email: record.email ?? null,
      wallet: record.wallet ?? null,
      created_at: record.createdAt,
    });
  });
}
