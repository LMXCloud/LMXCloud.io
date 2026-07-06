import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { resolveClerkUser } from "../auth/clerk.js";
import { extractBearerToken } from "../auth/keys.js";
import { createSessionToken } from "../auth/session.js";
import type { ApiKeyStore } from "../auth/store.js";
import type { CreditStore } from "../credits/store.js";
import { roundCredits } from "../credits/pricing.js";
import type { RateLimitResult } from "../rate-limit.js";
import type { UsageStore } from "../usage/store.js";

interface AuthRouteDeps {
  store: ApiKeyStore;
  authenticate: preHandlerHookHandler;
  keyGenRateLimit: (key: string) => RateLimitResult;
  creditStore: CreditStore;
  usageStore: UsageStore;
  initialCreditBalance: number;
  sessionSecret: string;
  sessionTtlMs: number;
  clerkSecretKey?: string;
}

interface LoginBody {
  email: string;
}

interface CreateKeyBody {
  email?: string;
  wallet?: string;
}

interface RevokeKeyBody {
  id?: string;
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

function validateRevokeKeyBody(body: unknown): RevokeKeyBody | string {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  if (b.id === undefined) {
    return {};
  }

  if (typeof b.id !== "string" || b.id.trim() === "") {
    return "Field 'id' must be a non-empty string";
  }

  return { id: b.id.trim() };
}

function validateLoginBody(body: unknown): LoginBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object with email";
  }

  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || b.email.trim() === "") {
    return "Field 'email' is required";
  }

  return { email: b.email.trim() };
}

function serializeKey(record: {
  id: string;
  email?: string;
  wallet?: string;
  createdAt: string;
  lastUsedAt?: string;
}) {
  return {
    object: "api_key",
    id: record.id,
    email: record.email ?? null,
    wallet: record.wallet ?? null,
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt ?? null,
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  app.get<{ Querystring: { email?: string } }>(
    "/v1/auth/account",
    async (request, reply) => {
      const email = request.query.email?.trim();
      if (!email) {
        return reply.status(400).send({
          error: { message: "Query parameter 'email' is required", type: "invalid_request_error" },
        });
      }

      const exists = await deps.store.emailHasAccount(email);

      return {
        object: "account",
        email,
        exists,
      };
    },
  );

  app.post("/v1/auth/clerk", async (request, reply) => {
    if (!deps.clerkSecretKey) {
      return reply.status(503).send({
        error: {
          message: "Clerk authentication is not configured on the server",
          type: "configuration_error",
        },
      });
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.status(401).send({
        error: {
          message: "Missing Authorization header. Use: Bearer <clerk_session_token>",
          type: "authentication_error",
        },
      });
    }

    let clerkUser;
    try {
      clerkUser = await resolveClerkUser(deps.clerkSecretKey, token);
    } catch {
      return reply.status(401).send({
        error: {
          message: "Invalid or expired Clerk session",
          type: "authentication_error",
        },
      });
    }

    let record = await deps.store.findPrimaryKeyForEmail(clerkUser.email);
    let createdAccount = false;
    if (!record) {
      const created = await deps.store.create({ email: clerkUser.email });
      record = created.record;
      await deps.creditStore.credit(record.id, deps.initialCreditBalance);
      createdAccount = true;
    }

    const sessionToken = createSessionToken(
      record.id,
      clerkUser.email,
      deps.sessionSecret,
      deps.sessionTtlMs,
    );

    return reply.status(200).send({
      object: "session",
      session_token: sessionToken,
      email: clerkUser.email,
      api_key_id: record.id,
      created_account: createdAccount,
    });
  });

  app.post<{ Body: unknown }>("/v1/auth/login", async (request, reply) => {
    const validated = validateLoginBody(request.body);
    if (typeof validated === "string") {
      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    const record = await deps.store.findPrimaryKeyForEmail(validated.email);
    if (!record) {
      return reply.status(404).send({
        error: {
          message: "No account found for this email. Sign up first.",
          type: "authentication_error",
        },
      });
    }

    const sessionToken = createSessionToken(
      record.id,
      validated.email,
      deps.sessionSecret,
      deps.sessionTtlMs,
    );

    return reply.status(200).send({
      object: "session",
      session_token: sessionToken,
      email: validated.email,
      api_key_id: record.id,
    });
  });

  app.post<{ Body: unknown }>("/v1/auth/key", async (request, reply) => {
    const clientIp = request.ip;
    const limit = deps.keyGenRateLimit(clientIp);

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
    await deps.creditStore.credit(record.id, deps.initialCreditBalance);
    const balance = await deps.creditStore.getBalance(record.id);

    return reply.status(201).send({
      object: "api_key",
      api_key: plainKey,
      id: record.id,
      email: record.email ?? null,
      wallet: record.wallet ?? null,
      created_at: record.createdAt,
      balance: roundCredits(balance),
      currency: "USD",
    });
  });

  app.get(
    "/v1/auth/keys",
    { preHandler: deps.authenticate },
    async (request) => {
      const records = await deps.store.listForRecord(request.apiKey!);
      const currentId = request.apiKey!.id;

      const data = await Promise.all(
        records.map(async (record) => {
          const usage = await deps.usageStore.getUsage(record.id);
          const balance = await deps.creditStore.getBalance(record.id);

          return {
            ...serializeKey(record),
            balance: roundCredits(balance),
            currency: "USD",
            is_current: record.id === currentId,
            usage: {
              requests: usage?.requestCount ?? 0,
              prompt_tokens: usage?.promptTokens ?? 0,
              completion_tokens: usage?.completionTokens ?? 0,
              total_tokens: usage?.totalTokens ?? 0,
              last_request_at: usage?.lastRequestAt ?? null,
            },
          };
        }),
      );

      return {
        object: "list",
        data,
      };
    },
  );

  app.delete<{ Body: unknown }>(
    "/v1/auth/key",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateRevokeKeyBody(request.body);

      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const targetId = validated.id ?? request.apiKey!.id;
      const revoked = await deps.store.revoke(targetId, request.apiKey!);

      if (!revoked) {
        return reply.status(404).send({
          error: {
            message: "API key not found or already revoked",
            type: "invalid_request_error",
          },
        });
      }

      return reply.status(200).send({
        object: "api_key.deleted",
        id: targetId,
        deleted: true,
      });
    },
  );
}
