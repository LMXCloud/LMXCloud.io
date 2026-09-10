import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { notificationAccountId, notificationAccountIds } from "./account-id.js";
import { notificationHrefLabel } from "@lmxcloud/shared";
import {
  parseHref,
  parseOpsNotificationBody,
  parseReadBody,
  parseWelcomeTemplateBody,
} from "./parse.js";

describe("notificationAccountId", () => {
  it("prefers email, then wallet, then key id", () => {
    assert.equal(
      notificationAccountId({ id: "k1", email: "Ada@LMXCloud.io" }),
      "email:ada@lmxcloud.io",
    );
    assert.equal(
      notificationAccountId({ id: "k1", wallet: "0xABC" }),
      "wallet:0xabc",
    );
    assert.equal(notificationAccountId({ id: "k1" }), "key:k1");
  });

  it("includes every account identity for feed matching", () => {
    const ids = notificationAccountIds(
      { id: "k1", email: "a@b.com", wallet: "0xAb" },
      [{ id: "k1" }, { id: "k2" }],
    );
    assert.deepEqual(ids.sort(), [
      "email:a@b.com",
      "key:k1",
      "key:k2",
      "wallet:0xab",
    ]);
  });
});

describe("parseOpsNotificationBody", () => {
  it("accepts a broadcast product update", () => {
    const parsed = parseOpsNotificationBody({
      kind: "product_update",
      title: "Streaming is live",
      body: "Chat completions now stream tokens.",
      href: "/docs",
      hrefLabel: "Docs",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.kind, "product_update");
      assert.equal(parsed.value.target, null);
      assert.equal(parsed.value.href, "/docs");
      assert.equal(parsed.value.hrefLabel, "Docs");
      assert.equal(parsed.value.visibleAt, null);
      assert.equal(parsed.value.expiresAt, null);
    }
  });

  it("accepts a scheduled window", () => {
    const parsed = parseOpsNotificationBody({
      kind: "product_update",
      title: "Later",
      body: "Shows tomorrow, gone in a week.",
      visibleAt: "2026-09-11T12:00:00.000Z",
      expiresAt: "2026-09-18T12:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.visibleAt, "2026-09-11T12:00:00.000Z");
      assert.equal(parsed.value.expiresAt, "2026-09-18T12:00:00.000Z");
    }
  });

  it("rejects expiresAt before visibleAt", () => {
    assert.equal(
      parseOpsNotificationBody({
        kind: "product_update",
        title: "Later",
        body: "Bad window",
        visibleAt: "2026-09-18T12:00:00.000Z",
        expiresAt: "2026-09-11T12:00:00.000Z",
      }).ok,
      false,
    );
  });

  it("rejects unknown kinds and javascript hrefs", () => {
    assert.equal(
      parseOpsNotificationBody({
        kind: "low_balance",
        title: "x",
        body: "y",
      }).ok,
      false,
    );
    assert.equal(parseHref("javascript:alert(1)").ok, false);
    assert.equal(parseHref("/console/credits").ok, true);
    assert.equal(parseHref("https://lmxcloud.io/docs").ok, true);
    assert.equal(
      parseOpsNotificationBody({
        kind: "product_update",
        title: "x",
        body: "y",
        hrefLabel: "Docs",
      }).ok,
      false,
    );
  });
});

describe("parseWelcomeTemplateBody", () => {
  it("requires title and body", () => {
    assert.equal(parseWelcomeTemplateBody({ title: "Hi" }).ok, false);
    const parsed = parseWelcomeTemplateBody({
      title: "Welcome",
      body: "You're in.",
      href: "",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.href, null);
  });
});

describe("notificationHrefLabel", () => {
  it("prefers a custom label and derives Docs from /docs", () => {
    assert.equal(notificationHrefLabel("/docs"), "Docs");
    assert.equal(notificationHrefLabel("/docs", "Release notes"), "Release notes");
    assert.equal(notificationHrefLabel(null), null);
  });
});

describe("parseReadBody", () => {
  it("dedupes ids", () => {
    const parsed = parseReadBody({ ids: ["a", "a", "b"] });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.ids, ["a", "b"]);
  });
});
