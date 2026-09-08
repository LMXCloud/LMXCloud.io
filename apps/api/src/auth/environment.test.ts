import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseOptionalEnvironment,
  parseRequiredEnvironment,
} from "./environment.js";
import { FileApiKeyStore } from "./store.js";

describe("parse environment", () => {
  it("defaults omitted values on create", () => {
    assert.deepEqual(parseOptionalEnvironment(undefined), {
      ok: true,
      value: "development",
    });
    assert.deepEqual(parseOptionalEnvironment(null), {
      ok: true,
      value: "development",
    });
  });

  it("normalizes valid values", () => {
    assert.deepEqual(parseOptionalEnvironment("Staging"), {
      ok: true,
      value: "staging",
    });
    assert.deepEqual(parseRequiredEnvironment("PRODUCTION"), {
      ok: true,
      value: "production",
    });
  });

  it("rejects invalid values", () => {
    const error = "Field 'environment' must be one of: development, staging, production";
    assert.deepEqual(parseOptionalEnvironment("prod"), { ok: false, error });
    assert.deepEqual(parseRequiredEnvironment(undefined), { ok: false, error });
    assert.deepEqual(parseRequiredEnvironment(""), { ok: false, error });
  });
});

describe("FileApiKeyStore environment", () => {
  async function withStore(run: (store: FileApiKeyStore, filePath: string) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lmx-key-env-"));
    const filePath = path.join(dir, "keys.json");
    const store = new FileApiKeyStore(filePath);
    try {
      await run(store, filePath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("defaults new keys to development", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      assert.equal(record.environment, "development");
    });
  });

  it("persists a requested environment", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({
        email: "dev@example.com",
        environment: "production",
      });
      assert.equal(record.environment, "production");
    });
  });

  it("backfills missing environment on load", async () => {
    await withStore(async (store, filePath) => {
      await fs.writeFile(
        filePath,
        JSON.stringify([
          {
            id: "legacy-1",
            keyHash: "hash",
            email: "dev@example.com",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
        "utf-8",
      );
      const listed = await store.listForRecord({
        id: "legacy-1",
        keyHash: "hash",
        email: "dev@example.com",
        environment: "development",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(listed[0]?.environment, "development");
    });
  });

  it("updates environment for an owned key", async () => {
    await withStore(async (store) => {
      const { record } = await store.create({ email: "dev@example.com" });
      const updated = await store.updateEnvironment(record.id, record, "staging");
      assert.equal(updated?.environment, "staging");
      const listed = await store.listForRecord(record);
      assert.equal(listed[0]?.environment, "staging");
    });
  });

  it("rejects environment updates for keys the owner does not own", async () => {
    await withStore(async (store) => {
      const { record: owner } = await store.create({ email: "dev@example.com" });
      const { record: other } = await store.create({ email: "other@example.com" });
      const updated = await store.updateEnvironment(other.id, owner, "production");
      assert.equal(updated, null);
    });
  });
});
