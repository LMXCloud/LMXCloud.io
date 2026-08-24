import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  envConfigured,
  INFRA_SERVICES,
  isInfraServiceId,
} from "./infra-spend-catalog.js";
import { cuSecondsFromConsumption, pullNeonSpend, pullRailwaySpend } from "./infra-spend-live.js";
import { buildSpendSeries, monthKeys } from "./infra-spend.js";
import {
  computeNeedsFunding,
  type InfraObservability,
} from "./infra-spend-snapshot.js";
import { parseInfraSpendInsert, type InfraSpendEntry } from "./infra-spend-store.js";

function entry(
  overrides: Partial<InfraSpendEntry> & Pick<InfraSpendEntry, "service" | "amount" | "date" | "kind">,
): InfraSpendEntry {
  return {
    id: overrides.id ?? "e",
    note: overrides.note ?? null,
    createdAt: overrides.createdAt ?? "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("infra spend catalog", () => {
  it("covers the production vendors named in DEPLOY.md and .env.example", () => {
    const ids = INFRA_SERVICES.map((s) => s.id);
    for (const id of [
      "ionet",
      "akash",
      "aethir",
      "nosana",
      "railway",
      "neon",
      "sentry",
      "vercel",
      "clerk",
      "cloudflare",
    ]) {
      assert.equal(isInfraServiceId(id), true, id);
      assert.ok(ids.includes(id));
    }
  });

  it("treats Railway as configured when the process is running on Railway", () => {
    const railway = INFRA_SERVICES.find((s) => s.id === "railway");
    assert.ok(railway);
    assert.equal(envConfigured(railway, {}), false);
    assert.equal(envConfigured(railway, { RAILWAY_ENVIRONMENT: "production" }), true);
  });
});

describe("parseInfraSpendInsert", () => {
  it("accepts a spend row", () => {
    const parsed = parseInfraSpendInsert({
      service: "railway",
      amount: 0.68,
      date: "2026-08-22",
      note: "Hobby credit",
      kind: "spend",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.service, "railway");
      assert.equal(parsed.value.amount, 0.68);
    }
  });

  it("rejects unknown services and bad dates", () => {
    assert.equal(parseInfraSpendInsert({ service: "aws", amount: 1, date: "2026-08-22" }).ok, false);
    assert.equal(
      parseInfraSpendInsert({ service: "neon", amount: 1, date: "2026-13-01" }).ok,
      false,
    );
  });
});

describe("buildSpendSeries", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("plots manual spend and excludes balance/note rows", () => {
    const series = buildSpendSeries(
      [
        entry({ service: "railway", amount: 0.68, date: "2026-08-22", kind: "spend" }),
        entry({ service: "ionet", amount: 10, date: "2026-08-22", kind: "balance" }),
        entry({ service: "neon", amount: 0, date: "2026-08-22", kind: "note" }),
      ],
      [],
      3,
      now,
    );
    assert.deepEqual(
      series.map((m) => m.date),
      ["2026-06", "2026-07", "2026-08"],
    );
    const aug = series[2];
    assert.equal(aug.manualUsd, 0.68);
    assert.equal(aug.liveUsd, 0);
    assert.equal(aug.amount, 0.68);
  });

  it("does not add live and manual spend for the same service-month", () => {
    const series = buildSpendSeries(
      [entry({ service: "railway", amount: 0.68, date: "2026-08-22", kind: "spend" })],
      [
        {
          service: "railway",
          amountUsd: 0.71,
          month: "2026-08",
          amountKind: "current cycle",
          checkUrl: "https://railway.com/dashboard",
          asOf: "2026-08-22T12:00:00.000Z",
        },
      ],
      1,
      now,
    );
    assert.equal(series[0]?.liveUsd, 0.71);
    assert.equal(series[0]?.manualUsd, 0);
    assert.equal(series[0]?.amount, 0.71);
  });

  it("keeps other services' manual spend next to a live vendor", () => {
    const series = buildSpendSeries(
      [
        entry({ service: "railway", amount: 0.68, date: "2026-08-22", kind: "spend" }),
        entry({ service: "sentry", amount: 26, date: "2026-08-01", kind: "spend" }),
      ],
      [
        {
          service: "railway",
          amountUsd: 0.71,
          month: "2026-08",
          amountKind: "current cycle",
          checkUrl: "https://railway.com/dashboard",
          asOf: "2026-08-22T12:00:00.000Z",
        },
      ],
      1,
      now,
    );
    assert.equal(series[0]?.liveUsd, 0.71);
    assert.equal(series[0]?.manualUsd, 26);
    assert.equal(series[0]?.amount, 26.71);
  });
});

