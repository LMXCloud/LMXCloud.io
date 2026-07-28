import { ProviderError, type ProviderHealthResult } from "../providers/types.js";

export const MAX_HEALTH_ERROR_DETAIL_LEN = 200;

function truncate(value: string): string {
  return value.trim().slice(0, MAX_HEALTH_ERROR_DETAIL_LEN);
}

function isTimeoutMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("aborted")
  );
}

function classifyTransportFailure(message: string): "timeout" | "network" {
  if (isTimeoutMessage(message)) return "timeout";
  return "network";
}

function formatHttpFailure(statusCode: number, body?: string): string {
  const snippet = body?.trim();
  if (snippet) return truncate(`http_${statusCode}: ${snippet}`);
  return `http_${statusCode}`;
}

/** Persisted detail for gateway /models probes (mirrors in-memory health store fields). */
export function formatGatewayHealthErrorDetail(
  result: ProviderHealthResult,
): string | undefined {
  if (result.healthy) return undefined;

  const statusCode = result.statusCode;
  const body = result.errorDetail?.trim();

  if (statusCode != null && statusCode >= 400) {
    return formatHttpFailure(statusCode, body);
  }

  const message = body ?? "Connection failed";
  const kind = classifyTransportFailure(message);
  return truncate(`${kind}: ${message}`);
}

/** Persisted detail for synthetic chatCompletion probes. */
export function formatSyntheticHealthErrorDetail(err: unknown): string {
  if (err instanceof ProviderError) {
    const statusCode = err.statusCode;
    if (statusCode != null && statusCode >= 400) {
      const returnedPrefix = `${err.provider} returned ${statusCode}:`;
      const body =
        err.message.startsWith(returnedPrefix)
          ? err.message.slice(returnedPrefix.length).trim()
          : err.message;
      return formatHttpFailure(statusCode, body);
    }

    const causeMessage =
      err.cause instanceof Error
        ? err.cause.message
        : err.cause != null
          ? String(err.cause)
          : err.message;
    const kind = classifyTransportFailure(causeMessage);
    return truncate(`${kind}: ${causeMessage}`);
  }

  const message = err instanceof Error ? err.message : String(err);
  const kind = classifyTransportFailure(message);
  return truncate(`${kind}: ${message}`);
}
