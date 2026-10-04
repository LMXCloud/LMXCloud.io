import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOutcome,
  collectShapeIssues,
  contentTypeAgrees,
  evaluateAssertion,
  evaluateAssertions,
  evaluateBlockHead,
  findTimestampAge,
  isEmptyPayload,
  isStaleCache,
  schemaFromExample,
  selectRotation,
  shapeVerdict,
  strictListingSchema,
  type OutcomeInput,
} from "./verdict.js";

const NOW = Date.parse("2026-10-02T15:00:00.000Z");

function outcome(patch: Partial<OutcomeInput>): ReturnType<typeof classifyOutcome> {
  return classifyOutcome({
    paymentSent: true,
    didPay: true,
    inputFault: false,
    timeout: false,
    httpStatus: 200,
    errorLikeBody: false,
    nonempty: true,
    emptyPayload: false,
    expectNonEmpty: false,
    shapeFailed: false,
    assertionFailed: false,
    assertionInputFault: false,
    ...patch,
  });
}

test("an example schema requires every key and the first array item's shape", () => {
  const schema = schemaFromExample({
    count: 1,
    results: [{ title: "Example", score: 0.5 }],
  });
  assert.deepEqual(schema.required, ["count", "results"]);
  assert.equal(schema.properties?.count?.type, "number");
  assert.equal(schema.properties?.results?.items?.properties?.title?.type, "string");
  const issues = collectShapeIssues(
    { count: "1", results: [{ title: "ok" }] },
    schema,
  );
  assert.deepEqual(
    issues.map((issue) => `${issue.path} ${issue.kind} ${issue.expected}`),
    ["$.count type number", "$.results.0.score missing present"],
  );
});

test("strict-only and example absences warn, and a present key of the wrong type fails", () => {
  const listing = {
    type: "object",
    properties: { results: { type: "array" } },
  };
  const strictOnly = shapeVerdict({
    parsed: { extra: true },
    unparsed: false,
    listingSchema: listing,
    expectedFailed: false,
    listingFormatFailed: false,
  });
  assert.equal(strictOnly.shapeFailed, false);
  assert.equal(strictOnly.shapeLenient, true);
  assert.equal(strictOnly.shapeStrict, false);
  assert.equal(strictOnly.warnings[0]?.path, "$.results");

  const example = schemaFromExample({ address: "0xabc", name: "vitalik.eth" });
  const missing = shapeVerdict({
    parsed: { name: "vitalik.eth" },
    unparsed: false,
    exampleSchema: example,
    expectedFailed: false,
    listingFormatFailed: false,
  });
  assert.equal(missing.shapeFailed, false);
  assert.equal(missing.warnings.some((warning) => warning.path === "$.address"), true);

  const nullTyped = shapeVerdict({
    parsed: { reasoning_content: "because" },
    unparsed: false,
    listingSchema: { type: "object", properties: { reasoning_content: { type: "null" } } },
    expectedFailed: false,
    listingFormatFailed: false,
  });
  assert.equal(nullTyped.shapeFailed, false);
  assert.equal(nullTyped.issues.length, 0);

  const typed = shapeVerdict({
    parsed: { address: 1, name: "vitalik.eth" },
    unparsed: false,
    exampleSchema: example,
    expectedFailed: false,
    listingFormatFailed: false,
  });
  assert.equal(typed.shapeFailed, true);
  assert.equal(typed.issues.some((issue) => issue.path === "$.address" && issue.kind === "type"), true);

  const lenient = shapeVerdict({
    parsed: {},
    unparsed: false,
    listingSchema: { type: "object", required: ["results"], properties: { results: { type: "array" } } },
    expectedFailed: false,
    listingFormatFailed: false,
  });
  assert.equal(lenient.shapeFailed, true);
});

test("strict listing schemas require declared properties and keep the lenient schema optional", () => {
  const listing = {
    type: "object",
    properties: {
      results: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } },
    },
  };
  assert.equal(collectShapeIssues({ extra: true }, listing).length, 0);
  const strict = strictListingSchema(listing);
  const issues = collectShapeIssues({ results: [{}] }, strict);
  assert.deepEqual(
    issues.map((issue) => issue.path),
    ["$.results.0.title"],
  );
});

test("empty payload is an empty collection, a zero count, or null data", () => {
  assert.equal(isEmptyPayload([]), true);
  assert.equal(isEmptyPayload({}), true);
  assert.equal(isEmptyPayload({ data: null }), true);
  assert.equal(isEmptyPayload({ results: [], count: 0 }), true);
  assert.equal(isEmptyPayload({ results: [{ title: "bitcoin" }], count: 1 }), false);
  assert.equal(isEmptyPayload({ symbol: "USDC", decimals: 6 }), false);
});

