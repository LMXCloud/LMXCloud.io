import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectNotificationSuggestions,
  STALE_UPDATE_DAYS,
} from "./notification-suggestions.ts";
import type { OpsIrregularity, OpsNotification, OpsUsageDay } from "./types";

const NOW = new Date("2026-09-10T18:00:00.000Z");

function notice(
  overrides: Partial<OpsNotification> & Pick<OpsNotification, "kind" | "title" | "createdAt">,
): OpsNotification {
  return {
    id: overrides.id ?? "n1",
    body: "body",
    href: null,
    hrefLabel: null,
    createdBy: "ops",
    target: null,
    visibleAt: overrides.visibleAt ?? overrides.createdAt,
    expiresAt: overrides.expiresAt ?? null,
    ...overrides,
  };
}

function usageDays(requests: number[]): OpsUsageDay[] {
  return requests.map((n, i) => ({
    date: `2026-09-0${i + 1}`,
    requests: n,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    fallbackCount: 0,
    avgLatencyMs: null,
  }));
}

function irregularity(
  overrides: Partial<OpsIrregularity> & Pick<OpsIrregularity, "id" | "severity" | "category">,
): OpsIrregularity {
  return {
    title: overrides.title ?? "Issue",
    detail: overrides.detail ?? "Something broke.",
    action: "Look at it",
    ...overrides,
  };
}

describe("collectNotificationSuggestions", () => {
  it("suggests a first product update when history has no broadcasts", () => {
    const [card] = collectNotificationSuggestions({
      history: [notice({ kind: "welcome", title: "Hi", createdAt: NOW.toISOString() })],
      now: NOW,
    });
    assert.equal(card?.id, "stale-update");
    assert.equal(card?.kind, "product_update");
    assert.match(card?.reason ?? "", /No product or company update/);
  });

  it("suggests a stale changelog after N days", () => {
    const createdAt = new Date(NOW);
    createdAt.setUTCDate(createdAt.getUTCDate() - STALE_UPDATE_DAYS);
    const [card] = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Streaming is live",
          createdAt: createdAt.toISOString(),
        }),
      ],
      now: NOW,
    });
    assert.equal(card?.id, "stale-update");
    assert.match(card?.reason ?? "", /14 days/);
    assert.match(card?.reason ?? "", /Streaming is live/);
  });

  it("does not suggest stale when a recent product update exists", () => {
    const cards = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Fresh",
          createdAt: "2026-09-08T12:00:00.000Z",
        }),
      ],
      now: NOW,
    });
    assert.equal(cards.some((c) => c.id === "stale-update"), false);
  });

  it("surfaces a critical user-facing irregularity, not config", () => {
    const cards = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Fresh",
          createdAt: "2026-09-08T12:00:00.000Z",
        }),
      ],
      irregularities: [
        irregularity({
          id: "config.x402_without_store",
          severity: "critical",
          category: "config",
          title: "x402 store down",
          detail: "internal",
        }),
        irregularity({
          id: "health.all_down",
          severity: "critical",
          category: "health",
          title: "All providers unhealthy",
          detail: "0/2 providers passed the latest health check.",
        }),
      ],
      now: NOW,
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.id, "irregularity:health.all_down");
    assert.equal(cards[0]?.kind, "company_update");
    assert.match(cards[0]?.reason ?? "", /0\/2 providers/);
  });

  it("treats health.partial as a persistent irregularity", () => {
    const [card] = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Fresh",
          createdAt: "2026-09-08T12:00:00.000Z",
        }),
      ],
      irregularities: [
        irregularity({
          id: "health.partial",
          severity: "warn",
          category: "health",
          title: "Provider(s) unhealthy",
          detail: "Down: together. Fallback chain still has 1 healthy.",
        }),
      ],
      now: NOW,
    });
    assert.equal(card?.id, "irregularity:health.partial");
  });

  it("suggests a usage jump from overview history buckets", () => {
    const [card] = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Fresh",
          createdAt: "2026-09-08T12:00:00.000Z",
        }),
      ],
      usageHistory: usageDays([12, 10, 11, 40]),
      now: NOW,
    });
    assert.equal(card?.id, "usage-jump");
    assert.equal(card?.kind, "product_update");
    assert.match(card?.reason ?? "", /40 requests/);
    assert.match(card?.reason ?? "", /median of 11/);
  });

  it("suggests a signup jump over the last two days", () => {
    const iso = (daysAgo: number) =>
      new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const [card] = collectNotificationSuggestions({
      history: [
        notice({
          kind: "product_update",
          title: "Fresh",
          createdAt: "2026-09-08T12:00:00.000Z",
        }),
      ],
      recentSignups: [
        { createdAt: iso(0.2) },
        { createdAt: iso(0.5) },
        { createdAt: iso(1.1) },
        { createdAt: iso(3) },
      ],
      now: NOW,
    });
    assert.equal(card?.id, "signup-jump");
    assert.equal(card?.kind, "company_update");
    assert.match(card?.reason ?? "", /3 new accounts/);
    assert.match(card?.reason ?? "", /vs 1 in the two days before/);
  });
});
