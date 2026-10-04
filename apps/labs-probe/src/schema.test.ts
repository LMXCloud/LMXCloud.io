import assert from "node:assert/strict";
import test from "node:test";

import { declaredRequiredInput, listingOutputSchema, matchesSchema } from "./schema.js";

const chatSchema = {
  type: "object",
  required: ["id", "choices"],
  properties: {
    id: { type: "string" },
    choices: { type: "array", minItems: 1 },
  },
};

test("a null value is compatible with any expected type", () => {
  assert.equal(matchesSchema({ id: null, choices: [{ index: 0 }] }, chatSchema), true);
  assert.equal(matchesSchema({ id: "chatcmpl-1", choices: null }, chatSchema), true);
});

test("a property typed null does not constrain the live value", () => {
  const schema = {
    type: "object",
    properties: {
      reasoning_content: { type: "null" },
      content: { type: "string" },
    },
    required: ["content"],
  };
  assert.equal(matchesSchema({ content: "hi", reasoning_content: "because" }, schema), true);
  assert.equal(matchesSchema({ content: "hi", reasoning_content: null }, schema), true);
});

test("matches a delivery against the expected object schema", () => {
  assert.equal(
    matchesSchema({ id: "chatcmpl-1", choices: [{ index: 0 }] }, chatSchema),
    true,
  );
  assert.equal(matchesSchema({ id: "chatcmpl-1", choices: [] }, chatSchema), false);
  assert.equal(matchesSchema({ choices: [{ index: 0 }] }, chatSchema), false);
});

test("rejects additional properties when the listing forbids them", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
  };
  assert.equal(matchesSchema({ ok: true }, schema), true);
  assert.equal(matchesSchema({ ok: true, extra: 1 }, schema), false);
});

test("reads the Bazaar output schema and ignores example-only output", () => {
  const output = {
    type: "object",
    required: ["ok"],
    properties: { ok: { type: "boolean" } },
  };
  assert.deepEqual(
    listingOutputSchema({
      extensions: {
        bazaar: {
          schema: {
            properties: {
              input: { type: "object" },
              output,
            },
          },
        },
      },
    }),
    output,
  );

  assert.equal(
    listingOutputSchema({
      extensions: {
        bazaar: {
          info: { output: { example: { ok: true } } },
          schema: { properties: { input: { type: "object" }, output: { example: { ok: true } } } },
        },
      },
    }),
    undefined,
  );

  assert.equal(
    listingOutputSchema({
      extensions: {
        bazaar: {
          schema: {
            properties: {
              output: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  example: { type: "object" },
                },
                required: ["type"],
              },
            },
          },
        },
      },
    }),
    undefined,
  );
});

test("required input comes from the live 402, not discovery wrapper keys", () => {
  assert.deepEqual(
    declaredRequiredInput({
      extensions: {
        bazaar: {
          info: { input: { type: "http", method: "GET" } },
          schema: {
            properties: {
              input: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  method: { type: "string" },
                  queryParams: { type: "object", properties: {} },
                },
                required: ["type", "method"],
              },
            },
            required: ["input"],
          },
        },
      },
    }),
    { query: [], body: [] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      extensions: {
        bazaar: {
          schema: {
            properties: {
              input: {
                properties: {
                  queryParams: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"],
                  },
                },
              },
            },
          },
        },
      },
    }),
    { query: ["name"], body: [] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      extensions: {
        bazaar: {
          schema: {
            properties: {
              input: {
                properties: {
                  body: {
                    type: "object",
                    properties: { model: { type: "string" }, messages: { type: "array" } },
                    required: ["messages"],
                  },
                },
              },
            },
          },
        },
      },
    }),
    { query: [], body: ["messages"] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      x402Version: 1,
      accepts: [{
        outputSchema: {
          input: { type: "http", method: "GET", queryParams: { q: "cats" } },
        },
      }],
    }),
    { query: ["q"], body: [] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      x402Version: 1,
      accepts: [{ outputSchema: { input: { type: "http", method: "GET" } } }],
    }),
    { query: [], body: [] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      x402Version: 2,
      accepts: [{
        outputSchema: {
          input: {
            type: "http",
            method: "GET",
            queryParams: { min_score: "70", limit: "25" },
            required: [],
          },
        },
      }],
    }),
    { query: [], body: [] },
  );

  assert.deepEqual(
    declaredRequiredInput({
      x402Version: 2,
      accepts: [{
        outputSchema: {
          input: {
            type: "object",
            properties: { symbol: { type: "string" } },
            required: ["symbol"],
          },
        },
      }],
    }),
    { query: [], body: ["symbol"] },
  );
});

test("reads a v1 outputSchema response schema", () => {
  const output = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
  assert.deepEqual(
    listingOutputSchema({
      accepts: [{ outputSchema: { properties: { output } } }],
    }),
    output,
  );
  assert.deepEqual(listingOutputSchema({ accepts: [{ outputSchema: output }] }), output);
});