describe("computeNeedsFunding", () => {
  it("alarms only on a live API remaining-credit of zero", () => {
    const liveZero: InfraObservability = {
      mode: "api",
      metric: "balance",
      amountUsd: 0,
      amountKind: "remaining sub-key allowance",
      checkUrl: "https://example.test",
      asOf: "2026-08-22T12:00:00.000Z",
    };
    const liveSpend: InfraObservability = {
      mode: "api",
      metric: "spend",
      amountUsd: 0,
      amountKind: "current cycle",
      checkUrl: "https://example.test",
      asOf: "2026-08-22T12:00:00.000Z",
    };
    assert.equal(computeNeedsFunding(liveZero), true);
    assert.equal(computeNeedsFunding({ ...liveZero, amountUsd: 10 }), false);
    assert.equal(computeNeedsFunding(liveSpend), false);
    assert.equal(
      computeNeedsFunding({
        mode: "not_api_observable",
        reason: "AkashML has no account-balance API",
      }),
      false,
    );
  });
});

describe("monthKeys", () => {
  it("returns UTC calendar months ending at now", () => {
    assert.deepEqual(monthKeys(2, new Date("2026-01-15T00:00:00.000Z")), [
      "2025-12",
      "2026-01",
    ]);
  });
});

describe("cuSecondsFromConsumption", () => {
  it("reads both Neon v2 metric shapes", () => {
    assert.equal(cuSecondsFromConsumption({ compute_unit_seconds: 3600 }), 3600);
    assert.equal(
      cuSecondsFromConsumption({
        metrics: [{ metric_name: "compute_unit_seconds", value: 7200 }],
      }),
      7200,
    );
  });
});

describe("live vendor pullers", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("does not pretend Railway or Neon are live without tokens", async () => {
    const railway = await pullRailwaySpend({});
    const neon = await pullNeonSpend({});
    assert.equal(railway.status, "skipped");
    assert.equal(neon.status, "skipped");
  });

  it("converts Railway nextInvoiceCurrentTotal cents to USD", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({
        data: {
          workspace: {
            customer: { subscriptions: [{ nextInvoiceCurrentTotal: 68 }] },
          },
        },
      }),
    );

    const result = await pullRailwaySpend({
      RAILWAY_TOKEN: "tok",
      RAILWAY_WORKSPACE_ID: "ws",
    });
    assert.equal(result.status, "ok");
    if (result.status === "ok") {
      assert.equal(result.points[0]?.amountUsd, 0.68);
      assert.equal(result.points[0]?.service, "railway");
    }
  });

  it("estimates Neon spend from CU-seconds at the Launch rate", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({
        projects: [
          {
            periods: [
              {
                consumption: [{ compute_unit_seconds: 3600 }],
              },
            ],
          },
        ],
      }),
    );

    const result = await pullNeonSpend(
      { NEON_API_KEY: "key", NEON_ORG_ID: "org", NEON_CU_HOUR_USD: "0.106" },
      new Date("2026-08-22T12:00:00.000Z"),
    );
    assert.equal(result.status, "ok");
    if (result.status === "ok") {
      assert.equal(result.points[0]?.amountUsd, 0.106);
      assert.equal(result.points[0]?.month, "2026-08");
    }
  });
});
