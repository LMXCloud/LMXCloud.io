import type { FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, isValidApiKeyFormat } from "./keys.js";
import type { ApiKeyRecord, ApiKeyStore } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyRecord;
  }
}

export function createAuthHook(store: ApiKeyStore) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      return reply.status(401).send({
        error: {
          message: "Missing Authorization header. Use: Bearer lmx_your_api_key",
          type: "authentication_error",
        },
      });
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
