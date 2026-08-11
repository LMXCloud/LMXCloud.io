/**
 * Provider upstream billing / quota exhaustion signals for telemetry (`error_code`).
 *
 * Shapes verified from each vendor's docs and live probes (2026-08):
 *
 * - ionet: 401 `{"detail":"Invalid API Key"}`; sub-key credit cap → HTTP 429
 *   (io.net sub-key docs); IO Credits exhaustion → HTTP 402 + OpenAI-style
 *   `error.type: payment_required` (io.net payments guide).
 * - akash: HTTP 402 = insufficient credits; body uses OpenAI `error.message` /
 *   top-level `error` + `message` (AkashML intro).
 * - aethir: auth `{"code":412,"msg":"TOKEN_INVALID"}`; billing uses credit pool;
 *   errors may be `{code,msg}` or OpenAI `error.{message,type,code}` (Aethir Mesh docs).
 * - nosana: deployment/credits API documents `INSUFFICIENT_FUNDS` when available
 *   credits cannot cover a job (Nosana credits docs).
 */

export const PROVIDER_BILLING_EXHAUSTED_CODE = "provider_billing_exhausted";

const BILLING_MESSAGE_RE =
  /\b(insufficient\s+(funds|credits?|balance)|credit\s+limit|payment\s+required|quota\s+exhausted|out\s+of\s+credits?|balance\s+too\s+low|no\s+credits?\s+remaining|top\s+up|add\s+more\s+credits?)\b/i;

const BILLING_TYPE_RE =
  /\b(payment_required|insufficient_quota|insufficient_credits?|insufficient_funds)\b/i;

const BILLING_CODE_RE =
  /\b(insufficient_funds|insufficient_credits?|payment_required|insufficient_quota)\b/i;

type ErrorSignals = {
  messages: string[];
  types: string[];
  codes: string[];
  statuses: string[];
};

function pushSignal(bucket: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    bucket.push(value.trim());
  } else if (typeof value === "number" && Number.isFinite(value)) {
    bucket.push(String(value));
  }
}

function collectSignals(json: Record<string, unknown>): ErrorSignals {
  const messages: string[] = [];
  const types: string[] = [];
  const codes: string[] = [];
  const statuses: string[] = [];

  pushSignal(messages, json.detail);
  pushSignal(messages, json.message);
  pushSignal(messages, json.msg);
  pushSignal(codes, json.code);
  pushSignal(statuses, json.status);

  const error = json.error;
  if (typeof error === "string") {
    pushSignal(messages, error);
  } else if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    pushSignal(messages, errObj.message);
    pushSignal(types, errObj.type);
    pushSignal(codes, errObj.code);
    pushSignal(statuses, errObj.status);
  }

  return { messages, types, codes, statuses };
}

function parseErrorPayload(body: string): ErrorSignals | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    return collectSignals(json);
  } catch {
    return null;
  }
}

function signalsMatchBilling(signals: ErrorSignals): boolean {
  const haystack = [
    ...signals.messages,
    ...signals.types,
    ...signals.codes,
    ...signals.statuses,
  ]
    .join(" ")
    .toLowerCase();

  if (!haystack) return false;

  return (
    BILLING_MESSAGE_RE.test(haystack) ||
    BILLING_TYPE_RE.test(haystack) ||
    BILLING_CODE_RE.test(haystack) ||
    haystack.includes("insufficient_funds")
  );
}

function ionetBillingExhausted(
  statusCode: number | undefined,
  signals: ErrorSignals | null,
  rawBody: string,
): boolean {
  if (statusCode === 402) return true;

  if (statusCode === 429 && signals) {
    const haystack = [
      ...signals.messages,
      ...signals.types,
      ...signals.codes,
    ]
      .join(" ")
      .toLowerCase();
    if (
      haystack.includes("credit") &&
      (haystack.includes("limit") ||
        haystack.includes("exceeded") ||
        haystack.includes("blocked"))
    ) {
      return true;
    }
  }

  if (signals?.types.some((t) => t.toLowerCase() === "payment_required")) {
    return true;
  }

  return signalsMatchBilling(signals ?? { messages: [], types: [], codes: [], statuses: [] }) ||
    BILLING_MESSAGE_RE.test(rawBody);
}

