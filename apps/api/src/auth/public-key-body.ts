import type { ApiKeyEnvironment } from "./environment.js";
import { parseOptionalEnvironment } from "./environment.js";

export interface PublicCreateKeyBody {
  email?: string;
  environment?: ApiKeyEnvironment;
}

export type PublicCreateKeyBodyResult = PublicCreateKeyBody | string;

export const WALLET_VERIFICATION_REQUIRED = "wallet_verification_required" as const;

/** Validates body for unauthenticated POST /v1/auth/key — wallet claims are rejected. */
export function validatePublicCreateKeyBody(body: unknown): PublicCreateKeyBodyResult {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;

  if (b.wallet !== undefined) {
    return WALLET_VERIFICATION_REQUIRED;
  }

  const result: PublicCreateKeyBody = {};

  if (b.email !== undefined) {
    if (typeof b.email !== "string" || b.email.trim() === "") {
      return "Field 'email' must be a non-empty string";
    }
    result.email = b.email.trim();
  }

  const environment = parseOptionalEnvironment(b.environment);
  if (!environment.ok) {
    return environment.error;
  }
  if (b.environment !== undefined && b.environment !== null) {
    result.environment = environment.value;
  }

  return result;
}

/** Body returned by POST /v1/auth/key now that anonymous key creation is closed. */
export function publicKeySignupClosedError() {
  return {
    error: {
      message:
        "Creating API keys without signing in is no longer supported. Sign in at https://lmxcloud.io to create a key, or use wallet sign-in (POST /v1/auth/wallet/nonce, then POST /v1/auth/wallet/verify).",
      type: "invalid_request_error",
      code: "public_key_signup_closed",
    },
  } as const;
}
