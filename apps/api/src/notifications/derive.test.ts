import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveKeyExpiringNotifications,
  deriveLowBalanceNotifications,
  deriveProviderHealthNotifications,
  LOW_BALANCE_USD,
} from "@lmxcloud/shared";

describe("deriveLowBalanceNotifications", () => {
  it("matches the Overview / Credits $0.01 threshold", () => {
    assert.equal(LOW_BALANCE_USD, 0.01);
    const now = new Date("2026-09-10T12:00:00.000Z");
    assert.equal(
      deriveLowBalanceNotifications(
        [{ id: "k1", balance: 0.02, environment: "development" }],
        now,
      ).length,
      0,
    );
    const low = deriveLowBalanceNotifications(
      [{ id: "k1", balance: 0, environment: "development" }],
      now,
    );
    assert.equal(low.length, 1);
    assert.equal(low[0]?.id, "low_balance:account");
    assert.equal(low[0]?.href, "/console/credits");
  });
});

describe("deriveProviderHealthNotifications", () => {
  it("treats an open circuit as unhealthy even if the probe is up", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const events = deriveProviderHealthNotifications(
      {
        providers: {
          ionet: { healthy: true, routing: { circuit: "open" } },
          akash: { healthy: true, routing: { circuit: "closed" } },
        },
      },
      now,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.severity, "warning");
    assert.match(events[0]?.body ?? "", /ionet/);
  });
});

describe("deriveKeyExpiringNotifications", () => {
  it("skips keys without expires_at", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    assert.equal(
      deriveKeyExpiringNotifications(
        [{ id: "k1", balance: 1, environment: "production" }],
        now,
      ).length,
      0,
    );
  });
});
