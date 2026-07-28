import * as Sentry from "@sentry/node";

export type SentryTestResult = {
  object: "ops_sentry_test";
  sentryDsnConfigured: boolean;
  captureInvoked: boolean;
  eventId: string | null;
  flushed: boolean;
  message: string;
};

/** Deliberate probe error — safe to send to Sentry; tagged for easy filtering. */
export function createSentryProbeError(): Error {
  const error = new Error(
    "LMX Cloud ops Sentry verification probe (safe, intentional)",
  );
  error.name = "OpsSentryVerificationError";
  return error;
}

export async function runSentryTest(): Promise<SentryTestResult> {
  const sentryDsnConfigured = Boolean(process.env.SENTRY_DSN?.trim());

  if (!sentryDsnConfigured) {
    return {
      object: "ops_sentry_test",
      sentryDsnConfigured: false,
      captureInvoked: false,
      eventId: null,
      flushed: false,
      message: "SENTRY_DSN is not set — no event was sent to Sentry",
    };
  }

  const eventId =
    Sentry.captureException(createSentryProbeError(), {
      tags: { source: "ops_sentry_test" },
      level: "warning",
    }) ?? null;

  const flushed = await Sentry.flush(2000);

  return {
    object: "ops_sentry_test",
    sentryDsnConfigured: true,
    captureInvoked: true,
    eventId,
    flushed,
    message: eventId
      ? flushed
        ? "Test exception captured and flushed — check Sentry for OpsSentryVerificationError"
        : "Test exception captured but flush timed out — event may still arrive in Sentry"
      : "Sentry.captureException returned no event id",
  };
}
