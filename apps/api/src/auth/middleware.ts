import type { FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, isValidApiKeyFormat } from "./keys.js";
import { isSessionTokenFormat, verifySessionToken } from "./session.js";
import type { ApiKeyRecord, ApiKeyStore } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyRecord;
  }
}

interface AuthHookOptions {
  sessionSecret: string;
}

export function createAuthHook(store: ApiKeyStore, options: AuthHookOptions) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      return reply.status(401).send({
        error: {
          message: "Missing Authorization header. Use: Bearer <token>",
          type: "authentication_error",
        },
      });
    }

    if (isSessionTokenFormat(token)) {
      const payload = verifySessionToken(token, options.sessionSecret);
      if (!payload) {
        return reply.status(401).send({
          error: {
            message: "Invalid or expired session",
            type: "authentication_error",
          },
        });
      }

      const record = await store.findById(payload.id);
      if (!record || record.email?.trim().toLowerCase() !== payload.email) {
        return reply.status(401).send({
          error: {
            message: "Invalid or expired session",
            type: "authentication_error",
          },
        });
      }

      request.apiKey = record;
      void store.touchLastUsed(record.id);
      return;
    }

    if (!isValidApiKeyFormat(token)) {
      return reply.status(401).send({
        error: {
          message: "Invalid API key format. Keys must match lmx_[32-char-hex]",
          type: "authentication_error",
        },
      });
    }

    const record = await store.findByPlainKey(token);
    if (!record) {
      return reply.status(401).send({
        error: {
          message: "Invalid API key",
          type: "authentication_error",
        },
      });
    }

    request.apiKey = record;
    void store.touchLastUsed(record.id);
  };
}
