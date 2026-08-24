import {
  isProviderBillingExhaustedError,
  isProviderBillingTelemetryCode,
  PROVIDER_BILLING_EXHAUSTED_CODE,
} from "../providers/billing-errors.js";

/**
 * Failures that are LMX operator credentials/funding — not the provider being down.
 * Status/uptime should treat these as the provider answering, not an outage.
 */
const AUTH_INVALID_RE =
  /\b(invalid api key|token_invalid|api key (?:is )?(?:invalid|expired|revoked)|unauthorized)\b/i;

const HEALTH_HTTP_STATUS_RE = /^http_(\d{3})\b/i;

export const OPERATOR_ATTRIBUTION_USAGE_ERROR_CODES = [
  PROVIDER_BILLING_EXHAUSTED_CODE,
  "provider_http_401",
  "provider_http_402",
] as const;

/** SQL boolean: health-check error_detail is an operator credential/funding fault. */
export const OPERATOR_ATTRIBUTION_HEALTH_SQL = `(
  error_detail ~* '^http_401(\\b|:)'
  OR error_detail ~* '^http_402(\\b|:)'
  OR error_detail ILIKE '%invalid api key%'
  OR error_detail ILIKE '%token_invalid%'
  OR error_detail ILIKE '%insufficient fund%'
  OR error_detail ILIKE '%insufficient credit%'
  OR error_detail ILIKE '%insufficient_funds%'
  OR error_detail ILIKE '%payment_required%'
  OR error_detail ILIKE '%credit limit%'
  OR error_detail ILIKE '%quota exhausted%'
  OR error_detail ILIKE '%out of credit%'
  OR error_detail ILIKE '%no credits remaining%'
  OR error_detail ILIKE '%add more credits%'
)`;

/** SQL boolean: usage_events.error_code is an operator credential/funding fault. */
export const OPERATOR_ATTRIBUTION_USAGE_SQL = `(error_code IN ('${OPERATOR_ATTRIBUTION_USAGE_ERROR_CODES.join("', '")}'))`;

export function isProviderAuthInvalidError(
  statusCode: number | undefined,
  body: string,
): boolean {
  if (statusCode === 401) return true;
  return AUTH_INVALID_RE.test(body);
}

export function isOperatorAttributionError(
  providerName: string,
  statusCode: number | undefined,
  body: string,
): boolean {
  if (statusCode === 401 || statusCode === 402) return true;
  if (isProviderAuthInvalidError(statusCode, body)) return true;
  return isProviderBillingExhaustedError(providerName, statusCode, body);
}

export function isOperatorAttributionHealthDetail(
  errorDetail: string | null | undefined,
): boolean {
  if (!errorDetail?.trim()) return false;
  const match = errorDetail.trim().match(HEALTH_HTTP_STATUS_RE);
  const statusCode = match ? Number(match[1]) : undefined;
  return isOperatorAttributionError("unknown", statusCode, errorDetail);
}

export function isOperatorAttributionTelemetryCode(
  errorCode: string | null | undefined,
): boolean {
  if (!errorCode) return false;
  if (isProviderBillingTelemetryCode(errorCode)) return true;
  return (OPERATOR_ATTRIBUTION_USAGE_ERROR_CODES as readonly string[]).includes(
    errorCode,
  );
}

export function providerReachableFromProbe(input: {
  provider: string;
  healthy: boolean;
  statusCode?: number;
  errorDetail?: string;
}): boolean {
  if (input.healthy) return true;
  return isOperatorAttributionError(
    input.provider,
    input.statusCode,
    input.errorDetail ?? "",
  );
}
