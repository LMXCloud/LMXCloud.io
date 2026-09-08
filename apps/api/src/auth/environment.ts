export const API_KEY_ENVIRONMENTS = ["development", "staging", "production"] as const;

export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number];

export const DEFAULT_API_KEY_ENVIRONMENT: ApiKeyEnvironment = "development";

const ENVIRONMENT_ERROR =
  "Field 'environment' must be one of: development, staging, production";

export type ParseEnvironmentResult =
  | { ok: true; value: ApiKeyEnvironment }
  | { ok: false; error: string };

export function isApiKeyEnvironment(value: unknown): value is ApiKeyEnvironment {
  return (
    typeof value === "string" &&
    (API_KEY_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

export function parseOptionalEnvironment(value: unknown): ParseEnvironmentResult {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_API_KEY_ENVIRONMENT };
  }
  return parseRequiredEnvironment(value);
}

export function parseRequiredEnvironment(value: unknown): ParseEnvironmentResult {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: ENVIRONMENT_ERROR };
  }
  const normalized = value.trim().toLowerCase();
  if (!isApiKeyEnvironment(normalized)) {
    return { ok: false, error: ENVIRONMENT_ERROR };
  }
  return { ok: true, value: normalized };
}
