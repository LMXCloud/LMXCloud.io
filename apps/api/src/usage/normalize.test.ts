import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LMX_USAGE_SCHEMA, normalizeUsage } from "./normalize.js";

describe("normalizeUsage", () => {
  it("passes a complete provider usage through as reported", () => {
    const usage = normalizeUsage({ prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 });
    assert.equal(usage.schema, LMX_USAGE_SCHEMA);
    assert.equal(usage.prompt_tokens, 12);
    assert.equal(usage.completion_tokens, 30);
    assert.equal(usage.total_tokens, 42);
    assert.equal(usage.source, "provider");
    assert.deepEqual(usage.derived, []);
    assert.deepEqual(usage.unavailable, ["reasoning_tokens", "cached_prompt_tokens"]);
    assert.equal(usage.cost_basis, "total_tokens");
  });

  it("reads reasoning and cached-prompt breakdowns when the provider sends them", () => {
    const usage = normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 64 },
      completion_tokens_details: { reasoning_tokens: 20 },
    });
    assert.equal(usage.cached_prompt_tokens, 64);
    assert.equal(usage.reasoning_tokens, 20);
    assert.deepEqual(usage.unavailable, []);
  });

  it("derives total from prompt + completion and says so", () => {
    const usage = normalizeUsage({ prompt_tokens: 5, completion_tokens: 7 });
    assert.equal(usage.total_tokens, 12);
    assert.deepEqual(usage.derived, ["total_tokens"]);
    assert.equal(usage.source, "provider");
    assert.equal(usage.cost_basis, "total_tokens");
  });

  it("marks partial usage as partial and leaves missing counts null, not 0", () => {
    const usage = normalizeUsage({ completion_tokens: 9 });
    assert.equal(usage.prompt_tokens, null);
    assert.equal(usage.completion_tokens, 9);
    assert.equal(usage.total_tokens, null);
    assert.equal(usage.source, "provider_partial");
    assert.ok(usage.unavailable.includes("prompt_tokens"));
    assert.ok(usage.unavailable.includes("total_tokens"));
    assert.equal(usage.cost_basis, "unavailable");
  });

  it("marks absent usage as unavailable with every count null", () => {
    for (const raw of [null, undefined, {}, "nope", 3]) {
      const usage = normalizeUsage(raw);
      assert.equal(usage.source, "unavailable");
      assert.equal(usage.prompt_tokens, null);
      assert.equal(usage.completion_tokens, null);
      assert.equal(usage.total_tokens, null);
      assert.equal(usage.unavailable.length, 5);
      assert.equal(usage.cost_basis, "unavailable");
    }
  });

  it("treats null, negative and non-numeric counts as unreported", () => {
    const usage = normalizeUsage({ prompt_tokens: null, completion_tokens: -1, total_tokens: "42" });
    assert.equal(usage.source, "unavailable");
    assert.equal(usage.total_tokens, null);
  });

  it("keeps a reported 0 as 0", () => {
    const usage = normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    assert.equal(usage.total_tokens, 0);
    assert.equal(usage.source, "provider");
    assert.ok(!usage.unavailable.includes("total_tokens"));
  });
});
