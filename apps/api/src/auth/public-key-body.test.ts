import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validatePublicCreateKeyBody,
  WALLET_VERIFICATION_REQUIRED,
} from "./public-key-body.js";

describe("validatePublicCreateKeyBody", () => {
  it("accepts an empty body", () => {
    assert.deepEqual(validatePublicCreateKeyBody(undefined), {});
    assert.deepEqual(validatePublicCreateKeyBody(null), {});
    assert.deepEqual(validatePublicCreateKeyBody({}), {});
  });

  it("accepts email only", () => {
    assert.deepEqual(validatePublicCreateKeyBody({ email: "you@example.com" }), {
      email: "you@example.com",
    });
    assert.deepEqual(validatePublicCreateKeyBody({ email: "  you@example.com  " }), {
      email: "you@example.com",
    });
  });

  it("rejects wallet claims without SIWE", () => {
    assert.equal(
      validatePublicCreateKeyBody({
        wallet: "0x0000000000000000000000000000000000000001",
      }),
      WALLET_VERIFICATION_REQUIRED,
    );
  });

  it("rejects email and wallet together", () => {
    assert.equal(
      validatePublicCreateKeyBody({
        email: "you@example.com",
        wallet: "0x0000000000000000000000000000000000000001",
      }),
      WALLET_VERIFICATION_REQUIRED,
    );
  });

  it("rejects invalid email", () => {
    assert.equal(validatePublicCreateKeyBody({ email: "" }), "Field 'email' must be a non-empty string");
    assert.equal(validatePublicCreateKeyBody({ email: 1 }), "Field 'email' must be a non-empty string");
  });

  it("rejects non-object bodies", () => {
    assert.equal(validatePublicCreateKeyBody("nope"), "Request body must be a JSON object");
  });

  it("accepts an environment tag", () => {
    assert.deepEqual(validatePublicCreateKeyBody({ environment: "staging" }), {
      environment: "staging",
    });
    assert.deepEqual(
      validatePublicCreateKeyBody({ email: "you@example.com", environment: "Production" }),
      { email: "you@example.com", environment: "production" },
    );
  });

  it("rejects an invalid environment tag", () => {
    assert.equal(
      validatePublicCreateKeyBody({ environment: "prod" }),
      "Field 'environment' must be one of: development, staging, production",
    );
  });
});
