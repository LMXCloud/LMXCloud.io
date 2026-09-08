import type { ApiKeyEnvironment } from "../types";
import { API_KEY_ENVIRONMENTS } from "../types";

export const API_KEY_ENVIRONMENT_OPTIONS: Array<{
  value: ApiKeyEnvironment;
  label: string;
}> = [
  { value: "development", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "production", label: "Production" },
];

const ENVIRONMENT_TONES = {
  development: "info",
  staging: "warning",
  production: "success",
} as const;

export function isApiKeyEnvironment(value: unknown): value is ApiKeyEnvironment {
  return (
    typeof value === "string" &&
    (API_KEY_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

export function normalizeApiKeyEnvironment(value: unknown): ApiKeyEnvironment {
  return isApiKeyEnvironment(value) ? value : "development";
}

export function apiKeyEnvironmentLabel(environment: ApiKeyEnvironment): string {
  return (
    API_KEY_ENVIRONMENT_OPTIONS.find((option) => option.value === environment)?.label ??
    environment
  );
}

export function apiKeyEnvironmentTone(environment: ApiKeyEnvironment) {
  return ENVIRONMENT_TONES[environment];
}
