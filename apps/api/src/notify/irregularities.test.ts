import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { OpsIrregularity } from "../ops/irregularities.js";
import {
  notifyCriticalIrregularities,
  resetCriticalIrregularityNotifyState,
} from "./irregularities.js";
import { resetTelegramConfigCache } from "./telegram.js";

function critical(id: string): OpsIrregularity {
  return {
    id,
    severity: "critical",
    category: "health",
    title: `Alert ${id}`,
    detail: "detail",
    action: "action",
  };
}

describe("notifyCriticalIrregularities", () => {
  afterEach(() => {
    resetCriticalIrregularityNotifyState();
    resetTelegramConfigCache();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    mock.restoreAll();
  });

  it("notifies once for a new critical irregularity", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    let fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      return new Response("ok");
    });

    notifyCriticalIrregularities([critical("health.all_down")]);
    notifyCriticalIrregularities([critical("health.all_down")]);

    assert.equal(fetchCalls, 1);
  });

  it("notifies again after cooldown when condition persists", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    let fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      return new Response("ok");
    });
    const now = mock.method(Date, "now");
    now.mock.mockImplementationOnce(() => 0);
    now.mock.mockImplementationOnce(() => 60_000);
    now.mock.mockImplementationOnce(() => 30 * 60 * 1000);

    notifyCriticalIrregularities([critical("payments.stuck")]);
    notifyCriticalIrregularities([critical("payments.stuck")]);
    notifyCriticalIrregularities([critical("payments.stuck")]);

    assert.equal(fetchCalls, 2);
  });

  it("treats a returning condition as a new occurrence", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    let fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      return new Response("ok");
    });

    notifyCriticalIrregularities([critical("usage.latency_critical")]);
    notifyCriticalIrregularities([]);
    notifyCriticalIrregularities([critical("usage.latency_critical")]);

    assert.equal(fetchCalls, 2);
  });

  it("ignores warn and info severities", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    let fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      return new Response("ok");
    });

    notifyCriticalIrregularities([
      {
        id: "health.partial",
        severity: "warn",
        category: "health",
        title: "warn",
        detail: "detail",
        action: "action",
      },
    ]);

    assert.equal(fetchCalls, 0);
  });
});