test("assertions record the actual value and do not treat our bad regex as a seller miss", () => {
  const body = {
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    symbol: "USDC",
    decimals: 6,
    choices: [{ message: { content: "pong" } }],
    result: "0x1a",
    data: { text: "Running bitcoin" },
    verdict: "block",
    results: [{ title: "bitcoin" }],
    updatedAt: "2026-10-02T14:59:30.000Z",
  };
  const results = evaluateAssertions(body, [
    { path: "address", op: "eq", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
    { path: "symbol", op: "eq", value: "USDC" },
    { path: "decimals", op: "eq", value: 6 },
    { path: "choices.0.message.content", op: "contains", value: "pong" },
    { path: "result", op: "matches", value: "^0x[0-9a-fA-F]+$" },
    { path: "data.text", op: "eq", value: "Running bitcoin" },
    { path: "verdict", op: "eq", value: "block" },
    { path: "results", op: "nonEmpty" },
    { path: "address", op: "isAddress" },
    { path: "decimals", op: "gt", value: 2 },
    { path: "decimals", op: "lt", value: 18 },
    { path: "updatedAt", op: "freshWithinSeconds", value: 120 },
    { path: "missing", op: "eq", value: 1 },
  ], NOW);
  assert.deepEqual(results.map((item) => item.pass), [
    true, true, true, true, true, true, true, true, true, true, true, true, false,
  ]);
  assert.equal(results[12]?.actual, null);
  assert.equal(results[12]?.fault, "seller");
  const badRegex = evaluateAssertion(body, { path: "result", op: "matches", value: "(" }, NOW);
  assert.equal(badRegex.pass, false);
  assert.equal(badRegex.fault, "input");
});

test("block head within range passes, and a dead RPC is an input fault", () => {
  const near = evaluateBlockHead({
    body: { result: "0x64" },
    path: "result",
    within: 100,
    head: 80n,
    unavailable: false,
  });
  assert.equal(near.pass, true);
  assert.equal(near.actual, 20);
  const far = evaluateBlockHead({
    body: { result: "0x3e8" },
    path: "result",
    within: 100,
    head: 80n,
    unavailable: false,
  });
  assert.equal(far.pass, false);
  assert.equal(far.fault, "seller");
  const down = evaluateBlockHead({
    body: { result: "0x64" },
    path: "result",
    within: 100,
    head: null,
    unavailable: true,
  });
  assert.equal(down.fault, "input");
  assert.equal(down.pass, false);
});

test("content type ignores charset and timestamp age is recorded", () => {
  assert.equal(contentTypeAgrees("application/json", "application/json; charset=utf-8"), true);
  assert.equal(contentTypeAgrees("application/json", "text/html"), false);
  assert.equal(contentTypeAgrees(null, "application/json"), "na");
  const age = findTimestampAge({ meta: { updatedAt: "2026-10-02T14:59:00.000Z" } }, NOW);
  assert.equal(age?.path, "$.meta.updatedAt");
  assert.equal(age?.ageSeconds, 60);
});

test("a live-data hash that never changes is stale only after a prior run", () => {
  assert.equal(isStaleCache({ liveData: true, priorHashes: [], current: "abc" }), false);
  assert.equal(isStaleCache({ liveData: true, priorHashes: ["abc", "abc"], current: "abc" }), true);
  assert.equal(isStaleCache({ liveData: true, priorHashes: ["abc", "def"], current: "abc" }), false);
  assert.equal(isStaleCache({ liveData: false, priorHashes: ["abc"], current: "abc" }), false);
});

test("paid outcomes pick exactly one class and our input never becomes a seller miss", () => {
  assert.equal(outcome({}), "pass");
  assert.equal(outcome({ httpStatus: 400 }), "charged_for_client_error");
  assert.equal(outcome({ httpStatus: 502 }), "server_error_after_payment");
  assert.equal(outcome({ timeout: true, httpStatus: null }), "timeout_after_payment");
  assert.equal(outcome({ errorLikeBody: true }), "error_body");
  assert.equal(outcome({ emptyPayload: true, expectNonEmpty: true }), "empty_result");
  assert.equal(outcome({ emptyPayload: true, expectNonEmpty: false }), "pass");
  assert.equal(outcome({ nonempty: false }), "no_delivery");
  assert.equal(outcome({ shapeFailed: true, assertionFailed: true }), "shape_mismatch");
  assert.equal(outcome({ assertionFailed: true }), "assertion_failed");
  assert.equal(outcome({ assertionInputFault: true }), "input_fault");
  assert.equal(outcome({ inputFault: true, httpStatus: 400 }), "input_fault");
  assert.equal(outcome({ paymentSent: false, inputFault: true, didPay: false }), "input_fault");
  assert.equal(outcome({ paymentSent: false, didPay: false }), null);
  assert.equal(outcome({ didPay: false, httpStatus: 402 }), null);
});

test("an ordinary run uses the golden case, and a multi-slot schedule rotates", () => {
  const cases = ["allow", "block"];
  assert.equal(selectRotation(cases, new Date(0)).index, 0);
  assert.equal(selectRotation(cases, new Date(86_400_000)).index, 0);
  assert.equal(selectRotation(cases, new Date(86_400_000)).item, "allow");
  const noon = selectRotation(cases, new Date(12 * 60 * 60 * 1000), 2);
  assert.equal(noon.index, 1);
  assert.equal(noon.item, "block");
});

test("a null value skips the type check", () => {
  const issues = collectShapeIssues(
    { id: null, note: "ok" },
    { type: "object", properties: { id: { type: "string" }, note: { type: "string" } } },
  );
  assert.deepEqual(issues, []);
});