function akashBillingExhausted(
  statusCode: number | undefined,
  signals: ErrorSignals | null,
  rawBody: string,
): boolean {
  // AkashML documents HTTP 402 as insufficient credits.
  if (statusCode === 402) return true;
  return signalsMatchBilling(signals ?? { messages: [], types: [], codes: [], statuses: [] }) ||
    BILLING_MESSAGE_RE.test(rawBody);
}

function aethirBillingExhausted(
  statusCode: number | undefined,
  signals: ErrorSignals | null,
  rawBody: string,
): boolean {
  if (statusCode === 402) return true;

  if (signals) {
    const numericCodes = signals.codes.filter((c) => /^\d+$/.test(c));
    // TOKEN_INVALID (412) is auth — never treat as billing.
    if (numericCodes.some((c) => c === "412")) return false;

    if (signals.statuses.some((s) => s.toUpperCase() === "INSUFFICIENT_FUNDS")) {
      return true;
    }
  }

  return signalsMatchBilling(signals ?? { messages: [], types: [], codes: [], statuses: [] }) ||
    BILLING_MESSAGE_RE.test(rawBody);
}

function nosanaBillingExhausted(
  statusCode: number | undefined,
  signals: ErrorSignals | null,
  rawBody: string,
): boolean {
  if (statusCode === 402) return true;

  if (signals) {
    if (signals.statuses.some((s) => s.toUpperCase() === "INSUFFICIENT_FUNDS")) {
      return true;
    }
    if (
      signals.codes.some((c) => c.toUpperCase() === "INSUFFICIENT_FUNDS") ||
      signals.types.some((t) => t.toUpperCase() === "INSUFFICIENT_FUNDS")
    ) {
      return true;
    }
  }

  return rawBody.toUpperCase().includes("INSUFFICIENT_FUNDS") ||
    signalsMatchBilling(signals ?? { messages: [], types: [], codes: [], statuses: [] }) ||
    BILLING_MESSAGE_RE.test(rawBody);
}

const PROVIDER_CLASSIFIERS: Record<
  string,
  (
    statusCode: number | undefined,
    signals: ErrorSignals | null,
    rawBody: string,
  ) => boolean
> = {
  ionet: ionetBillingExhausted,
  akash: akashBillingExhausted,
  aethir: aethirBillingExhausted,
  nosana: nosanaBillingExhausted,
};

export function isProviderBillingExhaustedError(
  providerName: string,
  statusCode: number | undefined,
  responseBody: string,
): boolean {
  const rawBody = responseBody.trim();
  const signals = parseErrorPayload(rawBody);
  const classifier = PROVIDER_CLASSIFIERS[providerName];
  if (classifier) {
    return classifier(statusCode, signals, rawBody);
  }

  if (statusCode === 402) return true;
  return signalsMatchBilling(
    signals ?? { messages: [], types: [], codes: [], statuses: [] },
  ) || BILLING_MESSAGE_RE.test(rawBody);
}

export function classifyProviderTelemetryErrorCode(
  providerName: string,
  statusCode: number | undefined,
  responseBody: string,
): string {
  if (isProviderBillingExhaustedError(providerName, statusCode, responseBody)) {
    return PROVIDER_BILLING_EXHAUSTED_CODE;
  }
  if (statusCode != null) return `provider_http_${statusCode}`;
  return "provider_error";
}

export function isProviderBillingTelemetryCode(errorCode: string | null | undefined): boolean {
  return errorCode === PROVIDER_BILLING_EXHAUSTED_CODE;
}
