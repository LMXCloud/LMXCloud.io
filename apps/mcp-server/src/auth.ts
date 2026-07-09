import { getRequestContext } from "./request-context.js";

const LMX_KEY_PATTERN = /^lmx_[0-9a-f]{32}$/i;

export type ApiKeySource = "tool" | "header" | "client_env" | "admin_fallback" | "public";

export type ResolvedApiKey =
  | {
      ok: true;
      apiKey: string;
      source: ApiKeySource;
      callerId: string;
    }
  | {
      ok: false;
      code: "missing_api_key" | "invalid_api_key_format";
      message: string;
    };

function normalizeApiKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return normalizeApiKey(match?.[1]);
}

export function callerIdFromApiKey(apiKey: string): string {
  if (apiKey.length <= 12) return apiKey;
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}

export function resolveApiKey(options: {
  toolApiKey?: string;
  transport: "stdio" | "http";
  allowAdminFallback: boolean;
}): ResolvedApiKey {
  const fromTool = normalizeApiKey(options.toolApiKey);
  const requestContext = getRequestContext();
  const fromHeader =
    parseBearerToken(requestContext?.authorizationHeader) ??
    normalizeApiKey(requestContext?.apiKey);
  const fromClientEnv =
    options.transport === "stdio" ? normalizeApiKey(process.env.LMX_API_KEY) : undefined;
  const adminFallback = normalizeApiKey(
    process.env.LMX_ADMIN_API_KEY ??
      (options.transport === "http" ? process.env.LMX_API_KEY : undefined),
  );

  const candidate = fromTool ?? fromHeader ?? fromClientEnv ?? (options.allowAdminFallback ? adminFallback : undefined);
  const source: ApiKeySource | undefined = fromTool
    ? "tool"
    : fromHeader
      ? "header"
      : fromClientEnv
        ? "client_env"
        : adminFallback
          ? "admin_fallback"
          : undefined;

  if (!candidate) {
    return {
      ok: false,
      code: "missing_api_key",
      message: [
        "LMX API key is required for this tool.",
        "Provide one of:",
        "- api_key tool argument",
        "- Authorization: Bearer lmx_... header (hosted MCP)",
        "- LMX_API_KEY in your MCP client env (local stdio)",
        "Create a key at https://lmxcloud.io/console/keys",
      ].join("\n"),
    };
  }

  if (!LMX_KEY_PATTERN.test(candidate)) {
    return {
      ok: false,
      code: "invalid_api_key_format",
      message:
        'Invalid API key format. Expected "lmx_" followed by 32 hex characters.',
    };
  }

  return {
    ok: true,
    apiKey: candidate,
    source: source ?? "admin_fallback",
    callerId: callerIdFromApiKey(candidate),
  };
}

export function formatAuthError(status: number, body: string): string {
  if (status === 401) {
    return [
      "LMX API rejected the API key (401 Unauthorized).",
      "Verify your key is active and paste the full lmx_... value.",
      body ? `Details: ${body}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (status === 403) {
    return [
      "LMX API rejected the API key (403 Forbidden).",
      body ? `Details: ${body}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return `LMX API returned ${status}: ${body}`;
}
