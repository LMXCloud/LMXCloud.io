import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSentryProbeError, runSentryTest } from "./sentry-test.js";

describe("runSentryTest", () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
  });

  it("reports when SENTRY_DSN is unset", async () => {
    delete process.env.SENTRY_DSN;

    const result = await runSentryTest();

    assert.deepEqual(result, {
      object: "ops_sentry_test",
      sentryDsnConfigured: false,
      captureInvoked: false,
      eventId: null,
      flushed: false,
      message: "SENTRY_DSN is not set — no event was sent to Sentry",
    });
  });
});

describe("createSentryProbeError", () => {
  it("uses a stable, identifiable error name", () => {
    const error = createSentryProbeError();
    assert.equal(error.name, "OpsSentryVerificationError");
    assert.match(error.message, /Sentry verification probe/);
  });
});
