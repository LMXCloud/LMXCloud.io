import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDraftMessages,
  draftFailureMessage,
  parseNotificationDraft,
} from "./notification-draft.ts";

describe("parseNotificationDraft", () => {
  it("reads a clean JSON object", () => {
    const draft = parseNotificationDraft(
      '{"title":"Streaming is live","body":"WebSocket streaming is on for chat completions."}',
    );
    assert.deepEqual(draft, {
      title: "Streaming is live",
      body: "WebSocket streaming is on for chat completions.",
    });
  });

  it("strips markdown fences and surrounding prose", () => {
    const draft = parseNotificationDraft(`
Sure, here you go:
\`\`\`json
{"title": "Providers recovering", "body": "Together is back in the fallback chain."}
\`\`\`
`);
    assert.equal(draft?.title, "Providers recovering");
    assert.equal(draft?.body, "Together is back in the fallback chain.");
  });

  it("returns null when title or body is missing", () => {
    assert.equal(parseNotificationDraft('{"title":"Only title"}'), null);
    assert.equal(parseNotificationDraft("not json at all"), null);
  });
});

describe("buildDraftMessages", () => {
  it("includes kind and notes, asks for JSON only", () => {
    const [system, user] = buildDraftMessages(
      "company_update",
      "All providers unhealthy",
    );
    assert.match(system?.content ?? "", /JSON only/);
    assert.match(user?.content ?? "", /company update/);
    assert.match(user?.content ?? "", /All providers unhealthy/);
  });
});

describe("draftFailureMessage", () => {
  it("tells ops to use a funded lmx_ key on auth failure", () => {
    assert.match(
      draftFailureMessage(new Error("Invalid or expired credentials")),
      /funded lmx_ key/,
    );
  });
});
